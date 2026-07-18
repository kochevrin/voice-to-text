//! Settings model persisted as JSON at `<app_data_dir>/settings.json`, plus
//! whisper model metadata helpers. Mirrors the schema in `docs/contracts.md`
//! and the TS `Settings` type in `src/lib/types.ts`.

use serde::{Deserialize, Serialize};

/// The 8 supported whisper.cpp model ids.
pub const MODEL_IDS: &[&str] = &[
    "tiny", "tiny.en", "base", "base.en", "small", "small.en", "medium", "medium.en",
];

/// Optional LLM post-processing of transcripts via Ollama.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PostprocSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_ollama_url")]
    pub ollama_url: String,
    #[serde(default = "default_postproc_model")]
    pub model: String,
    #[serde(default = "default_postproc_prompt")]
    pub prompt: String,
}

impl Default for PostprocSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            ollama_url: default_ollama_url(),
            model: default_postproc_model(),
            prompt: default_postproc_prompt(),
        }
    }
}

/// Optional OpenAI-compatible cloud transcription (Groq, OpenAI, any
/// compatible server).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CloudSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_cloud_base_url")]
    pub base_url: String,
    #[serde(default)]
    pub api_key: String,
    #[serde(default = "default_cloud_model")]
    pub model: String,
    #[serde(default = "default_true")]
    pub fallback_to_local: bool,
}

impl Default for CloudSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            base_url: default_cloud_base_url(),
            api_key: String::new(),
            model: default_cloud_model(),
            fallback_to_local: true,
        }
    }
}

/// Application settings. Every field has a serde default so partial or
/// outdated JSON deserializes to the documented defaults.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Settings {
    /// Normalized combo string, see `hotkey::normalize_hotkey`.
    #[serde(default = "default_hotkey")]
    pub hotkey: String,
    /// `"push_to_talk"` | `"toggle"`.
    #[serde(default = "default_hotkey_mode")]
    pub hotkey_mode: String,
    /// Input device name; `None` = system default.
    #[serde(default)]
    pub input_device: Option<String>,
    /// One of [`MODEL_IDS`].
    #[serde(default = "default_model")]
    pub model: String,
    /// `"auto"` or an ISO 639-1 code (`"en"`, `"ru"`, ...).
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_silence_timeout_ms")]
    pub silence_timeout_ms: u32,
    #[serde(default = "default_true")]
    pub vad_enabled: bool,
    #[serde(default = "default_true")]
    pub pill_enabled: bool,
    #[serde(default)]
    pub postproc: PostprocSettings,
    #[serde(default)]
    pub cloud: CloudSettings,
    #[serde(default)]
    pub onboarding_done: bool,
    #[serde(default)]
    pub paused: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            hotkey: default_hotkey(),
            hotkey_mode: default_hotkey_mode(),
            input_device: None,
            model: default_model(),
            language: default_language(),
            silence_timeout_ms: default_silence_timeout_ms(),
            vad_enabled: true,
            pill_enabled: true,
            postproc: PostprocSettings::default(),
            cloud: CloudSettings::default(),
            onboarding_done: false,
            paused: false,
        }
    }
}

fn default_hotkey() -> String {
    "Alt+Space".to_string()
}

fn default_hotkey_mode() -> String {
    "push_to_talk".to_string()
}

fn default_model() -> String {
    "base.en".to_string()
}

fn default_language() -> String {
    "auto".to_string()
}

fn default_silence_timeout_ms() -> u32 {
    800
}

fn default_true() -> bool {
    true
}

fn default_ollama_url() -> String {
    "http://localhost:11434".to_string()
}

fn default_postproc_model() -> String {
    "llama3.2:3b".to_string()
}

fn default_postproc_prompt() -> String {
    "Fix grammar and punctuation. Preserve meaning. Output ONLY the corrected text.".to_string()
}

fn default_cloud_base_url() -> String {
    "https://api.groq.com/openai/v1".to_string()
}

fn default_cloud_model() -> String {
    "whisper-large-v3-turbo".to_string()
}

