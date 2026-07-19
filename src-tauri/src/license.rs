//! Honor-system licensing: `license.json` persistence, server checks, the
//! `LicenseStatus` IPC shape and the hourly re-check task, per
//! docs/contracts.md ("Licensing").

use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use whispr_core::license::{
    evaluate, subscription_days_left, CachedCheck, LicenseState, DAY_MS, TRIAL_MS,
};

use crate::i18n::{self, Msg};
use crate::state::{self, AppState};

const CHECK_TIMEOUT: Duration = Duration::from_secs(15);
const CHECK_INTERVAL: Duration = Duration::from_secs(3600);

/// The `LicenseStatus` IPC shape (contract: `get_license_status`).
///
/// `state` is the effective verdict, which the trial can mask: during the
/// 7-day trial it stays `trial` whatever the server says. `server_active` and
/// `days_left` therefore report the cached server verdict itself, so the UI
/// can show what a check actually returned even while the trial runs.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LicenseStatus {
    pub state: &'static str,
    pub trial_days_left: Option<u64>,
    /// The cached server verdict; `None` when no check ever succeeded.
    pub server_active: Option<bool>,
    /// Days left on the subscription per the cached `expires` date; `None`
    /// when there is no usable date. Independent of `trial_days_left`.
    pub days_left: Option<u64>,
    pub expires: Option<String>,
    pub last_checked_ms: Option<u64>,
    /// Why the server rejected the key (`"device_limit"`); `None` otherwise.
    pub reason: Option<String>,
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
// Device id
// ---------------------------------------------------------------------------

/// Stable anonymous install id sent with license checks so the server can
/// count devices per key. Random on first use (NOT a hardware fingerprint)
/// and persisted at `<app_data>/device_id`.
///
/// Resolved once per process and cached in [`AppState::device_id`]: the id
/// is read on every hourly check, so without the cache a persistent write
/// failure would send a fresh random id each hour and exhaust the key's
/// device slots. The cache also removes the first-run race between concurrent
/// checks. `AppHandle` is cheap to clone, so the closure captures it.
pub fn device_id(app: &AppHandle) -> String {
    app.state::<AppState>()
        .device_id
        .get_or_init(|| resolve_device_id(app))
        .clone()
}

/// Reads the persisted id, or generates and persists a fresh one. Called at
/// most once per run through [`device_id`]'s `OnceLock`.
fn resolve_device_id(app: &AppHandle) -> String {
    let path = match state::app_data_dir(app) {
        Ok(dir) => dir.join("device_id"),
        Err(_) => return generate_device_id(),
    };
    if let Ok(existing) = std::fs::read_to_string(&path) {
        let existing = existing.trim();
        if (8..=64).contains(&existing.len())
            && existing.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return existing.to_string();
        }
    }
    let fresh = generate_device_id();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(e) = std::fs::write(&path, &fresh) {
        tracing::warn!("failed to persist device_id (the cached id stands for this run): {e}");
    }
    fresh
}

/// 16 random bytes, hex-encoded; falls back to a time-derived id if the OS
/// RNG is somehow unavailable.
fn generate_device_id() -> String {
    let mut buf = [0u8; 16];
    if getrandom::getrandom(&mut buf).is_err() {
        return format!("t{:x}", state::now_ms());
    }
    buf.iter().map(|b| format!("{b:02x}")).collect()
}

// ---------------------------------------------------------------------------
// Server check
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct CheckResponse {
    active: bool,
    #[serde(default)]
    expires: Option<String>,
    #[serde(default)]
    reason: Option<String>,
}

/// Joins the server URL with the check path, tolerating a trailing slash.
/// Pure — unit tested. The key is appended as an urlencoded `key` query
/// parameter by the request builder.
fn check_endpoint(server_url: &str) -> String {
    format!("{}/check", server_url.trim_end_matches('/'))
}

/// GETs `{server_url}/check?key=<key>&device=<device>` and returns the
/// verdict stamped with the current time.
pub async fn fetch_check(server_url: &str, key: &str, device: &str) -> Result<CachedCheck, String> {
    let client = reqwest::Client::builder()
        .timeout(CHECK_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(check_endpoint(server_url))
        .query(&[("key", key), ("device", device)])
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
        reason: parsed.reason,
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
        server_active: cache.map(|c| c.active),
        days_left: subscription_days_left(cache.and_then(|c| c.expires.as_deref()), now_ms),
        expires: cache.and_then(|c| c.expires.clone()),
        last_checked_ms: cache.map(|c| c.checked_at_ms),
        reason: cache.and_then(|c| c.reason.clone()),
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
        Err(i18n::t(&state::ui_language(app), Msg::LicenseBlocked).to_string())
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
        let notice = i18n::t(&state::ui_language(app), Msg::LicenseInactiveNotice);
        state::notify(app, "whispr-open", notice);
    }
}

