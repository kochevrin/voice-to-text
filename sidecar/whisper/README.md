# whisper.cpp sidecar

whispr-open bundles [whisper.cpp](https://github.com/ggerganov/whisper.cpp)'s
`whisper-cli` binary (pinned to **v1.7.4**) as a Tauri sidecar. Tauri resolves
`externalBin: ["binaries/whisper-cli"]` to
`src-tauri/binaries/whisper-cli-<target-triple>[.exe]`, so the build scripts
here produce exactly those file names.

## Scripts

| Script | Output(s) in `src-tauri/binaries/` |
|---|---|
| `build-linux.sh` | `whisper-cli-x86_64-unknown-linux-gnu` |
| `build-macos.sh` | `whisper-cli-universal-apple-darwin` (lipo of both arches), plus `whisper-cli-aarch64-apple-darwin` and `whisper-cli-x86_64-apple-darwin` |
| `build-windows.ps1` | `whisper-cli-x86_64-pc-windows-msvc.exe` |

All scripts:

- shallow-clone whisper.cpp v1.7.4 into `sidecar/whisper/vendor/` if it is not
  already there (the directory is gitignored),
- configure with `-DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF`
  (static, portable — no `-march=native`),
- build only the `whisper-cli` target and copy it into `src-tauri/binaries/`.

Environment overrides (bash scripts): `TRIPLE` (output suffix) and
`VENDOR_DIR` (checkout location). The PowerShell script honors the same
variables via `$env:TRIPLE` / `$env:VENDOR_DIR`.

## Prerequisites

- **Linux:** `cmake`, a C/C++ toolchain (`build-essential` or clang), `git`.
- **macOS:** Xcode Command Line Tools + `cmake` (`brew install cmake`).
- **Windows:** Visual Studio Build Tools (C++ workload) + `cmake`, run from
  PowerShell.

## Building on a host without a toolchain (Docker route)

The primary dev machine (WSL2) has no C compiler or cmake. Use the `whispr-dev`
image (built from `docker/dev.Dockerfile`) instead:

```sh
docker run --rm -v "$PWD":/app -w /app whispr-dev bash sidecar/whisper/build-linux.sh
```

Run it from the repository root. The resulting binary lands in
`src-tauri/binaries/` on the host through the bind mount.

## Notes

- `sidecar/whisper/vendor/` is a throwaway checkout; delete it to force a fresh
  clone (e.g. after bumping `WHISPER_VERSION` inside the scripts).
- In `tauri dev`, a missing sidecar binary surfaces as a friendly error state in
  the app — run the script for your OS first.
