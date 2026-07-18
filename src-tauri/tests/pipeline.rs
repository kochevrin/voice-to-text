//! End-to-end pipeline self-test: real whisper-cli sidecar + real model +
//! bundled fixture WAV through the app's own invocation code.
//!
//! Skips (with a notice) when WHISPR_TEST_MODEL is unset, so plain
//! `cargo test --workspace` stays green on machines without a downloaded model.

use std::path::{Path, PathBuf};

#[tokio::test]
async fn transcribes_fixture_wav() {
    let Some(model) = std::env::var_os("WHISPR_TEST_MODEL") else {
        eprintln!("WHISPR_TEST_MODEL not set — skipping pipeline self-test");
        return;
    };
    let model = PathBuf::from(model);
    assert!(model.is_file(), "WHISPR_TEST_MODEL does not exist: {model:?}");

    let bin = whispr_open_lib::whisper::sidecar_path()
        .expect("whisper-cli sidecar binary must be present (run sidecar build script)");
    let wav = Path::new(env!("CARGO_MANIFEST_DIR")).join("../test/fixtures/jfk.wav");
    assert!(wav.is_file(), "fixture WAV missing: {wav:?}");

    let text = whispr_open_lib::whisper::run_whisper(&bin, &model, &wav, "en")
        .await
        .expect("transcription must succeed");

    assert!(!text.is_empty(), "transcript must be non-empty");
    assert!(
        text.to_lowercase().contains("country"),
        "expected the JFK quote, got: {text}"
    );
}
