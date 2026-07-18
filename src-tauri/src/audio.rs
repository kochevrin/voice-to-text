//! Microphone capture via cpal: device listing and a 16-kHz mono f32 stream.

use std::sync::mpsc::Sender;

use cpal::traits::{DeviceTrait, HostTrait};
use cpal::{FromSample, Sample, SizedSample};

pub const TARGET_SAMPLE_RATE: u32 = 16_000;

pub fn list_input_devices() -> Result<Vec<String>, String> {
    let host = cpal::default_host();
    let devices = host.input_devices().map_err(|e| e.to_string())?;
    Ok(devices.filter_map(|d| d.name().ok()).collect())
}

/// Streaming linear-interpolation resampler from an arbitrary input rate down
/// (or up) to [`TARGET_SAMPLE_RATE`]. Keeps fractional read position and the
/// last sample across chunks so chunked processing equals one-shot processing.
pub struct Downsampler {
    step: f64,
    /// Read position of the next output sample, relative to the first sample
    /// of the *next* input chunk. May be in `[-1, 0)` right after a chunk
    /// boundary, in which case `prev` supplies the left interpolation point.
    t: f64,
    prev: Option<f32>,
}

impl Downsampler {
    pub fn new(input_rate: u32) -> Self {
        Self {
            step: input_rate as f64 / TARGET_SAMPLE_RATE as f64,
            t: 0.0,
            prev: None,
        }
    }

    pub fn process(&mut self, input: &[f32], out: &mut Vec<f32>) {
        if input.is_empty() {
            return;
        }
        if let Some(prev) = self.prev {
            while self.t < 0.0 {
                let frac = (self.t + 1.0) as f32;
                out.push(prev + (input[0] - prev) * frac);
                self.t += self.step;
            }
        }
        loop {
            let i = self.t.floor() as usize;
            if i + 1 >= input.len() {
                break;
            }
            let frac = (self.t - i as f64) as f32;
            out.push(input[i] + (input[i + 1] - input[i]) * frac);
            self.t += self.step;
        }
        self.prev = Some(input[input.len() - 1]);
        self.t -= input.len() as f64;
    }
}

/// Builds (but does not start) an input stream on the named device (or the
/// system default). Interleaved frames are mixed down to mono, resampled to
/// 16 kHz and pushed into `tx` as chunks.
///
/// The returned `cpal::Stream` is `!Send` — build and keep it on one thread.
pub fn build_input_stream(
    device_name: Option<&str>,
    tx: Sender<Vec<f32>>,
) -> Result<cpal::Stream, String> {
    let host = cpal::default_host();
    let device = match device_name {
        Some(name) => host
            .input_devices()
            .map_err(|e| e.to_string())?
            .find(|d| d.name().map(|n| n == name).unwrap_or(false))
            .ok_or_else(|| format!("input device \"{name}\" not found"))?,
        None => host
            .default_input_device()
            .ok_or_else(|| "no default input device".to_string())?,
    };
    let supported = device.default_input_config().map_err(|e| e.to_string())?;
    let sample_format = supported.sample_format();
    let config: cpal::StreamConfig = supported.config();

    macro_rules! build {
        ($ty:ty) => {
            typed_input_stream::<$ty>(&device, &config, tx)
        };
    }
    match sample_format {
        cpal::SampleFormat::F32 => build!(f32),
        cpal::SampleFormat::I16 => build!(i16),
        cpal::SampleFormat::U16 => build!(u16),
        cpal::SampleFormat::I8 => build!(i8),
        cpal::SampleFormat::U8 => build!(u8),
        cpal::SampleFormat::I32 => build!(i32),
        cpal::SampleFormat::F64 => build!(f64),
        other => Err(format!("unsupported input sample format: {other:?}")),
    }
}

fn typed_input_stream<T>(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    tx: Sender<Vec<f32>>,
) -> Result<cpal::Stream, String>
where
    T: SizedSample,
    f32: FromSample<T>,
{
    let channels = config.channels.max(1) as usize;
    let mut downsampler = Downsampler::new(config.sample_rate.0);
    let mut mono = Vec::new();
    device
        .build_input_stream(
            config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                mono.clear();
                mono.reserve(data.len() / channels);
                for frame in data.chunks_exact(channels) {
                    let sum: f32 = frame.iter().map(|&s| f32::from_sample(s)).sum();
                    mono.push(sum / channels as f32);
                }
                let mut out = Vec::with_capacity(mono.len());
                downsampler.process(&mono, &mut out);
                if !out.is_empty() {
                    // Receiver gone means the session ended; nothing to do.
                    let _ = tx.send(out);
                }
            },
            |err| tracing::warn!("audio input stream error: {err}"),
            None,
        )
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run_oneshot(rate: u32, input: &[f32]) -> Vec<f32> {
        let mut ds = Downsampler::new(rate);
        let mut out = Vec::new();
        ds.process(input, &mut out);
        out
    }

    #[test]
    fn identity_at_16k() {
        let input: Vec<f32> = (0..100).map(|i| i as f32).collect();
        let out = run_oneshot(16_000, &input);
        // Last sample is held back until the next chunk arrives.
        assert_eq!(out.len(), 99);
        for (i, v) in out.iter().enumerate() {
            assert!((v - i as f32).abs() < 1e-6, "sample {i}: {v}");
        }
    }

    #[test]
    fn downsample_48k_ramp() {
        // A linear ramp is reproduced exactly by linear interpolation.
        let input: Vec<f32> = (0..4800).map(|i| i as f32).collect();
        let out = run_oneshot(48_000, &input);
        // ~1/3 of the samples, minus boundary hold-back.
        assert!((out.len() as i64 - 1600).unsigned_abs() <= 2, "len {}", out.len());
        for (k, v) in out.iter().enumerate() {
            let expected = k as f32 * 3.0;
            assert!((v - expected).abs() < 1e-3, "sample {k}: {v} vs {expected}");
        }
    }

    #[test]
    fn chunked_equals_oneshot() {
        let input: Vec<f32> = (0..4410).map(|i| (i as f32 * 0.01).sin()).collect();
        let oneshot = run_oneshot(44_100, &input);

        let mut ds = Downsampler::new(44_100);
        let mut chunked = Vec::new();
        for chunk in input.chunks(97) {
            ds.process(chunk, &mut chunked);
        }
        assert_eq!(oneshot.len(), chunked.len());
        for (a, b) in oneshot.iter().zip(chunked.iter()) {
            assert!((a - b).abs() < 1e-6);
        }
    }
}
