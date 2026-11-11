# Windows Desktop Host

This directory contains the native Windows WebView2 host for Tree Grow Game.

## Current stage

Stage 1 is a minimal host proof of concept. It opens the built frontend from the sibling `www/` directory through WebView2 virtual-host mapping:

- Virtual origin: `https://treegrow.local/`
- Local resource directory: `www/`
- No local HTTP server is started.
- The Evergreen WebView2 Runtime must be installed on the target Windows system.

The host intentionally does not modify the game's JavaScript, rendering, or AI modules.

## Build

The GitHub Actions workflow installs the Microsoft.Web.WebView2 NuGet package, builds the frontend, compiles this project with CMake/MSVC x64, and uploads a ZIP artifact.

For a local build, configure CMake with `WEBVIEW2_SDK_DIR` pointing to the NuGet package's `build/native` directory.
