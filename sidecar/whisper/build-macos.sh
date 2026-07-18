#!/usr/bin/env bash
# Builds whisper.cpp's whisper-cli for macOS (arm64 + x86_64), lipo-merges them
# into a universal binary, and installs all three names Tauri may resolve:
#   src-tauri/binaries/whisper-cli-<TRIPLE>            (universal, for --target universal-apple-darwin)
#   src-tauri/binaries/whisper-cli-aarch64-apple-darwin
#   src-tauri/binaries/whisper-cli-x86_64-apple-darwin
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

WHISPER_VERSION="v1.7.4"
TRIPLE="${TRIPLE:-universal-apple-darwin}"
VENDOR_DIR="${VENDOR_DIR:-${SCRIPT_DIR}/vendor}"
DEST_DIR="${REPO_ROOT}/src-tauri/binaries"
JOBS="$(sysctl -n hw.ncpu)"

if [ ! -d "${VENDOR_DIR}" ]; then
  git clone --depth 1 --branch "${WHISPER_VERSION}" \
    https://github.com/ggerganov/whisper.cpp "${VENDOR_DIR}"
fi

build_arch() {
  local arch="$1"
  local build_dir="${VENDOR_DIR}/build-${arch}"
  cmake -S "${VENDOR_DIR}" -B "${build_dir}" \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_SHARED_LIBS=OFF \
    -DGGML_NATIVE=OFF \
    -DGGML_OPENMP=OFF \
    -DCMAKE_OSX_ARCHITECTURES="${arch}"
  cmake --build "${build_dir}" --config Release --target whisper-cli -j "${JOBS}"
}

build_arch arm64
build_arch x86_64

mkdir -p "${DEST_DIR}"
lipo -create \
  "${VENDOR_DIR}/build-arm64/bin/whisper-cli" \
  "${VENDOR_DIR}/build-x86_64/bin/whisper-cli" \
  -output "${DEST_DIR}/whisper-cli-${TRIPLE}"
cp "${VENDOR_DIR}/build-arm64/bin/whisper-cli" "${DEST_DIR}/whisper-cli-aarch64-apple-darwin"
cp "${VENDOR_DIR}/build-x86_64/bin/whisper-cli" "${DEST_DIR}/whisper-cli-x86_64-apple-darwin"
echo "OK: ${DEST_DIR}/whisper-cli-${TRIPLE} (+ per-arch copies)"
