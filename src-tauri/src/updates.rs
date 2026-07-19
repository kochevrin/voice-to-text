//! Update check against the GitHub `releases/latest` API, per
//! docs/contracts.md ("Updates"): a manual `check_updates` command plus a
//! daily background check that emits `update-available`. Level 1 only — the
//! app never downloads or installs anything itself.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

const LATEST_RELEASE_API: &str =
    "https://api.github.com/repos/kochevrin/voice-to-text/releases/latest";
/// Fallback download destination when the API response carries no `html_url`.
const RELEASES_PAGE: &str = "https://github.com/kochevrin/voice-to-text/releases/latest";

const CHECK_TIMEOUT: Duration = Duration::from_secs(15);
const CHECK_INTERVAL: Duration = Duration::from_secs(24 * 60 * 60);

/// The `UpdateStatus` IPC shape (contract: `check_updates`).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct UpdateStatus {
    pub current: String,
    /// The latest published version, normalized ("0.4.0"); `None` when the
    /// release tag does not parse as a version.
    pub latest: Option<String>,
    pub update_available: bool,
    /// Where the Download button should send the user.
    pub url: String,
}

#[derive(Deserialize)]
struct LatestRelease {
    tag_name: String,
    #[serde(default)]
    html_url: Option<String>,
}

/// Parses `"v1.2.3"` / `"1.2.3"` into a comparable triple. Pure — unit
/// tested. Anything else (pre-releases, extra segments) is `None`: a tag we
/// cannot compare must never announce an update.
fn parse_version(tag: &str) -> Option<(u64, u64, u64)> {
    let tag = tag.trim();
    let tag = tag.strip_prefix('v').unwrap_or(tag);
    let mut parts = tag.split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts.next()?.parse().ok()?;
    if parts.next().is_some() {
        return None;
    }
    Some((major, minor, patch))
}

/// Builds the IPC shape from the app version and the fetched release tag.
/// Pure — unit tested.
fn build_status(current: &str, tag: &str, url: String) -> UpdateStatus {
    let current_v = parse_version(current);
    let latest_v = parse_version(tag);
    UpdateStatus {
        current: current.to_string(),
        latest: latest_v.map(|(a, b, c)| format!("{a}.{b}.{c}")),
        update_available: matches!((current_v, latest_v), (Some(c), Some(l)) if l > c),
        url,
    }
}

async fn fetch_latest() -> Result<LatestRelease, String> {
    let client = reqwest::Client::builder()
        .timeout(CHECK_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(LATEST_RELEASE_API)
        // The GitHub API rejects requests without a User-Agent.
        .header("User-Agent", "whispr-open")
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("update check request failed: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("update check failed with {status}"));
    }
    resp.json()
        .await
        .map_err(|e| format!("update check returned invalid JSON: {e}"))
}

/// `check_updates` command path. Unlike license checks this hard-errors on
/// network failure — the manual button wants to surface it.
pub async fn check_now(app: &AppHandle) -> Result<UpdateStatus, String> {
    let current = app.package_info().version.to_string();
    let release = fetch_latest().await?;
    let url = release.html_url.unwrap_or_else(|| RELEASES_PAGE.to_string());
    Ok(build_status(&current, &release.tag_name, url))
}

#[derive(Clone, Serialize)]
struct UpdateAvailablePayload {
    current: String,
    latest: String,
    url: String,
}

/// Daily quiet check; the first tick fires at startup. Emits
/// `update-available` when a newer published release exists; failures only
/// log at warn.
pub fn spawn_periodic_check(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(CHECK_INTERVAL);
        loop {
            interval.tick().await;
            match check_now(&app).await {
                Ok(status) if status.update_available => {
                    let _ = app.emit(
                        "update-available",
                        UpdateAvailablePayload {
                            current: status.current,
                            latest: status.latest.unwrap_or_default(),
                            url: status.url,
                        },
                    );
                }
                Ok(_) => {}
                Err(e) => tracing::warn!("{e}"),
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_version_accepts_plain_and_v_tags() {
        assert_eq!(parse_version("0.3.1"), Some((0, 3, 1)));
        assert_eq!(parse_version("v0.3.1"), Some((0, 3, 1)));
        assert_eq!(parse_version(" v10.20.30 "), Some((10, 20, 30)));
    }

    #[test]
    fn parse_version_rejects_anything_uncomparable() {
        for bad in ["", "v", "0.3", "0.3.1.2", "0.3.x", "0.3.1-rc1", "latest"] {
            assert_eq!(parse_version(bad), None, "expected None for {bad:?}");
        }
    }

    #[test]
    fn build_status_flags_newer_versions_only() {
        let s = build_status("0.3.1", "v0.4.0", "u".into());
        assert!(s.update_available);
        assert_eq!(s.latest.as_deref(), Some("0.4.0"));
        // Same and older versions are not updates.
        assert!(!build_status("0.4.0", "v0.4.0", "u".into()).update_available);
        assert!(!build_status("0.4.0", "v0.3.9", "u".into()).update_available);
        // Numeric compare, not lexicographic.
        assert!(build_status("0.9.0", "v0.10.0", "u".into()).update_available);
    }

    #[test]
    fn build_status_never_announces_an_unparseable_tag() {
        let s = build_status("0.3.1", "nightly", "u".into());
        assert!(!s.update_available);
        assert_eq!(s.latest, None);
        assert_eq!(s.current, "0.3.1");
    }

    #[test]
    fn update_status_serializes_contract_field_names() {
        let json = serde_json::to_value(build_status("0.3.1", "v0.4.0", "u".into())).unwrap();
        for key in ["current", "latest", "update_available", "url"] {
            assert!(json.get(key).is_some(), "missing key {key}");
        }
    }
}
