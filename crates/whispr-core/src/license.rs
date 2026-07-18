//! Honor-system licensing verdict logic, per docs/contracts.md ("Licensing").
//! Pure: persistence, HTTP and scheduling live in src-tauri.

use serde::{Deserialize, Serialize};

/// One day in milliseconds.
pub const DAY_MS: u64 = 24 * 60 * 60 * 1000;

/// Trial length from first launch: 7 days.
pub const TRIAL_MS: u64 = 7 * DAY_MS;

/// The license server URL baked in by the distributor of this build.
pub const DEFAULT_LICENSE_SERVER_URL: &str = "https://license.kk-lab.net";

/// The `license` settings block. `key` defaults to empty; `server_url`
/// defaults to [`DEFAULT_LICENSE_SERVER_URL`]. Clearing `server_url` turns
/// the whole licensing system off (the open-source escape hatch).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LicenseSettings {
    #[serde(default)]
    pub key: String,
    #[serde(default = "default_server_url")]
    pub server_url: String,
}

fn default_server_url() -> String {
    DEFAULT_LICENSE_SERVER_URL.to_string()
}

impl Default for LicenseSettings {
    fn default() -> Self {
        Self {
            key: String::new(),
            server_url: default_server_url(),
        }
    }
}

/// The cached last successful server response, persisted in
/// `<app_data>/license.json` (`last`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CachedCheck {
    pub active: bool,
    #[serde(default)]
    pub expires: Option<String>,
    pub checked_at_ms: u64,
}

/// Effective licensing verdict. Only `Inactive` blocks dictation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LicenseState {
    Disabled,
    Trial,
    Active,
    Inactive,
    Unverified,
}

impl LicenseState {
    /// The IPC string form used by `LicenseStatus.state`.
    pub fn as_str(self) -> &'static str {
        match self {
            LicenseState::Disabled => "disabled",
            LicenseState::Trial => "trial",
            LicenseState::Active => "active",
            LicenseState::Inactive => "inactive",
            LicenseState::Unverified => "unverified",
        }
    }
}

/// Computes the effective license state:
/// - empty `server_url` → `Disabled` (licensing off, app fully functional);
/// - within 7 days of first launch → `Trial` (grants usage even over a
///   cached negative verdict — the trial is checked first);
/// - afterwards the cached server verdict decides: `Active` / `Inactive`;
/// - no cache at all → `Unverified` (honor system: works).
pub fn evaluate(
    server_url_empty: bool,
    installed_at_ms: u64,
    now_ms: u64,
    cache: Option<&CachedCheck>,
) -> LicenseState {
    if server_url_empty {
        return LicenseState::Disabled;
    }
    if now_ms.saturating_sub(installed_at_ms) < TRIAL_MS {
        return LicenseState::Trial;
    }
    match cache {
        Some(check) if check.active => LicenseState::Active,
        Some(_) => LicenseState::Inactive,
        None => LicenseState::Unverified,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cache(active: bool) -> CachedCheck {
        CachedCheck {
            active,
            expires: None,
            checked_at_ms: 0,
        }
    }

    #[test]
    fn disabled_when_url_empty_regardless_of_anything() {
        // No trial left, no cache.
        assert_eq!(evaluate(true, 0, TRIAL_MS * 10, None), LicenseState::Disabled);
        // Even within the trial window.
        assert_eq!(evaluate(true, 0, 0, None), LicenseState::Disabled);
        // Even with a cached verdict, positive or negative.
        assert_eq!(
            evaluate(true, 0, TRIAL_MS * 10, Some(&cache(true))),
            LicenseState::Disabled
        );
        assert_eq!(
            evaluate(true, 0, TRIAL_MS * 10, Some(&cache(false))),
            LicenseState::Disabled
        );
    }

    #[test]
    fn trial_within_seven_days() {
        assert_eq!(evaluate(false, 0, 0, None), LicenseState::Trial);
        assert_eq!(evaluate(false, 0, TRIAL_MS - 1, None), LicenseState::Trial);
        let installed = 1_700_000_000_000;
        assert_eq!(
            evaluate(false, installed, installed + DAY_MS, None),
            LicenseState::Trial
        );
    }

    #[test]
    fn trial_overrides_cached_verdicts() {
        // The trial grants usage even when a cached response says inactive.
        assert_eq!(
            evaluate(false, 0, TRIAL_MS - 1, Some(&cache(false))),
            LicenseState::Trial
        );
        assert_eq!(
            evaluate(false, 0, TRIAL_MS - 1, Some(&cache(true))),
            LicenseState::Trial
        );
    }

    #[test]
    fn trial_ends_exactly_at_seven_days() {
        // now - installed == 7 days is no longer trial; the cache takes over.
        assert_eq!(evaluate(false, 0, TRIAL_MS, None), LicenseState::Unverified);
        assert_eq!(
            evaluate(false, 0, TRIAL_MS, Some(&cache(true))),
            LicenseState::Active
        );
        assert_eq!(
            evaluate(false, 0, TRIAL_MS, Some(&cache(false))),
            LicenseState::Inactive
        );
    }

    #[test]
    fn cache_decides_after_trial() {
        let now = TRIAL_MS * 3;
        assert_eq!(
            evaluate(false, 0, now, Some(&cache(true))),
            LicenseState::Active
        );
        assert_eq!(
            evaluate(false, 0, now, Some(&cache(false))),
            LicenseState::Inactive
        );
    }

    #[test]
    fn unverified_without_cache_after_trial() {
        assert_eq!(evaluate(false, 0, TRIAL_MS * 3, None), LicenseState::Unverified);
    }

    #[test]
    fn clock_before_install_counts_as_trial() {
        // A clock set before installed_at (skew) saturates to elapsed 0.
        assert_eq!(evaluate(false, 1000, 0, None), LicenseState::Trial);
    }

    #[test]
    fn state_strings_match_contract() {
        assert_eq!(LicenseState::Disabled.as_str(), "disabled");
        assert_eq!(LicenseState::Trial.as_str(), "trial");
        assert_eq!(LicenseState::Active.as_str(), "active");
        assert_eq!(LicenseState::Inactive.as_str(), "inactive");
        assert_eq!(LicenseState::Unverified.as_str(), "unverified");
    }

    #[test]
    fn license_settings_defaults_and_serde() {
        let l = LicenseSettings::default();
        assert_eq!(l.key, "");
        assert_eq!(l.server_url, DEFAULT_LICENSE_SERVER_URL);
        let l: LicenseSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(l, LicenseSettings::default());
        // A saved empty server_url stays empty (licensing off) — only a
        // MISSING field gets the default.
        let l: LicenseSettings = serde_json::from_str(r#"{"server_url":""}"#).unwrap();
        assert_eq!(l.server_url, "");
    }

    #[test]
    fn cached_check_serde_roundtrip_and_defaults() {
        let c = CachedCheck {
            active: true,
            expires: Some("2027-01-31".to_string()),
            checked_at_ms: 42,
        };
        let json = serde_json::to_string(&c).unwrap();
        assert_eq!(serde_json::from_str::<CachedCheck>(&json).unwrap(), c);
        // `expires` may be absent (older cache file).
        let c: CachedCheck =
            serde_json::from_str(r#"{"active":false,"checked_at_ms":7}"#).unwrap();
        assert!(!c.active);
        assert_eq!(c.expires, None);
        assert_eq!(c.checked_at_ms, 7);
    }
}
