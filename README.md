# SVG Tracer

[日本語 (Japanese)](README.ja.md)

SVG Tracer is an open-source desktop application that vectorizes (traces) raster images (PNG, JPEG, WebP, BMP, and GIF) into clean SVG vector graphics.
All processing is performed entirely locally on your machine—no images are uploaded to any external online service.

## Features

- **Single Conversion**: Interactive side-by-side preview comparing the original raster image and the vectorized SVG with synchronized zoom and pan. Adjust trace parameters in real time while observing path counts and output file sizes.
- **Batch Conversion**: Convert entire folders of images in bulk. Utilizes multiple CPU cores for fast parallel processing. Automatically resolves naming conflicts by appending sequential numbers (e.g. `name (1).svg`) to prevent overwriting existing files. Can be cancelled at any point without leaving incomplete or corrupt files.
- **Presets**: Built-in presets for "Logo (color)", "Icon (few colors)", and "Black & white", along with full access to advanced trace parameters.
- **Bilingual Interface**: Full support for both Japanese and English, with language preference persisted across launches.
- **No Network Communication**: The application itself does not make any network requests (contains no telemetry and no update checks).

## Installation

Download the appropriate installer or package for your operating system from the [Releases](https://github.com/w034ff/SVG-Tracer/releases) page.

### Windows

- **Formats**: Available as an MSI installer (`.msi`) or an NSIS installer (`.exe`).
- **Windows SmartScreen Notice**: Because the application binaries are not code-signed, Windows Defender SmartScreen may display a warning ("Windows protected your PC"). To continue, click "**More info**", then click "**Run anyway**".
- **WebView2 Runtime**: If the Microsoft Edge WebView2 runtime is not already installed on your system, the installer will automatically download and install it.

### Linux

- **Formats**: Available as an AppImage or a Debian package (`.deb`).
- **Requirements**: WebKitGTK 4.1 (e.g., `libwebkit2gtk-4.1-0` on Ubuntu 22.04 or later).
- **AppImage**:
  Make the downloaded AppImage executable and run it:
  ```bash
  chmod +x SVG*Tracer_*_amd64.AppImage
  ./SVG*Tracer_*_amd64.AppImage
  ```
- **.deb Package**:
  Install via `apt` to ensure all system dependencies are satisfied:
  ```bash
  sudo apt install ./SVG*Tracer_*_amd64.deb
  ```

## Building from Source

### Prerequisites

- **Rust**: Stable toolchain
- **Node.js**: The version specified in `.nvmrc` (v24, or `>=24.15.0` per `package.json`)
- **npm**: 11 or higher
- **Linux Build Dependencies** (when building on Linux):
  ```bash
  sudo apt-get update
  sudo apt-get install -y \
    libwebkit2gtk-4.1-dev \
    build-essential \
    curl \
    wget \
    file \
    libxdo-dev \
    libssl-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    patchelf
  ```

### Build Steps

1. Install project dependencies:

   ```bash
   npm ci
   ```

2. Start the application in development mode:

   ```bash
   npm run tauri dev
   ```

3. Build the production release packages:
   ```bash
   npm run tauri build
   ```
   The bundled packages will be generated under `src-tauri/target/release/bundle/`.

## License

This project is licensed under the [MIT License](LICENSE).

Third-party dependencies and their licenses can be viewed directly within the application by clicking the "About" button in the top bar.