/// One license check pass: fetch + cache when licensing is enabled (URL
/// non-empty), then track the state transition. Fetch errors only log — the
/// last cached verdict keeps deciding (offline keeps working).
pub async fn run_check(app: &AppHandle) {
    let settings = state::current_settings(app);
    let server_url = settings.license.server_url.trim().to_string();
    if !server_url.is_empty() {
        let device = device_id(app);
        match fetch_check(&server_url, &settings.license.key, &device).await {
            Ok(check) => store_check(app, check),
            Err(e) => tracing::warn!("license check failed, keeping cached verdict: {e}"),
        }
    }
    note_state_transition(app);
}

/// `check_license_now` command path: forces a check, then reads the status
/// back so the caller always sees the cache as it stands after the fetch.
/// Never a hard error — with an empty URL nothing is fetched (disabled
/// status), and a failed fetch only logs at warn and adds nothing new, so
/// `server_active` / `days_left` keep their last known values.
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
            reason: None,
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
            reason: None,
            checked_at_ms: 5,
        };
        let status = build_status(false, 0, TRIAL_MS, Some(&cache));
        assert_eq!(status.state, "inactive");
        assert_eq!(status.trial_days_left, None);
        assert_eq!(status.last_checked_ms, Some(5));
        assert_eq!(build_status(false, 0, TRIAL_MS, None).state, "unverified");
    }

    #[test]
    fn status_reports_server_verdict_during_trial() {
        // The trial masks the effective state, but the cached server verdict
        // still surfaces — that is what lets "Check now" change the UI.
        let cache = CachedCheck {
            active: true,
            expires: Some("1970-02-01".to_string()),
            reason: None,
            checked_at_ms: 99,
        };
        let status = build_status(false, 0, 0, Some(&cache));
        assert_eq!(status.state, "trial");
        assert_eq!(status.trial_days_left, Some(7));
        assert_eq!(status.server_active, Some(true));
        // now is 1970-01-01, so 1970-02-01 is 31 days out.
        assert_eq!(status.days_left, Some(31));
        assert_eq!(status.expires.as_deref(), Some("1970-02-01"));
        assert_eq!(status.last_checked_ms, Some(99));
    }

    #[test]
    fn status_reports_negative_server_verdict_during_trial() {
        let cache = CachedCheck {
            active: false,
            expires: None,
            reason: None,
            checked_at_ms: 5,
        };
        let status = build_status(false, 0, DAY_MS, Some(&cache));
        assert_eq!(status.state, "trial");
        assert_eq!(status.trial_days_left, Some(6));
        assert_eq!(status.server_active, Some(false));
        assert_eq!(status.days_left, None);
    }

    #[test]
    fn status_server_fields_null_without_a_successful_check() {
        let status = build_status(false, 0, 0, None);
        assert_eq!(status.server_active, None);
        assert_eq!(status.days_left, None);
        let status = build_status(true, 0, 0, None);
        assert_eq!(status.server_active, None);
        assert_eq!(status.days_left, None);
    }

    #[test]
    fn status_days_left_tracks_a_real_expiry_date() {
        // 2026-07-18 UTC as days since the epoch.
        const TODAY_MS: u64 = 20_652 * DAY_MS;
        let cache = CachedCheck {
            active: true,
            expires: Some("2026-08-01".to_string()),
            reason: None,
            checked_at_ms: 1,
        };
        let status = build_status(false, 0, TODAY_MS, Some(&cache));
        assert_eq!(status.state, "active");
        assert_eq!(status.trial_days_left, None);
        assert_eq!(status.days_left, Some(14));
        // A date already past floors at 0 instead of going negative.
        let expired = CachedCheck {
            expires: Some("2026-07-01".to_string()),
            ..cache
        };
        let status = build_status(false, 0, TODAY_MS, Some(&expired));
        assert_eq!(status.days_left, Some(0));
    }

    #[test]
    fn status_serializes_contract_field_names() {
        let json = serde_json::to_value(build_status(false, 0, 0, None)).unwrap();
        for key in [
            "state",
            "trial_days_left",
            "server_active",
            "days_left",
            "expires",
            "last_checked_ms",
            "reason",
        ] {
            assert!(json.get(key).is_some(), "missing key {key}");
        }
    }

    #[test]
    fn status_surfaces_the_server_rejection_reason() {
        let cache = CachedCheck {
            active: false,
            expires: Some("2027-01-01".to_string()),
            reason: Some("device_limit".to_string()),
            checked_at_ms: 5,
        };
        let status = build_status(false, 0, TRIAL_MS, Some(&cache));
        assert_eq!(status.state, "inactive");
        assert_eq!(status.server_active, Some(false));
        assert_eq!(status.reason.as_deref(), Some("device_limit"));
        // A positive verdict carries no reason.
        let ok = CachedCheck {
            active: true,
            reason: None,
            ..cache
        };
        assert_eq!(build_status(false, 0, TRIAL_MS, Some(&ok)).reason, None);
    }
}
