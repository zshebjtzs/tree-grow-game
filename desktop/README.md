# Windows Desktop Host

This directory contains the native Windows WebView2 host for Tree Grow Game.

## Architecture

- Native window: Win32 + C++17.
- Web runtime: Microsoft Edge WebView2 Evergreen Runtime.
- Frontend: the existing Vite production build copied into the sibling `www/` directory.
- Virtual origin: `https://treegrow.local/`, mapped directly to `www/` with WebView2 virtual-host mapping.
- No local HTTP server, Node.js, or Python process is required at runtime.
- The existing ES modules, Canvas renderer, and module AI Web Worker are retained.

The virtual HTTPS origin is intentional: module workers require a secure context, and the virtual-host mapping allows the local frontend to use one without starting a server.

## Portable package

The GitHub Actions workflow assembles this layout:

```text
TreeGrow/
├── TreeGrow.exe
└── www/
    ├── index.html
    └── assets/
```

Keep the `www/` directory beside `TreeGrow.exe`. Do not move the executable by itself. WebView2 browser profile data (including origin storage) is kept separately under `%LOCALAPPDATA%\\TreeGrowGame\\WebView2`, so the portable application does not need write access to its installation/extraction directory and profile data survives application restarts.

## Runtime requirement

The target Windows machine must have the **Microsoft Edge WebView2 Evergreen Runtime** installed. The runtime is a system prerequisite and is not bundled into this portable ZIP. The host explicitly creates its WebView2 user-data directory under the current Windows user's Local AppData folder; it does not store browser profile data beside the executable.

Target: Windows 10/11 x64.

## Build and validation

The `windows-desktop.yml` workflow:

1. Installs frontend dependencies and runs the existing Node test suite.
2. Builds the frontend with a root-relative base path for the virtual HTTPS origin.
3. Verifies entry-point asset references and confirms that the AI Worker bundle exists.
4. Installs the WebView2 SDK and compiles the native host with CMake/MSVC x64.
5. Assembles and uploads the portable ZIP artifact.

The native host retains the WebView2 environment across asynchronous controller creation, ignores callbacks after the window has closed, tracks and removes event handlers, checks key initialization/navigation results, and reports navigation or browser-process failures. CI also launches the packaged executable in hidden `--smoke-test` mode: it loads the actual local game page, checks the game canvas and the frontend module's startup markers (including creation of the app's AI Worker), starts the generated AI Worker as a module, sends it a valid tactical position with an immediate winning move, and verifies the returned parent-node and target-area IDs.

A successful CI run now verifies compilation, packaging, WebView2 page loading, and module Worker execution on the hosted Windows runner. It does **not** replace interactive acceptance on a physical Windows desktop. Final checks still include normal visible launch, a complete AI match, save/load behavior, and operation with the network disconnected.

## Local native build

Configure CMake with `WEBVIEW2_SDK_DIR` pointing to the NuGet package's `build/native` directory, then build the `Release` configuration for x64.
