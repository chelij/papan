# Development and distribution

## Setup

Use Node.js 24.15+ and Python 3.11+. Run `npm ci`, `npm run setup`, then `npm start`. Setup creates `.venv/` and installs pinned extractors, Electron, and a development FFmpeg binary.

Set `PAPAN_DATA_DIR` to an empty temporary folder when experimenting with storage. Tests already do this and never use the personal library. `PAPAN_PYTHON_WORKER=1` selects the source helper instead of an existing packaged helper during development.

## Checks

```sh
npm run check
npm test
npm run test:desktop
npm run test:layout
npm run test:interactions
npm run test:collections
npm run test:organization
```

Desktop suites launch a real Electron window. Run them sequentially on an interactive desktop, or prefix each command with `xvfb-run -a` on a headless Linux runner. Screenshots and results go into ignored `artifacts/`.

`node scripts/site-checks.mjs` optionally inspects public sample posts without login. It is excluded from required checks because remote platforms change availability. Inspect its reported results instead of assuming a site name guarantees support.

## Build native packages

Build on the target OS and architecture. In addition to the development prerequisites, install Bash, a C compiler, make, pkg-config, and preferably NASM. On Windows use MSYS2 MINGW64 with GCC; the [workflow](../.github/workflows/desktop.yml) lists its packages.

```sh
npm run build:tools
npm run build:ffmpeg
npm run package
```

The first command creates a standalone Python helper and retains exact source distributions and checksums. The second builds pinned FFmpeg, x264, and dav1d sources with dependency autodetection and network protocols disabled. Papan downloads remote media itself and uses FFmpeg on local files. Build sources, configuration, and notices accompany the binary. Without NASM, the build falls back to portable C implementations, which may be slower.

The final command packages the app and writes `Papan-0.1.0-<platform>-<arch>.tar.gz` on Linux/macOS or `.zip` on Windows, plus a SHA-256 checksum. The archive includes media tools, production dependencies, licensing information, and helper/native source archives. Documentation, screenshots, development tests, and sample profiles are excluded.

Set `PAPAN_EXECUTABLE` to the packaged executable and rerun `test:desktop` and `test:organization` to exercise that build. On macOS the executable is `Papan.app/Contents/MacOS/papan` inside the package. CI performs these checks before uploading artifacts.

## Releases

The GitHub workflow builds on Linux x64, Windows x64, and the macOS runner's native architecture. A `v*` tag publishes the packages only after every native build and packaged workflow passes. Versioned archives and checksums become GitHub Release assets; the source at that tag and included dependency source archives remain available alongside them.

Before tagging, update `package.json`, the lockfile, the README's versioned download links, and [release notes](release-notes.md), then inspect the passing main-branch run. Signed installers, macOS notarization, and an updater are not implemented. Keep platform claims tied to recorded runner evidence.

## README demo

`npm run demo` downloads credited public-domain artwork, creates an isolated profile, captures the real interface, and removes the profile. Images used for capture stay under ignored `artifacts/demo/`; only screenshots and attribution are committed. Nothing from this demo is seeded into an installed app.