/// Resolve the model id actually used for transcription given the configured
/// language.
///
/// `"en"` keeps the chosen model as-is. `"auto"` also keeps the chosen model
/// as-is: the contract's ".en"-strip rule is interpreted as applying only
/// when a concrete non-English language is selected — with auto-detection the
/// user's explicit model choice (possibly an English-only `.en` variant)
/// wins. Any other language strips a trailing `".en"` so the multilingual
/// variant of the same size is used.
pub fn effective_model_id(model: &str, language: &str) -> String {
    if language == "en" || language == "auto" {
        return model.to_string();
    }
    model.strip_suffix(".en").unwrap_or(model).to_string()
}

/// Download URL for a model id, per the contract:
/// `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-<id>.bin`.
pub fn model_download_url(id: &str) -> String {
    format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{id}.bin")
}

/// Approximate download size in bytes for a model id (real ggml file sizes:
/// tiny ~77.7 MB, base ~147.9 MB, small ~487.6 MB, medium ~1.53 GB; `.en`
/// variants are essentially the same size). Returns 0 for unknown ids.
pub fn model_size_bytes(id: &str) -> u64 {
    match id {
        "tiny" | "tiny.en" => 77_700_000,
        "base" | "base.en" => 147_900_000,
        "small" | "small.en" => 487_600_000,
        "medium" | "medium.en" => 1_530_000_000,
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_schema() {
        let s = Settings::default();
        assert_eq!(s.hotkey, "Alt+Space");
        assert_eq!(s.hotkey_mode, "push_to_talk");
        assert_eq!(s.input_device, None);
        assert_eq!(s.model, "base.en");
        assert_eq!(s.language, "auto");
        assert_eq!(s.silence_timeout_ms, 800);
        assert!(s.vad_enabled);
        assert!(s.pill_enabled);
        assert!(!s.onboarding_done);
        assert!(!s.paused);

        let p = s.postproc;
        assert!(!p.enabled);
        assert_eq!(p.ollama_url, "http://localhost:11434");
        assert_eq!(p.model, "llama3.2:3b");
        assert_eq!(
            p.prompt,
            "Fix grammar and punctuation. Preserve meaning. Output ONLY the corrected text."
        );

        let c = s.cloud;
        assert!(!c.enabled);
        assert_eq!(c.base_url, "https://api.groq.com/openai/v1");
        assert_eq!(c.api_key, "");
        assert_eq!(c.model, "whisper-large-v3-turbo");
        assert!(c.fallback_to_local);
    }

    #[test]
    fn serde_roundtrip() {
        let mut s = Settings::default();
        s.hotkey = "Ctrl+Shift+D".to_string();
        s.input_device = Some("USB Mic".to_string());
        s.postproc.enabled = true;
        s.cloud.enabled = true;
        s.cloud.api_key = "gsk_test".to_string();
        s.cloud.fallback_to_local = false;
        let json = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(back, s);
    }

    #[test]
    fn empty_json_deserializes_to_defaults() {
        let s: Settings = serde_json::from_str("{}").unwrap();
        assert_eq!(s, Settings::default());
    }

    #[test]
    fn partial_json_fills_missing_fields_with_defaults() {
        let s: Settings =
            serde_json::from_str(r#"{"model":"small","language":"ru","paused":true}"#).unwrap();
        assert_eq!(s.model, "small");
        assert_eq!(s.language, "ru");
        assert!(s.paused);
        // Everything else falls back to defaults.
        assert_eq!(s.hotkey, "Alt+Space");
        assert_eq!(s.hotkey_mode, "push_to_talk");
        assert_eq!(s.silence_timeout_ms, 800);
        assert!(s.vad_enabled);
        assert!(s.pill_enabled);
        assert_eq!(s.postproc, PostprocSettings::default());
        // A pre-cloud settings.json (no "cloud" key) gets the cloud defaults.
        assert_eq!(s.cloud, CloudSettings::default());
    }

    #[test]
    fn partial_postproc_fills_missing_fields_with_defaults() {
        let s: Settings = serde_json::from_str(r#"{"postproc":{"enabled":true}}"#).unwrap();
        assert!(s.postproc.enabled);
        assert_eq!(s.postproc.ollama_url, "http://localhost:11434");
        assert_eq!(s.postproc.model, "llama3.2:3b");
    }

    #[test]
    fn partial_cloud_fills_missing_fields_with_defaults() {
        let s: Settings =
            serde_json::from_str(r#"{"cloud":{"enabled":true,"api_key":"sk-x"}}"#).unwrap();
        assert!(s.cloud.enabled);
        assert_eq!(s.cloud.api_key, "sk-x");
        assert_eq!(s.cloud.base_url, "https://api.groq.com/openai/v1");
        assert_eq!(s.cloud.model, "whisper-large-v3-turbo");
        assert!(s.cloud.fallback_to_local);
    }

    #[test]
    fn unknown_fields_are_ignored() {
        let s: Settings =
            serde_json::from_str(r#"{"hotkey":"Ctrl+D","legacy_field":42}"#).unwrap();
        assert_eq!(s.hotkey, "Ctrl+D");
    }

    #[test]
    fn null_input_device_deserializes() {
        let s: Settings = serde_json::from_str(r#"{"input_device":null}"#).unwrap();
        assert_eq!(s.input_device, None);
        let s: Settings = serde_json::from_str(r#"{"input_device":"Mic"}"#).unwrap();
        assert_eq!(s.input_device, Some("Mic".to_string()));
    }

    #[test]
    fn serialized_json_uses_schema_field_names() {
        let json = serde_json::to_value(Settings::default()).unwrap();
        for key in [
            "hotkey",
            "hotkey_mode",
            "input_device",
            "model",
            "language",
            "silence_timeout_ms",
            "vad_enabled",
            "pill_enabled",
            "postproc",
            "cloud",
            "onboarding_done",
            "paused",
        ] {
            assert!(json.get(key).is_some(), "missing key {key}");
        }
        for key in ["enabled", "ollama_url", "model", "prompt"] {
            assert!(json["postproc"].get(key).is_some(), "missing postproc key {key}");
        }
        for key in ["enabled", "base_url", "api_key", "model", "fallback_to_local"] {
            assert!(json["cloud"].get(key).is_some(), "missing cloud key {key}");
        }
    }

    #[test]
    fn effective_model_id_matrix() {
        // "en" and "auto" keep the chosen model as-is.
        assert_eq!(effective_model_id("base.en", "en"), "base.en");
        assert_eq!(effective_model_id("base.en", "auto"), "base.en");
        assert_eq!(effective_model_id("base", "en"), "base");
        assert_eq!(effective_model_id("medium", "auto"), "medium");
        // Concrete non-English languages strip the ".en" suffix.
        assert_eq!(effective_model_id("base.en", "ru"), "base");
        assert_eq!(effective_model_id("tiny.en", "de"), "tiny");
        assert_eq!(effective_model_id("medium.en", "fr"), "medium");
        // Multilingual models are untouched for any language.
        assert_eq!(effective_model_id("small", "ru"), "small");
    }

    #[test]
    fn model_ids_contains_the_8_ids() {
        assert_eq!(MODEL_IDS.len(), 8);
        for id in ["tiny", "tiny.en", "base", "base.en", "small", "small.en", "medium", "medium.en"]
        {
            assert!(MODEL_IDS.contains(&id), "missing id {id}");
        }
    }

    #[test]
    fn model_download_urls() {
        assert_eq!(
            model_download_url("base.en"),
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin"
        );
        assert_eq!(
            model_download_url("tiny"),
            "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin"
        );
    }

    #[test]
    fn model_sizes() {
        assert_eq!(model_size_bytes("tiny"), 77_700_000);
        assert_eq!(model_size_bytes("tiny.en"), 77_700_000);
        assert_eq!(model_size_bytes("base"), 147_900_000);
        assert_eq!(model_size_bytes("base.en"), 147_900_000);
        assert_eq!(model_size_bytes("small"), 487_600_000);
        assert_eq!(model_size_bytes("small.en"), 487_600_000);
        assert_eq!(model_size_bytes("medium"), 1_530_000_000);
        assert_eq!(model_size_bytes("medium.en"), 1_530_000_000);
        assert_eq!(model_size_bytes("bogus"), 0);
        for id in MODEL_IDS {
            assert!(model_size_bytes(id) > 0, "size missing for {id}");
        }
    }
}
