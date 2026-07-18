//! whisper.cpp sidecar: locating the binary and running transcription.

use std::ffi::OsString;
use std::path::{Path, PathBuf};

use tauri::AppHandle;
use whispr_core::effective_model_id;

use crate::state;

const SIDECAR_HINT: &str =
    "whisper-cli sidecar not found — build it with sidecar/whisper/build-<os>.sh and restart the app";

fn host_triple() -> &'static str {
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    return "x86_64-unknown-linux-gnu";
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    return "aarch64-unknown-linux-gnu";
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    return "x86_64-apple-darwin";
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    return "aarch64-apple-darwin";
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    return "x86_64-pc-windows-msvc";
    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    return "aarch64-pc-windows-msvc";
    #[cfg(not(any(
        all(target_os = "linux", any(target_arch = "x86_64", target_arch = "aarch64")),
        all(target_os = "macos", any(target_arch = "x86_64", target_arch = "aarch64")),
        all(target_os = "windows", any(target_arch = "x86_64", target_arch = "aarch64")),
    )))]
    return "unknown";
}

const EXE_SUFFIX: &str = if cfg!(windows) { ".exe" } else { "" };

/// Resolves the whisper-cli sidecar. In a bundled app Tauri places it next to
/// the main executable under its plain name; in dev we fall back to the
/// workspace `binaries/whisper-cli-<host-triple>` file.
pub fn sidecar_path() -> Result<PathBuf, String> {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let bundled = dir.join(format!("whisper-cli{EXE_SUFFIX}"));
            if bundled.is_file() {
                return Ok(bundled);
            }
        }
    }
    let dev = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("binaries")
        .join(format!("whisper-cli-{}{}", host_triple(), EXE_SUFFIX));
    if dev.is_file() {
        return Ok(dev);
    }
    Err(SIDECAR_HINT.to_string())
}

/// Builds the whisper-cli argument list. Pure — unit tested.
pub fn build_args(model: &Path, wav: &Path, language: &str, threads: usize) -> Vec<OsString> {
    vec![
        OsString::from("-m"),
        model.as_os_str().to_os_string(),
        OsString::from("-f"),
        wav.as_os_str().to_os_string(),
        OsString::from("-l"),
        OsString::from(language),
        OsString::from("-nt"),
        OsString::from("--no-prints"),
        OsString::from("-t"),
        OsString::from(threads.to_string()),
    ]
}

fn thread_count() -> usize {
    std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(8)
}

/// Runs whisper-cli on a 16-kHz mono WAV and returns the trimmed transcript.
/// Model and language come from the current settings.
pub async fn transcribe(app: &AppHandle, wav: &Path) -> Result<String, String> {
    let settings = state::current_settings(app);
    let model_id = effective_model_id(&settings.model, &settings.language);
    let model_path = state::models_dir(app)?.join(format!("ggml-{model_id}.bin"));
    if !model_path.is_file() {
        return Err(format!(
            "model \"{model_id}\" is not downloaded — open Settings and download it first"
        ));
    }
    let bin = sidecar_path()?;
    run_whisper(&bin, &model_path, wav, &settings.language).await
}

/// Spawns whisper-cli with explicit paths and returns the trimmed transcript.
/// Split out of [`transcribe`] so the pipeline self-test can exercise the real
/// sidecar invocation without a running Tauri app.
pub async fn run_whisper(
    bin: &Path,
    model: &Path,
    wav: &Path,
    language: &str,
) -> Result<String, String> {
    let args = build_args(model, wav, language, thread_count());

    let mut cmd = tokio::process::Command::new(bin);
    cmd.args(&args);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW

    let output = cmd
        .output()
        .await
        .map_err(|e| format!("failed to run whisper-cli: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail: String = stderr
            .lines()
            .rev()
            .take(3)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join(" | ");
        return Err(format!(
            "whisper-cli exited with {}: {}",
            output.status, tail
        ));
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_args_exact() {
        let args = build_args(
            Path::new("/data/models/ggml-base.en.bin"),
            Path::new("/tmp/rec.wav"),
            "auto",
            8,
        );
        let expected: Vec<OsString> = [
            "-m",
            "/data/models/ggml-base.en.bin",
            "-f",
            "/tmp/rec.wav",
            "-l",
            "auto",
            "-nt",
            "--no-prints",
            "-t",
            "8",
        ]
        .into_iter()
        .map(OsString::from)
        .collect();
        assert_eq!(args, expected);
    }

    #[test]
    fn thread_count_capped() {
        assert!(thread_count() >= 1);
        assert!(thread_count() <= 8);
    }
}
