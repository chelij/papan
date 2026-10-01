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
npm run test:previews
npm run test:playback
npm run test:slideshow
npm run test:protection
npm run test:settings
npm run test:tabs
npm run test:history
npm run test:phone
npm run test:browser-session
```

Desktop suites launch a real Electron window. Run them sequentially on an interactive desktop, or prefix each command with `xvfb-run -a` on a headless Linux runner. Screenshots and results go into ignored `artifacts/`.

`test:phone` exercises real desktop IPC, pairing, HTTP acceptance, extraction, receipts, restart, revocation, and encrypted inbox recoding on an isolated display. Android source, build tooling, and APK releases live in the separate [papan-android repository](https://github.com/chelij/papan-android).

For `test:android-ui`, build the companion's `--test` APK in that repository, then run this desktop integration test with `PAPAN_ADB` set. `PAPAN_ANDROID_DIR` selects the companion checkout; the default is a sibling `../papan-android`. It installs a separate test package on a verified virtual display and uses a disposable collection and USB tunnel. Unlock the phone before clipboard checks. [Build/test details](mobile-sharing.md#build-and-checks).

`test:previews` uses isolated headless Chromium and local videos of different lengths to check preview selection, both slider handles, boundary frames, independent video ranges, clip playback, cancellation, validation, and the queued-move payload. It stubs the preload boundary, so it does not replace native Electron checks. Set `PAPAN_CHROMIUM` to a Chromium executable; the Linux default is `/usr/bin/chromium`.

`test:playback` runs the renderer in the same isolated browser against the production file-response code over loopback HTTP. It checks byte responses, forward/backward seeking, native timeline clicks, and resumed playback from a saved MP4 after the original source server stops. The preload API is stubbed; it does not exercise Electron's custom protocol registration.

`test:slideshow` holds an image response past the slideshow interval and samples rendered frames to check that the previous image stays visible. It also checks slide order/timing, broken images, collection switches during loading, and video-to-image transitions. It uses the actual renderer, SVG/PNG/GIF images and decoded video in isolated headless Chromium, with the preload API stubbed.

`test:protection` uses the actual renderer, library, encryption, queue, and ranged media response in headless Chromium. It checks password setup/change/removal, immediate unlock popups for tabs and file opening, cancellation during unlock, locked search/media, restart, video seeking, and automatic queue cleanup. IPC is stubbed and the `papan:` media scheme is mapped to loopback HTTP. Unit tests separately exercise authentication, corruption, recovery, file ownership, cross-collection moves, and portable encrypted copies. [Encryption format](encryption.md).

`test:settings` checks the compact sections, keyboard navigation, draft preservation, autosave from each section, validation of hidden fields, failure recovery, creation, and short-window scrolling in isolated headless Chromium. It also captures each settings section. The preload boundary is stubbed.

`test:browser-session` checks the actual Privacy toggle, IPC validation, private preference file, and restart persistence on an isolated display. Set `PAPAN_TEST_X_URL` explicitly to test a login-required post using local browser discovery; ordinary test runs do not read personal browser sessions. Unit checks use a synthetic Firefox cookie database and a fake helper to verify domain scoping, public-first extraction, cancellation, and clean download retries.

`test:tabs` checks temporary tabs, shortcuts, ordering, close/reopen behavior, password cancellation, and narrow toolbar layouts in isolated headless Chromium. Unused tabs, cancelled inspections, invalid metadata, and queue-registration failures must leave the library byte-for-byte unchanged. The first save must create exactly one collection with defaults in the same tab position. The test uses the actual library and production pin-preparation, enqueue/rollback, and reorder handlers from `main.js`; IPC, extraction, downloads, and file picking are stubbed.

`test:history` checks clearing and failed saves, persistence after reopening the library, the All collections view, reopening ordinary and encrypted collections, and new recent entries after closing. It verifies that collection metadata, pins, removal history, saved media, encrypted vaults, and external collection files survive clearing. The renderer runs in isolated headless Chromium with the production clear/close/reopen handlers and real library/crypto; IPC, the file picker, and main-process save/cache wrappers are stubbed.

`node scripts/site-checks.mjs` optionally inspects public sample posts without login. It is excluded from required checks because remote platforms change availability. Inspect its reported results instead of assuming a site name guarantees support.

## Build native packages

Build on the target OS and architecture. In addition to the development prerequisites, install Bash, a C compiler, make, pkg-config, and preferably NASM. On Windows use MSYS2 MINGW64 with GCC; the [workflow](../.github/workflows/desktop.yml) lists its packages.

```sh
npm run build:tools
npm run build:ffmpeg
npm run package
```

The first command creates a standalone Python helper and retains exact source distributions and checksums. The second builds pinned FFmpeg, x264, and dav1d sources with dependency autodetection and network protocols disabled. Papan downloads remote media itself and uses FFmpeg on local files. Build sources, configuration, and notices accompany the binary. Without NASM, the build falls back to portable C implementations, which may be slower.

Preview scaling uses bicubic interpolation with accurate rounding to avoid corrupted YUV colors in the bundled FFmpeg 7 fast scaling path. Packaging checks both AV1 decoding and decoded colors after the production portrait-video conversion. `previewVersion: 1` marks corrected video previews; older saved videos are rebuilt through the download queue after loading an unlocked collection. Revisit this compatibility repair when unversioned previews are no longer supported.

The final command packages the app and writes `Papan-<version>-<platform>-<arch>.tar.gz` on Linux/macOS or `.zip` on Windows, plus a SHA-256 checksum. The archive includes media tools, production dependencies, licensing information, and helper/native source archives. Documentation, screenshots, development tests, and sample profiles are excluded.

Set `PAPAN_EXECUTABLE` to the packaged executable and rerun `test:desktop` and `test:organization` to exercise that build. On macOS the executable is `Papan.app/Contents/MacOS/papan` inside the package. CI performs these checks before uploading artifacts.

## Releases

The GitHub workflow builds on Linux x64, Windows x64, and the macOS runner's native architecture. It runs all five source desktop suites on every platform and all seven isolated renderer suites on Linux using the runner's Google Chrome executable. A `v*` tag publishes the packages only after every native build and packaged workflow passes. Versioned archives and checksums become GitHub Release assets; the source at that tag and included dependency source archives remain available alongside them.

Before tagging, update `package.json`, the lockfile, the README's versioned download links, and [release notes](release-notes.md), then inspect the passing main-branch run. Signed installers, macOS notarization, and an updater are not implemented. Keep platform claims tied to recorded runner evidence.

## README demo

`npm run demo` downloads credited public-domain artwork, creates an isolated profile, captures the real interface, and removes the profile. Images used for capture stay under ignored `artifacts/demo/`; only screenshots and attribution are committed. Nothing from this demo is seeded into an installed app.
