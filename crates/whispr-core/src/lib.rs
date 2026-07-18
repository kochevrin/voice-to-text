//! Pure-logic core for whispr-open: VAD stop trigger, hotkey normalization,
//! text-injection planning, and the settings model. No system dependencies.
//!
//! Public API is specified in `docs/contracts.md` ("whispr-core public API").

pub mod hotkey;
pub mod inject;
pub mod license;
pub mod settings;
pub mod vad;

pub use hotkey::{display_hotkey, normalize_hotkey, HotkeyError};
pub use inject::{build_inject_plan, InjectMethod, InjectPlan, PlatformCaps};
pub use license::{CachedCheck, LicenseSettings, LicenseState};
pub use settings::{
    effective_model_id, model_download_url, model_size_bytes, CloudSettings, PostprocSettings,
    Settings, MODEL_IDS,
};
pub use vad::{VadConfig, VadDecision, VadTrigger};
