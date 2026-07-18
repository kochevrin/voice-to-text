//! Recording session: collects 16-kHz mono samples on a dedicated thread,
//! optionally auto-stopping via WebRTC VAD + `whispr_core::VadTrigger`.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::Duration;

use webrtc_vad::{SampleRate, Vad, VadMode};
use whispr_core::{VadConfig, VadDecision, VadTrigger};

use crate::audio::{self, TARGET_SAMPLE_RATE};

/// Hard cap on a single recording: 120 s.
pub const MAX_RECORDING_SECS: u32 = 120;
const MAX_SAMPLES: usize = (MAX_RECORDING_SECS as usize) * TARGET_SAMPLE_RATE as usize;
/// 30 ms at 16 kHz — the only frame size we feed to webrtc-vad.
const VAD_FRAME_SAMPLES: usize = 480;

pub struct RecorderConfig {
    pub device_name: Option<String>,
    pub vad_enabled: bool,
    pub silence_timeout_ms: u32,
    /// Test/onboarding session: the result must not be injected.
    pub test: bool,
}

pub struct RecorderHandle {
    stop: Arc<AtomicBool>,
    join: Option<std::thread::JoinHandle<Result<Vec<f32>, String>>>,
    pub test: bool,
}

impl RecorderHandle {
    /// Signals the capture thread to stop and returns the collected samples.
    pub fn stop(mut self) -> Result<Vec<f32>, String> {
        self.stop.store(true, Ordering::Relaxed);
        match self.join.take().expect("stop called once").join() {
            Ok(result) => result,
            Err(_) => Err("recorder thread panicked".to_string()),
        }
    }
}

impl Drop for RecorderHandle {
    fn drop(&mut self) {
        // If the handle is dropped without stop(), make the thread exit.
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// Starts capturing. `on_auto_stop` fires (once, from the capture thread) when
/// VAD detects end of speech or the hard cap is hit — but not on manual stop.
pub fn start(
    cfg: RecorderConfig,
    on_auto_stop: impl FnOnce() + Send + 'static,
) -> Result<RecorderHandle, String> {
    let stop = Arc::new(AtomicBool::new(false));
    let stop_thread = stop.clone();
    let test = cfg.test;
    let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();

    let join = std::thread::Builder::new()
        .name("whispr-recorder".to_string())
        .spawn(move || run_capture(cfg, stop_thread, ready_tx, on_auto_stop))
        .map_err(|e| e.to_string())?;

    match ready_rx.recv_timeout(Duration::from_secs(3)) {
        Ok(Ok(())) => Ok(RecorderHandle {
            stop,
            join: Some(join),
            test,
        }),
        Ok(Err(e)) => {
            let _ = join.join();
            Err(e)
        }
        Err(_) => {
            stop.store(true, Ordering::Relaxed);
            Err("audio input did not start in time".to_string())
        }
    }
}

fn run_capture(
    cfg: RecorderConfig,
    stop: Arc<AtomicBool>,
    ready_tx: mpsc::Sender<Result<(), String>>,
    on_auto_stop: impl FnOnce() + Send + 'static,
) -> Result<Vec<f32>, String> {
    use cpal::traits::StreamTrait;

    let (tx, rx) = mpsc::channel::<Vec<f32>>();
    let stream = match audio::build_input_stream(cfg.device_name.as_deref(), tx) {
        Ok(s) => s,
        Err(e) => {
            let _ = ready_tx.send(Err(e.clone()));
            return Err(e);
        }
    };
    if let Err(e) = stream.play() {
        let msg = e.to_string();
        let _ = ready_tx.send(Err(msg.clone()));
        return Err(msg);
    }
    let _ = ready_tx.send(Ok(()));

    let mut vad = if cfg.vad_enabled {
        Some(VadState::new(cfg.silence_timeout_ms))
    } else {
        None
    };
    let mut samples: Vec<f32> = Vec::with_capacity(TARGET_SAMPLE_RATE as usize * 8);
    let mut auto_stopped = false;

    'capture: loop {
        if stop.load(Ordering::Relaxed) {
            break;
        }
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(chunk) => {
                samples.extend_from_slice(&chunk);
                if let Some(v) = vad.as_mut() {
                    if v.feed(&chunk) {
                        tracing::debug!("VAD end-of-speech after {} samples", samples.len());
                        auto_stopped = true;
                        break 'capture;
                    }
                }
                if samples.len() >= MAX_SAMPLES {
                    samples.truncate(MAX_SAMPLES);
                    tracing::info!("recording hit the {MAX_RECORDING_SECS}s hard cap");
                    auto_stopped = true;
                    break 'capture;
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                tracing::warn!("audio stream ended unexpectedly");
                break 'capture;
            }
        }
    }

    drop(stream);
    if auto_stopped && !stop.load(Ordering::Relaxed) {
        on_auto_stop();
    }
    Ok(samples)
}

/// webrtc-vad classifier + whispr-core stop trigger. Lives on the capture
/// thread because `webrtc_vad::Vad` is `!Send`.
struct VadState {
    vad: Vad,
    trigger: VadTrigger,
    pending: Vec<i16>,
}

impl VadState {
    fn new(silence_timeout_ms: u32) -> Self {
        Self {
            vad: Vad::new_with_rate_and_mode(SampleRate::Rate16kHz, VadMode::Aggressive),
            trigger: VadTrigger::new(VadConfig {
                frame_ms: 30,
                silence_timeout_ms,
                min_speech_ms: 200,
            }),
            pending: Vec::with_capacity(VAD_FRAME_SAMPLES * 4),
        }
    }

