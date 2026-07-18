//! Silence-triggered stop detection operating on per-frame voice decisions.
//!
//! The caller classifies each fixed-length audio frame as voiced or silent
//! (e.g. via an energy threshold or an external VAD) and feeds the boolean
//! into [`VadTrigger::push_frame`]; the trigger decides when the recording
//! should stop.

/// Configuration for [`VadTrigger`]. All durations are in milliseconds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VadConfig {
    /// Duration of one audio frame fed to [`VadTrigger::push_frame`].
    pub frame_ms: u32,
    /// Continuous silence after speech required to fire [`VadDecision::Stop`].
    pub silence_timeout_ms: u32,
    /// Minimum total voiced time before silence may fire a stop.
    pub min_speech_ms: u32,
}

impl Default for VadConfig {
    fn default() -> Self {
        Self {
            frame_ms: 30,
            silence_timeout_ms: 800,
            min_speech_ms: 200,
        }
    }
}

/// Trigger state returned by [`VadTrigger::push_frame`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VadDecision {
    /// No voiced frame observed yet; leading silence never stops.
    WaitingForSpeech,
    /// Speech has started (also returned during trailing silence that has not
    /// yet satisfied the stop condition).
    Speech,
    /// At least `min_speech_ms` of voiced frames in total were followed by at
    /// least `silence_timeout_ms` of continuous silence. Latched until
    /// [`VadTrigger::reset`].
    Stop,
}

/// State machine deciding when to stop a recording based on per-frame
/// voice/silence classifications.
#[derive(Debug, Clone)]
pub struct VadTrigger {
    cfg: VadConfig,
    total_voiced_ms: u32,
    silence_run_ms: u32,
    stopped: bool,
}

impl VadTrigger {
    pub fn new(cfg: VadConfig) -> Self {
        Self {
            cfg,
            total_voiced_ms: 0,
            silence_run_ms: 0,
            stopped: false,
        }
    }

    /// Feed one frame's classification; returns the trigger state.
    ///
    /// [`VadDecision::Stop`] fires only after speech was detected (at least
    /// `min_speech_ms` of voiced frames in total, not necessarily contiguous)
    /// followed by at least `silence_timeout_ms` of continuous silence. A
    /// voiced frame resets the silence run. Silence before the first voiced
    /// frame never stops. Once `Stop` has fired it keeps being returned until
    /// [`reset`](Self::reset) is called.
    pub fn push_frame(&mut self, is_voice: bool) -> VadDecision {
        if self.stopped {
            return VadDecision::Stop;
        }
        if is_voice {
            self.total_voiced_ms = self.total_voiced_ms.saturating_add(self.cfg.frame_ms);
            self.silence_run_ms = 0;
            return VadDecision::Speech;
        }
        if self.total_voiced_ms == 0 {
            return VadDecision::WaitingForSpeech;
        }
        self.silence_run_ms = self.silence_run_ms.saturating_add(self.cfg.frame_ms);
        if self.total_voiced_ms >= self.cfg.min_speech_ms
            && self.silence_run_ms >= self.cfg.silence_timeout_ms
        {
            self.stopped = true;
            VadDecision::Stop
        } else {
            VadDecision::Speech
        }
    }

