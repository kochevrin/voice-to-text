//! Whisper model management: listing, streaming download, deletion, disk usage.

use std::path::PathBuf;

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use whispr_core::{model_download_url, model_size_bytes, MODEL_IDS};

use crate::i18n::{self, Msg};
use crate::state::{self, AppState};

const PROGRESS_EVERY_BYTES: u64 = 500 * 1024;

#[derive(Clone, Serialize)]
pub struct ModelInfo {
    pub id: String,
    pub size_bytes: u64,
    pub downloaded: bool,
}

#[derive(Clone, Serialize)]
pub struct DiskUsage {
    pub models_bytes: u64,
}

#[derive(Clone, Serialize)]
struct DownloadProgress<'a> {
    id: &'a str,
    downloaded: u64,
    total: u64,
}

fn model_file(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    Ok(state::models_dir(app)?.join(format!("ggml-{id}.bin")))
}

fn validate_id(app: &AppHandle, id: &str) -> Result<(), String> {
    if MODEL_IDS.contains(&id) {
        Ok(())
    } else {
        Err(i18n::t(&state::ui_language(app), Msg::UnknownModelId).replace("{id}", id))
    }
}

pub fn list_models(app: &AppHandle) -> Result<Vec<ModelInfo>, String> {
    let dir = state::models_dir(app)?;
    Ok(MODEL_IDS
        .iter()
        .map(|&id| {
            let path = dir.join(format!("ggml-{id}.bin"));
            match path.metadata() {
                Ok(meta) if meta.is_file() => ModelInfo {
                    id: id.to_string(),
                    size_bytes: meta.len(),
                    downloaded: true,
                },
                _ => ModelInfo {
                    id: id.to_string(),
                    size_bytes: model_size_bytes(id),
                    downloaded: false,
                },
            }
        })
        .collect())
}

/// Removes the model id from the in-flight set when the download ends,
/// whatever the exit path.
struct DownloadGuard {
    app: AppHandle,
    id: String,
}

impl Drop for DownloadGuard {
    fn drop(&mut self) {
        let state = self.app.state::<AppState>();
        state.downloads.lock().unwrap().remove(&self.id);
    }
}

/// Streams the model into `<file>.part`, emitting `model-download-progress`
/// roughly every 500 KB, then renames into place. Rejects a second download
/// of an id that is already in flight.
pub async fn download_model(app: &AppHandle, id: &str) -> Result<(), String> {
    validate_id(app, id)?;
    let lang = state::ui_language(app);
    {
        let state = app.state::<AppState>();
        let mut in_flight = state.downloads.lock().unwrap();
        if !in_flight.insert(id.to_string()) {
            return Err(i18n::t(&lang, Msg::ModelAlreadyDownloading).replace("{id}", id));
        }
    }
    let _in_flight = DownloadGuard {
        app: app.clone(),
        id: id.to_string(),
    };
    let dest = model_file(app, id)?;
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| e.to_string())?;
    }
    let part = dest.with_extension("bin.part");
    let url = model_download_url(id);

    let result = download_to(app, id, &url, &part).await;
    match result {
        Ok(total) => {
            tokio::fs::rename(&part, &dest)
                .await
                .map_err(|e| e.to_string())?;
            let _ = app.emit(
                "model-download-progress",
                DownloadProgress {
                    id,
                    downloaded: total,
                    total,
                },
            );
            Ok(())
        }
        Err(e) => {
            let _ = tokio::fs::remove_file(&part).await;
            Err(e)
        }
    }
}

async fn download_to(
    app: &AppHandle,
    id: &str,
    url: &str,
    part: &PathBuf,
) -> Result<u64, String> {
    use tokio::io::AsyncWriteExt;

    let resp = reqwest::get(url).await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(i18n::t(&state::ui_language(app), Msg::DownloadFailed)
            .replace("{status}", &resp.status().to_string()));
    }
    let total = resp.content_length().unwrap_or_else(|| model_size_bytes(id));

    let mut file = tokio::fs::File::create(part)
        .await
        .map_err(|e| e.to_string())?;
    let mut stream = resp.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut last_emit: u64 = 0;

    let _ = app.emit(
        "model-download-progress",
        DownloadProgress {
            id,
            downloaded: 0,
            total,
        },
    );
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        if downloaded - last_emit >= PROGRESS_EVERY_BYTES {
            last_emit = downloaded;
            let _ = app.emit(
                "model-download-progress",
                DownloadProgress {
                    id,
                    downloaded,
                    total,
                },
            );
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    Ok(downloaded)
}

pub fn delete_model(app: &AppHandle, id: &str) -> Result<(), String> {
    validate_id(app, id)?;
    let path = model_file(app, id)?;
    if path.is_file() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn disk_usage(app: &AppHandle) -> Result<DiskUsage, String> {
    let dir = state::models_dir(app)?;
    let mut total: u64 = 0;
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    total += meta.len();
                }
            }
        }
    }
    Ok(DiskUsage {
        models_bytes: total,
    })
}
