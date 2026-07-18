//! Honor-system licensing: `license.json` persistence, server checks, the
//! `LicenseStatus` IPC shape and the hourly re-check task, per
//! docs/contracts.md ("Licensing").

use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use whispr_core::license::{evaluate, CachedCheck, LicenseState, DAY_MS, TRIAL_MS};

use crate::state::{self, AppState};

const CHECK_TIMEOUT: Duration = Duration::from_secs(15);
const CHECK_INTERVAL: Duration = Duration::from_secs(3600);

/// Notification body when a check flips the effective state to inactive.
const INACTIVE_NOTICE: &str = "Subscription inactive — dictation disabled";

/// Refusal message when a recording start is blocked.
pub const BLOCKED_MESSAGE: &str = "Subscription inactive — renew to keep dictating";

/// The `LicenseStatus` IPC shape (contract: `get_license_status`).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LicenseStatus {
    pub state: &'static str,
    pub trial_days_left: Option<u64>,
    pub expires: Option<String>,
    pub last_checked_ms: Option<u64>,
}

/// Contents of `<app_data>/license.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseFile {
    pub installed_at_ms: u64,
    #[serde(default)]
    pub last: Option<CachedCheck>,
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

pub fn license_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(state::app_data_dir(app)?.join("license.json"))
}

/// Loads `license.json`, creating it with `installed_at_ms = now` on first
/// load (or when unreadable) — the moment the trial clock starts.
pub fn load(app: &AppHandle) -> LicenseFile {
    let existing = license_path(app)
        .ok()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|raw| serde_json::from_str::<LicenseFile>(&raw).ok());
    match existing {
        Some(file) => file,
        None => {
            let file = LicenseFile {
                installed_at_ms: state::now_ms(),
                last: None,
            };
            if let Err(e) = save(app, &file) {
                tracing::warn!("failed to persist license.json: {e}");
            }
            file
        }
    }
}

fn save(app: &AppHandle, file: &LicenseFile) -> Result<(), String> {
    let path = license_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let raw = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
    std::fs::write(path, raw).map_err(|e| e.to_string())
}

fn store_check(app: &AppHandle, check: CachedCheck) {
    let mut file = load(app);
    file.last = Some(check);
    if let Err(e) = save(app, &file) {
        tracing::warn!("failed to persist license.json: {e}");
    }
}

// ---------------------------------------------------------------------------
// Server check
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct CheckResponse {
    active: bool,
    #[serde(default)]
    expires: Option<String>,
}

/// Joins the server URL with the check path, tolerating a trailing slash.
/// Pure — unit tested. The key is appended as an urlencoded `key` query
/// parameter by the request builder.
fn check_endpoint(server_url: &str) -> String {
    format!("{}/check", server_url.trim_end_matches('/'))
}

