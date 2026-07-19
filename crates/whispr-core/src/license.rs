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
    /// Why the server said no (`"device_limit"`); `None` on a positive
    /// verdict or from servers that predate the field.
    #[serde(default)]
    pub reason: Option<String>,
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

/// True for a leap year in the proleptic Gregorian calendar.
fn is_leap(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

/// Number of days in `month` (1-12); 0 for an out-of-range month.
fn days_in_month(year: i64, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap(year) => 29,
        2 => 28,
        _ => 0,
    }
}

/// Days since 1970-01-01 for a civil date (Howard Hinnant's `days_from_civil`,
/// proleptic Gregorian). `month` and `day` must already be valid.
fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    // Shift the year so that March starts it — leap day lands last.
    let y = if month <= 2 { year - 1 } else { year };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400; // [0, 399]
    let shifted_month = if month > 2 { month - 3 } else { month + 9 };
    let doy = (153 * i64::from(shifted_month) + 2) / 5 + i64::from(day) - 1; // [0, 365]
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy; // [0, 146096]
    era * 146097 + doe - 719468
}

/// Parses a strict `YYYY-MM-DD` date into days since the Unix epoch (UTC).
/// `None` for anything that is not a real calendar date — no extra crates,
/// no leniency for `2027-1-5`, signs or whitespace.
fn epoch_day(date: &str) -> Option<i64> {
    fn digits(field: &str, len: usize) -> Option<&str> {
        (field.len() == len && field.bytes().all(|b| b.is_ascii_digit())).then_some(field)
    }
    let mut parts = date.split('-');
    let year: i64 = digits(parts.next()?, 4)?.parse().ok()?;
    let month: u32 = digits(parts.next()?, 2)?.parse().ok()?;
    let day: u32 = digits(parts.next()?, 2)?.parse().ok()?;
    if parts.next().is_some() || day > days_in_month(year, month) || day == 0 {
        return None;
    }
    Some(days_from_civil(year, month, day))
}

/// Days remaining on the SUBSCRIPTION: the cached `expires` date minus today,
/// both as UTC calendar days. Partial days round up (a date one day out reads
/// as 1 until it arrives), a date already past reads as 0, and a missing or
/// malformed date yields `None`. Independent of the trial countdown.
pub fn subscription_days_left(expires: Option<&str>, now_ms: u64) -> Option<u64> {
    let end = epoch_day(expires?)?;
    let today = (now_ms / DAY_MS) as i64;
    Some(end.saturating_sub(today).max(0) as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Milliseconds at 00:00 UTC on the given date; panics on a bad date.
    fn at_utc(date: &str) -> u64 {
        epoch_day(date).unwrap() as u64 * DAY_MS
    }

    fn cache(active: bool) -> CachedCheck {
        CachedCheck {
            active,
            expires: None,
            reason: None,
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
    fn epoch_day_anchors_and_leap_years() {
        assert_eq!(epoch_day("1970-01-01"), Some(0));
        assert_eq!(epoch_day("1970-01-02"), Some(1));
        assert_eq!(epoch_day("1969-12-31"), Some(-1));
        // 2000 is a leap year (divisible by 400): Feb 29 exists.
        assert_eq!(epoch_day("2000-02-29"), Some(11016));
        // 1900 is NOT a leap year (divisible by 100, not 400).
        assert_eq!(epoch_day("1900-02-29"), None);
        assert_eq!(epoch_day("2024-02-29"), Some(19782));
        assert_eq!(epoch_day("2023-02-29"), None);
        // A full year apart is 365 days (366 across a leap day).
        let a = epoch_day("2023-03-01").unwrap();
        let b = epoch_day("2024-03-01").unwrap();
        assert_eq!(b - a, 366);
    }

    #[test]
    fn epoch_day_rejects_malformed() {
        for bad in [
            "",
            "2027",
            "2027-01",
            "2027-01-31-01",
            "2027-1-5",     // unpadded
            "27-01-31",     // 2-digit year
            "2027-13-01",   // month out of range
            "2027-00-10",   // month zero
            "2027-01-32",   // day out of range
            "2027-04-31",   // April has 30 days
            "2027-01-00",   // day zero
            "+027-01-31",   // sign
            "2027/01/31",   // wrong separator
            "2027-01-3a",   // non-digit
            " 2027-01-31",  // whitespace
            "2027-01-31T00:00:00Z",
        ] {
            assert_eq!(epoch_day(bad), None, "expected None for {bad:?}");
        }
    }

    #[test]
    fn subscription_days_left_counts_calendar_days() {
        let now = at_utc("2026-07-18");
        assert_eq!(subscription_days_left(Some("2026-07-18"), now), Some(0));
        assert_eq!(subscription_days_left(Some("2026-07-19"), now), Some(1));
        assert_eq!(subscription_days_left(Some("2027-07-18"), now), Some(365));
        // Partial days round up: late in the day, tomorrow still reads as 1.
        let late = now + DAY_MS - 1;
        assert_eq!(subscription_days_left(Some("2026-07-19"), late), Some(1));
    }

    #[test]
    fn subscription_days_left_floors_past_dates_at_zero() {
        let now = at_utc("2026-07-18");
        assert_eq!(subscription_days_left(Some("2026-07-17"), now), Some(0));
        assert_eq!(subscription_days_left(Some("1999-01-01"), now), Some(0));
    }

    #[test]
    fn subscription_days_left_none_without_a_usable_date() {
        let now = at_utc("2026-07-18");
        assert_eq!(subscription_days_left(None, now), None);
        assert_eq!(subscription_days_left(Some("not-a-date"), now), None);
        assert_eq!(subscription_days_left(Some(""), now), None);
    }

    #[test]
    fn subscription_days_left_spans_a_leap_day() {
        // 2024-02-28 → 2024-03-01 is 2 days (Feb 29 exists in 2024).
        assert_eq!(
            subscription_days_left(Some("2024-03-01"), at_utc("2024-02-28")),
            Some(2)
        );
        // 2023-02-28 → 2023-03-01 is 1 day.
        assert_eq!(
            subscription_days_left(Some("2023-03-01"), at_utc("2023-02-28")),
            Some(1)
        );
    }

    #[test]
    fn cached_check_serde_roundtrip_and_defaults() {
        let c = CachedCheck {
            active: true,
            expires: Some("2027-01-31".to_string()),
            reason: None,
            checked_at_ms: 42,
        };
        let json = serde_json::to_string(&c).unwrap();
        assert_eq!(serde_json::from_str::<CachedCheck>(&json).unwrap(), c);
        // `expires` and `reason` may be absent (older cache file).
        let c: CachedCheck =
            serde_json::from_str(r#"{"active":false,"checked_at_ms":7}"#).unwrap();
        assert!(!c.active);
        assert_eq!(c.expires, None);
        assert_eq!(c.reason, None);
        assert_eq!(c.checked_at_ms, 7);
        let c: CachedCheck = serde_json::from_str(
            r#"{"active":false,"reason":"device_limit","checked_at_ms":7}"#,
        )
        .unwrap();
        assert_eq!(c.reason.as_deref(), Some("device_limit"));
    }
}
