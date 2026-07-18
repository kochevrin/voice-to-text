//! Optional LLM post-processing through a local Ollama instance.
//! Any failure falls back silently to the original text (per spec).

use std::time::Duration;

use serde::Deserialize;
use serde_json::json;
use whispr_core::PostprocSettings;

const OLLAMA_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Deserialize)]
struct GenerateResponse {
    response: String,
}

/// Returns the post-processed text, or the original on any error.
pub async fn apply(settings: &PostprocSettings, text: &str) -> String {
    if !settings.enabled || text.trim().is_empty() {
        return text.to_string();
    }
    match run(settings, text).await {
        Ok(processed) if !processed.trim().is_empty() => processed.trim().to_string(),
        Ok(_) => {
            tracing::warn!("post-processing returned empty output; keeping original text");
            text.to_string()
        }
        Err(e) => {
            tracing::warn!("post-processing failed ({e}); keeping original text");
            text.to_string()
        }
    }
}

async fn run(settings: &PostprocSettings, text: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(OLLAMA_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;
    let url = format!(
        "{}/api/generate",
        settings.ollama_url.trim_end_matches('/')
    );
    let body = json!({
        "model": settings.model,
        "prompt": format!("{}\n\n{}", settings.prompt, text),
        "stream": false,
    });
    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let parsed: GenerateResponse = resp.json().await.map_err(|e| e.to_string())?;
    Ok(parsed.response)
}