/// GETs `{server_url}/check?key=<key>` and returns the verdict stamped with
/// the current time.
pub async fn fetch_check(server_url: &str, key: &str) -> Result<CachedCheck, String> {
    let client = reqwest::Client::builder()
        .timeout(CHECK_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(check_endpoint(server_url))
        .query(&[("key", key)])
        .send()
        .await
        .map_err(|e| format!("license check request failed: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("license check failed with {status}"));
    }
    let parsed: CheckResponse = resp
        .json()
        .await
        .map_err(|e| format!("license check returned invalid JSON: {e}"))?;
    Ok(CachedCheck {
        active: parsed.active,
        expires: parsed.expires,
        checked_at_ms: state::now_ms(),
    })
}

// ---------------------------------------------------------------------------
// Verdict + status
// ---------------------------------------------------------------------------

/// Builds the `LicenseStatus` IPC shape from the raw inputs. Pure — unit
/// tested.
fn build_status(
    server_url_empty: bool,
    installed_at_ms: u64,
    now_ms: u64,
    cache: Option<&CachedCheck>,
) -> LicenseStatus {
    let license_state = evaluate(server_url_empty, installed_at_ms, now_ms, cache);
    let trial_days_left = (license_state == LicenseState::Trial).then(|| {
        TRIAL_MS
            .saturating_sub(now_ms.saturating_sub(installed_at_ms))
            .div_ceil(DAY_MS)
    });
    LicenseStatus {
        state: license_state.as_str(),
        trial_days_left,
        expires: cache.and_then(|c| c.expires.clone()),
        last_checked_ms: cache.map(|c| c.checked_at_ms),
    }
}

fn verdict_inputs(app: &AppHandle) -> (bool, u64, u64, Option<CachedCheck>) {
    let file = load(app);
    let settings = state::current_settings(app);
    (
        settings.license.server_url.trim().is_empty(),
        file.installed_at_ms,
        state::now_ms(),
        file.last,
    )
}

/// The effective license state right now.
pub fn current_state(app: &AppHandle) -> LicenseState {
    let (url_empty, installed_at_ms, now_ms, cache) = verdict_inputs(app);
    evaluate(url_empty, installed_at_ms, now_ms, cache.as_ref())
}

/// The `LicenseStatus` IPC shape right now.
pub fn current_status(app: &AppHandle) -> LicenseStatus {
    let (url_empty, installed_at_ms, now_ms, cache) = verdict_inputs(app);
    build_status(url_empty, installed_at_ms, now_ms, cache.as_ref())
}

/// Guards the dictation start paths: `Err` with the user-facing refusal
/// message when the effective state is `Inactive`.
pub fn ensure_can_dictate(app: &AppHandle) -> Result<(), String> {
    if current_state(app) == LicenseState::Inactive {
        Err(BLOCKED_MESSAGE.to_string())
    } else {
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Re-checks
// ---------------------------------------------------------------------------

/// Re-evaluates the effective state and notifies once when it transitions to
/// `Inactive` (trial expiry or a fresh negative verdict).
fn note_state_transition(app: &AppHandle) {
    let new_state = current_state(app);
    let previous = {
        let app_state = app.state::<AppState>();
        let mut guard = app_state.license_state.lock().unwrap();
        guard.replace(new_state)
    };
    if new_state == LicenseState::Inactive && previous != Some(LicenseState::Inactive) {
        state::notify(app, "whispr-open", INACTIVE_NOTICE);
    }
}

/// One license check pass: fetch + cache when licensing is enabled (URL
/// non-empty), then track the state transition. Fetch errors only log — the
/// last cached verdict keeps deciding (offline keeps working).
pub async fn run_check(app: &AppHandle) {
    let settings = state::current_settings(app);
    let server_url = settings.license.server_url.trim().to_string();
    if !server_url.is_empty() {
        match fetch_check(&server_url, &settings.license.key).await {
            Ok(check) => store_check(app, check),
            Err(e) => tracing::warn!("license check failed: {e}"),
        }
    }
    note_state_transition(app);
}

/// `check_license_now` command path: forces a check and returns the fresh
/// status. Never a hard error — with an empty URL nothing is fetched
/// (disabled status), and fetch failures fall back to the cached/trial
/// status.
pub async fn check_now(app: &AppHandle) -> LicenseStatus {
    run_check(app).await;
    current_status(app)
}

/// Spawns the hourly re-check task; the first tick fires at startup.
pub fn spawn_periodic_check(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(CHECK_INTERVAL);
        loop {
            interval.tick().await;
            run_check(&app).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_endpoint_joins_base() {
        assert_eq!(
            check_endpoint("https://license.example.com"),
            "https://license.example.com/check"
        );
    }

    #[test]
    fn check_endpoint_tolerates_trailing_slash() {
        assert_eq!(
            check_endpoint("https://license.example.com/"),
            "https://license.example.com/check"
        );
    }

    #[test]
    fn status_disabled_when_url_empty() {
        let status = build_status(true, 0, 0, None);
        assert_eq!(status.state, "disabled");
        assert_eq!(status.trial_days_left, None);
        assert_eq!(status.expires, None);
        assert_eq!(status.last_checked_ms, None);
    }

    #[test]
    fn status_trial_days_left_counts_down() {
        let status = build_status(false, 0, 0, None);
        assert_eq!(status.state, "trial");
        assert_eq!(status.trial_days_left, Some(7));
        // Partial days round up.
        assert_eq!(build_status(false, 0, DAY_MS / 2, None).trial_days_left, Some(7));
        assert_eq!(build_status(false, 0, DAY_MS, None).trial_days_left, Some(6));
        assert_eq!(build_status(false, 0, 2 * DAY_MS, None).trial_days_left, Some(5));
        // The final partial day still shows 1 day left.
        assert_eq!(build_status(false, 0, TRIAL_MS - 1, None).trial_days_left, Some(1));
    }

    #[test]
    fn status_active_includes_cache_fields() {
        let cache = CachedCheck {
            active: true,
            expires: Some("2027-01-01".to_string()),
            checked_at_ms: 123,
        };
        let status = build_status(false, 0, TRIAL_MS + 1, Some(&cache));
        assert_eq!(status.state, "active");
        assert_eq!(status.trial_days_left, None);
        assert_eq!(status.expires.as_deref(), Some("2027-01-01"));
        assert_eq!(status.last_checked_ms, Some(123));
    }

    #[test]
    fn status_inactive_and_unverified_after_trial() {
        let cache = CachedCheck {
            active: false,
            expires: None,
            checked_at_ms: 5,
        };
        let status = build_status(false, 0, TRIAL_MS, Some(&cache));
        assert_eq!(status.state, "inactive");
        assert_eq!(status.trial_days_left, None);
        assert_eq!(status.last_checked_ms, Some(5));
        assert_eq!(build_status(false, 0, TRIAL_MS, None).state, "unverified");
    }

    #[test]
    fn status_serializes_contract_field_names() {
        let json = serde_json::to_value(build_status(false, 0, 0, None)).unwrap();
        for key in ["state", "trial_days_left", "expires", "last_checked_ms"] {
            assert!(json.get(key).is_some(), "missing key {key}");
        }
    }
}
