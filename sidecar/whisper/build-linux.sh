#!/usr/bin/env bash
# Builds whisper.cpp's whisper-cli for Linux and installs it as a Tauri sidecar
# binary at src-tauri/binaries/whisper-cli-<TRIPLE>.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

WHISPER_VERSION="v1.7.4"
TRIPLE="${TRIPLE:-x86_64-unknown-linux-gnu}"
VENDOR_DIR="${VENDOR_DIR:-${SCRIPT_DIR}/vendor}"
BUILD_DIR="${VENDOR_DIR}/build"
DEST_DIR="${REPO_ROOT}/src-tauri/binaries"

if [ ! -d "${VENDOR_DIR}" ]; then
  git clone --depth 1 --branch "${WHISPER_VERSION}" \
    https://github.com/ggerganov/whisper.cpp "${VENDOR_DIR}"
fi

cmake -S "${VENDOR_DIR}" -B "${BUILD_DIR}" \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -DGGML_NATIVE=OFF \
  -DGGML_OPENMP=OFF
cmake --build "${BUILD_DIR}" --config Release --target whisper-cli -j "$(nproc)"

mkdir -p "${DEST_DIR}"
cp "${BUILD_DIR}/bin/whisper-cli" "${DEST_DIR}/whisper-cli-${TRIPLE}"
echo "OK: ${DEST_DIR}/whisper-cli-${TRIPLE}"
