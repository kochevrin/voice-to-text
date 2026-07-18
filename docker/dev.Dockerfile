FROM rust:1-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    libwebkit2gtk-4.1-dev \
    libgtk-3-dev \
    libasound2-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libxdo-dev \
    patchelf \
    cmake \
    clang \
    pkg-config \
    curl \
    git \
    ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
