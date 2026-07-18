# Third-party components

whispr-open itself is [MIT](LICENSE). It bundles or downloads the following
third-party components at build or run time. This list covers the major
components; the complete dependency trees (with licenses resolvable per
package) live in `pnpm-lock.yaml` and `Cargo.lock`.

## Bundled at build time

| Component | Role | License |
|---|---|---|
| [whisper.cpp](https://github.com/ggerganov/whisper.cpp) v1.7.4 | speech-to-text sidecar (`whisper-cli`) | MIT |
| [Tauri](https://tauri.app) v2 (+ official plugins) | application framework | Apache-2.0 OR MIT |
| [React](https://react.dev) | UI | MIT |
| [Radix UI](https://www.radix-ui.com) primitives | accessible UI components | MIT |
| [Tailwind CSS](https://tailwindcss.com) | styling | MIT |
| [lucide](https://lucide.dev) icons | iconography | ISC |
| [cpal](https://github.com/RustAudio/cpal) | audio capture | Apache-2.0 |
| [webrtc-vad](https://crates.io/crates/webrtc-vad) | voice activity detection (wraps WebRTC VAD, BSD-3-Clause) | MIT / BSD-3-Clause |
| [enigo](https://github.com/enigo-rs/enigo) | Linux text injection | MIT |
| [hound](https://github.com/ruuda/hound) | WAV encoding | Apache-2.0 |
| [reqwest](https://github.com/seanmonstar/reqwest) | model downloads / Ollama HTTP | Apache-2.0 OR MIT |
| [arboard](https://github.com/1Password/arboard) | clipboard | Apache-2.0 OR MIT |

## Downloaded at run time (user-initiated)

| Component | Source | License |
|---|---|---|
| Whisper ggml models (`tiny` … `medium`) | [huggingface.co/ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp) | MIT (OpenAI Whisper weights, converted) |

## Optional external tools (not bundled)

| Tool | Role | License |
|---|---|---|
| [Ollama](https://ollama.com) | local post-processing LLM host (off by default) | MIT (models under their own licenses) |
| [ydotool](https://github.com/ReimuNotMoe/ydotool) | Wayland text injection | AGPL-3.0 (invoked as an external binary, not linked) |

The test fixture `test/fixtures/jfk.wav` is the public-domain sample shipped
with whisper.cpp.
