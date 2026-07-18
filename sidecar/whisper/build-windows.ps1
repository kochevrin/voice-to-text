# Builds whisper.cpp's whisper-cli for Windows and installs it as a Tauri
# sidecar binary at src-tauri\binaries\whisper-cli-<TRIPLE>.exe.
# Requires: git, cmake, Visual Studio Build Tools (C++ workload).
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path

$WhisperVersion = "v1.7.4"
$Triple = if ($env:TRIPLE) { $env:TRIPLE } else { "x86_64-pc-windows-msvc" }
$VendorDir = if ($env:VENDOR_DIR) { $env:VENDOR_DIR } else { Join-Path $ScriptDir "vendor" }
$BuildDir = Join-Path $VendorDir "build"
$DestDir = Join-Path $RepoRoot "src-tauri\binaries"

if (-not (Test-Path $VendorDir)) {
    git clone --depth 1 --branch $WhisperVersion https://github.com/ggerganov/whisper.cpp $VendorDir
    if ($LASTEXITCODE -ne 0) { throw "git clone failed" }
}

cmake -S $VendorDir -B $BuildDir `
    -DCMAKE_BUILD_TYPE=Release `
    -DBUILD_SHARED_LIBS=OFF `
    -DGGML_NATIVE=OFF `
    -DGGML_OPENMP=OFF
if ($LASTEXITCODE -ne 0) { throw "cmake configure failed" }

cmake --build $BuildDir --config Release --target whisper-cli
if ($LASTEXITCODE -ne 0) { throw "cmake build failed" }

New-Item -ItemType Directory -Force -Path $DestDir | Out-Null

# Multi-config generators (Visual Studio) emit bin\Release, single-config emit bin.
$Exe = Join-Path $BuildDir "bin\Release\whisper-cli.exe"
if (-not (Test-Path $Exe)) { $Exe = Join-Path $BuildDir "bin\whisper-cli.exe" }
if (-not (Test-Path $Exe)) { throw "whisper-cli.exe not found under $BuildDir\bin" }

Copy-Item $Exe (Join-Path $DestDir "whisper-cli-$Triple.exe") -Force
Write-Host "OK: $DestDir\whisper-cli-$Triple.exe"