    /// Feeds new samples; returns true when the trigger decides to stop.
    fn feed(&mut self, chunk: &[f32]) -> bool {
        self.pending.extend(chunk.iter().map(|&s| f32_to_i16(s)));
        while self.pending.len() >= VAD_FRAME_SAMPLES {
            let frame: Vec<i16> = self.pending.drain(..VAD_FRAME_SAMPLES).collect();
            // On classifier error, assume voice: never cut off speech.
            let is_voice = self.vad.is_voice_segment(&frame).unwrap_or(true);
            if matches!(self.trigger.push_frame(is_voice), VadDecision::Stop) {
                return true;
            }
        }
        false
    }
}

fn f32_to_i16(s: f32) -> i16 {
    (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16
}

/// Writes samples as a 16-bit PCM, 16-kHz mono WAV.
pub fn write_wav_16k_mono(samples: &[f32], path: &Path) -> Result<(), String> {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate: TARGET_SAMPLE_RATE,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut writer = hound::WavWriter::create(path, spec).map_err(|e| e.to_string())?;
    for &s in samples {
        writer.write_sample(f32_to_i16(s)).map_err(|e| e.to_string())?;
    }
    writer.finalize().map_err(|e| e.to_string())
}

/// Temp WAV path for a finished recording.
pub fn temp_wav_path() -> PathBuf {
    std::env::temp_dir().join(format!(
        "whispr-{}-{}.wav",
        std::process::id(),
        crate::state::now_ms()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wav_roundtrip() {
        let samples: Vec<f32> = (0..1600)
            .map(|i| (i as f32 * 0.02).sin() * 0.8)
            .collect();
        let path = std::env::temp_dir().join(format!("whispr-test-{}.wav", std::process::id()));
        write_wav_16k_mono(&samples, &path).expect("write wav");

        let mut reader = hound::WavReader::open(&path).expect("open wav");
        let spec = reader.spec();
        assert_eq!(spec.channels, 1);
        assert_eq!(spec.sample_rate, TARGET_SAMPLE_RATE);
        assert_eq!(spec.bits_per_sample, 16);
        assert_eq!(spec.sample_format, hound::SampleFormat::Int);

        let read: Vec<i16> = reader.samples::<i16>().map(|s| s.unwrap()).collect();
        assert_eq!(read.len(), samples.len());
        for (orig, got) in samples.iter().zip(read.iter()) {
            let expected = f32_to_i16(*orig);
            assert_eq!(expected, *got);
        }
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn f32_to_i16_clamps() {
        assert_eq!(f32_to_i16(2.0), i16::MAX);
        assert_eq!(f32_to_i16(-2.0), -i16::MAX);
        assert_eq!(f32_to_i16(0.0), 0);
    }
}
