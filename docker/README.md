# Docker dev image

`dev.Dockerfile` builds the `whispr-dev` image: `rust:1-bookworm` plus every
system dependency the Rust workspace and the whisper.cpp sidecar need
(webkit2gtk 4.1, GTK 3, ALSA headers, ayatana-appindicator, librsvg, libxdo,
patchelf, cmake, clang).

It exists because the primary dev host (WSL2) has no C toolchain — anything
that compiles C runs here instead.

```sh
# Build the image (one-time)
docker build -t whispr-dev -f docker/dev.Dockerfile .

# Linux whisper-cli sidecar build (required once before workspace tests)
docker run --rm -v "$PWD":/app -w /app whispr-dev bash sidecar/whisper/build-linux.sh

# Full-workspace Rust tests
docker run --rm -v "$PWD":/app -w /app whispr-dev cargo test --workspace
```

Run all commands from the repository root; results land on the host through
the bind mount.