    /// Return to the initial state, as if freshly constructed.
    pub fn reset(&mut self) {
        self.total_voiced_ms = 0;
        self.silence_run_ms = 0;
        self.stopped = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(trigger: &mut VadTrigger, is_voice: bool, n: usize) -> Vec<VadDecision> {
        (0..n).map(|_| trigger.push_frame(is_voice)).collect()
    }

    #[test]
    fn default_config() {
        let cfg = VadConfig::default();
        assert_eq!(cfg.frame_ms, 30);
        assert_eq!(cfg.silence_timeout_ms, 800);
        assert_eq!(cfg.min_speech_ms, 200);
    }

    #[test]
    fn leading_silence_waits_and_never_stops() {
        let mut t = VadTrigger::new(VadConfig::default());
        for d in feed(&mut t, false, 1000) {
            assert_eq!(d, VadDecision::WaitingForSpeech);
        }
    }

    #[test]
    fn voiced_frame_returns_speech() {
        let mut t = VadTrigger::new(VadConfig::default());
        assert_eq!(t.push_frame(true), VadDecision::Speech);
    }

    #[test]
    fn silence_below_min_speech_never_stops() {
        let mut t = VadTrigger::new(VadConfig::default());
        // 3 * 30ms = 90ms voiced, below min_speech_ms = 200.
        feed(&mut t, true, 3);
        for d in feed(&mut t, false, 1000) {
            assert_eq!(d, VadDecision::Speech);
        }
    }

    #[test]
    fn stop_at_exact_silence_boundary() {
        let cfg = VadConfig {
            frame_ms: 100,
            silence_timeout_ms: 800,
            min_speech_ms: 200,
        };
        let mut t = VadTrigger::new(cfg);
        // Exactly min_speech_ms of voice.
        feed(&mut t, true, 2);
        // 7 silence frames = 700ms: still below the timeout.
        for d in feed(&mut t, false, 7) {
            assert_eq!(d, VadDecision::Speech);
        }
        // 8th silence frame reaches exactly 800ms.
        assert_eq!(t.push_frame(false), VadDecision::Stop);
    }

    #[test]
    fn stop_with_default_config_after_27_silence_frames() {
        let mut t = VadTrigger::new(VadConfig::default());
        feed(&mut t, true, 10); // 300ms voiced >= 200ms
        // 26 frames = 780ms < 800ms.
        for d in feed(&mut t, false, 26) {
            assert_eq!(d, VadDecision::Speech);
        }
        // 27th frame = 810ms >= 800ms.
        assert_eq!(t.push_frame(false), VadDecision::Stop);
    }

    #[test]
    fn speech_resumption_resets_silence_run() {
        let mut t = VadTrigger::new(VadConfig::default());
        feed(&mut t, true, 10); // 300ms voiced
        feed(&mut t, false, 20); // 600ms silence, below timeout
        assert_eq!(t.push_frame(true), VadDecision::Speech); // resets silence run
        // A full fresh timeout is required again: 26 frames = 780ms.
        for d in feed(&mut t, false, 26) {
            assert_eq!(d, VadDecision::Speech);
        }
        assert_eq!(t.push_frame(false), VadDecision::Stop);
    }

    #[test]
    fn min_speech_accumulates_across_gaps() {
        let mut t = VadTrigger::new(VadConfig::default());
        feed(&mut t, true, 4); // 120ms
        feed(&mut t, false, 5); // silence gap, not enough speech yet
        feed(&mut t, true, 3); // total 210ms >= 200ms
        for d in feed(&mut t, false, 26) {
            assert_eq!(d, VadDecision::Speech);
        }
        assert_eq!(t.push_frame(false), VadDecision::Stop);
    }

    #[test]
    fn stop_is_latched_until_reset() {
        let mut t = VadTrigger::new(VadConfig::default());
        feed(&mut t, true, 10);
        feed(&mut t, false, 27);
        assert_eq!(t.push_frame(false), VadDecision::Stop);
        assert_eq!(t.push_frame(true), VadDecision::Stop);
        assert_eq!(t.push_frame(false), VadDecision::Stop);
    }

    #[test]
    fn reset_restores_initial_state() {
        let mut t = VadTrigger::new(VadConfig::default());
        feed(&mut t, true, 10);
        feed(&mut t, false, 30);
        t.reset();
        assert_eq!(t.push_frame(false), VadDecision::WaitingForSpeech);
        assert_eq!(t.push_frame(true), VadDecision::Speech);
        // Old voiced/silence totals must not leak through the reset.
        for d in feed(&mut t, false, 26) {
            assert_eq!(d, VadDecision::Speech);
        }
    }
}
