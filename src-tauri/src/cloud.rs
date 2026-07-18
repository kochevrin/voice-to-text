//! Optional cloud transcription via an OpenAI-compatible API
//! (Groq, OpenAI, any compatible server), per docs/contracts.md.

use std::path::Path;
use std::time::Duration;

use serde::Deserialize;
use whispr_core::Settings;

use crate::i18n::{self, Msg};

const CLOUD_TIMEOUT: Duration = Duration::from_secs(30);

/// Max chars of the response body kept in error messages.
const BODY_TAIL_CHARS: usize = 200;

#[derive(Deserialize)]
struct TranscriptionResponse {
    text: String,
}

/// Joins the base URL with the transcription path, tolerating a trailing
/// slash. Pure — unit tested.
fn endpoint_url(base_url: &str) -> String {
    format!("{}/audio/transcriptions", base_url.trim_end_matches('/'))
}

/// The `language` form part to send: `None` with auto-detection (the server
/// detects the language), otherwise the concrete code. Pure — unit tested.
fn language_part(language: &str) -> Option<&str> {
    if language == "auto" {
        None
    } else {
        Some(language)
    }
}

/// Last [`BODY_TAIL_CHARS`] chars of an error response body.
fn body_tail(body: &str) -> &str {
    let trimmed = body.trim();
    match trimmed.char_indices().rev().nth(BODY_TAIL_CHARS - 1) {
        Some((idx, _)) => &trimmed[idx..],
        None => trimmed,
    }
}

/// POSTs the recorded WAV to `{base_url}/audio/transcriptions` and returns
/// the trimmed transcript.
pub async fn transcribe(settings: &Settings, wav: &Path) -> Result<String, String> {
    let lang = settings.ui_language.as_str();
    let bytes = tokio::fs::read(wav).await.map_err(|e| {
        i18n::t(lang, Msg::CloudReadFailed).replace("{detail}", &e.to_string())
    })?;

    let file = reqwest::multipart::Part::bytes(bytes)
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| e.to_string())?;
    let mut form = reqwest::multipart::Form::new()
        .part("file", file)
        .text("model", settings.cloud.model.clone())
        .text("response_format", "json");
    if let Some(language) = language_part(&settings.language) {
        form = form.text("language", language.to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(CLOUD_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post(endpoint_url(&settings.cloud.base_url))
        .bearer_auth(settings.cloud.api_key.trim())
        .multipart(form)
        .send()
        .await
        .map_err(|e| {
            i18n::t(lang, Msg::CloudRequestFailed).replace("{detail}", &e.to_string())
        })?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(i18n::t(lang, Msg::CloudFailedWithStatus)
            .replace("{status}", &status.to_string())
            .replace("{detail}", body_tail(&body)));
    }
    let parsed: TranscriptionResponse = resp.json().await.map_err(|e| {
        i18n::t(lang, Msg::CloudInvalidJson).replace("{detail}", &e.to_string())
    })?;
    Ok(parsed.text.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_url_joins_base() {
        assert_eq!(
            endpoint_url("https://api.groq.com/openai/v1"),
            "https://api.groq.com/openai/v1/audio/transcriptions"
        );
    }

    #[test]
    fn endpoint_url_tolerates_trailing_slash() {
        assert_eq!(
            endpoint_url("https://api.openai.com/v1/"),
            "https://api.openai.com/v1/audio/transcriptions"
        );
    }

    #[test]
    fn language_part_skips_auto() {
        assert_eq!(language_part("auto"), None);
        assert_eq!(language_part("en"), Some("en"));
        assert_eq!(language_part("ru"), Some("ru"));
    }

    #[test]
    fn body_tail_truncates_long_bodies() {
        assert_eq!(body_tail("short error"), "short error");
        assert_eq!(body_tail("  padded  "), "padded");
        let long = "a".repeat(50) + &"b".repeat(300);
        let tail = body_tail(&long);
        assert_eq!(tail.chars().count(), BODY_TAIL_CHARS);
        assert_eq!(tail, "b".repeat(BODY_TAIL_CHARS));
    }
}
