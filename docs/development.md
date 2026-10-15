# Development and distribution

For component ownership, compatibility, cross-repository issues, and release upkeep, see the [ecosystem overview](ecosystem.md). The ComfyUI extension is developed, checked, and released in [chelij/comfyui-papan](https://github.com/chelij/comfyui-papan#development-and-releases).

## Setup

Use Node.js 24.15+ and Python 3.11+. Run `npm ci`, `npm run setup`, then `npm start`. Setup creates `.venv/` and installs pinned extractors, Electron, and a development FFmpeg binary.

Set `PAPAN_DATA_DIR` to an empty temporary folder when experimenting with storage. Tests already do this and never use the personal library. `PAPAN_PYTHON_WORKER=1` selects the source helper instead of an existing packaged helper during development.

## Checks

```sh
npm run check
npm test
npm run test:discovery
npm run test:desktop
npm run test:layout
npm run test:interactions
npm run test:collections
npm run test:organization
npm run test:previews
npm run test:pose
npm run test:playback
npm run test:visibility
npm run test:slideshow
npm run test:protection
npm run test:settings
npm run test:scroll
npm run test:tabs
npm run test:history
npm run test:phone
npm run test:app-connections
npm run test:browser-session
```

Desktop suites launch a real Electron window. Run them sequentially on an interactive desktop, or prefix each command with `xvfb-run -a` on a headless Linux runner. Screenshots and results go into ignored `artifacts/`.

`test:discovery` runs actual Electron page rendering and materialization on Linux's headless Ozone backend, with both desktop display variables removed and a disposable profile. It checks late API images/videos, decoded JPEG previews, exact downloaded bytes, hidden gallery slides/lightbox originals, responsive sources, the direct/static fast path, separate memory-only sandboxed sessions, and cancellation cleanup. A synthetic Firefox SQLite profile exercises the actual native cookie reader and production helper against a cookie-gated webpage and media: anonymous-first/off behavior, host/path/Secure/expiry scope, cross-host redirects, pin privacy and session cleanup. `PAPAN_TEST_PAGE_URL` optionally adds a live JPEG-page check; set `PAPAN_TEST_MEDIA_COUNT` to check the expected image count and download every discovered image. Explicitly setting `PAPAN_TEST_BROWSER_SESSION=auto` allows that live inspection to read the linked site's personal browser cookies after public failure. Set `PAPAN_TEST_FORCE_BROWSER_SESSION=1` together with automatic mode to force cookies for the live page rather than waiting for public failure. Ordinary CI uses only local fixtures. Results go into `artifacts/discovery-check.json`. This backend check does not exercise the visible app window or IPC.

`test:phone` exercises real desktop IPC, browsing opt-in, phone-specific password checks against actual encrypted collections, authenticated media ranges, selected destinations, pairing, extraction, receipts, restart, revocation and encrypted inbox recoding on an isolated display. Phone-initiated pairing checks the actual approval dialog/preload/IPC, matching six-digit code, no saved device before approval and successful pairing afterward. Linux verifies the test window against its isolated `DISPLAY`; use the host's guarded Xvfb wrapper where required. Android source/builds live in [papan-android](https://github.com/chelij/papan-android). Its optional `com.papan.share`/ADB path is the legacy Android 0.2.0 immediate-delivery check; use `test:android-ui` for the current destination-picker app.

`test:app-connections` runs the actual Electron app with a disposable profile. Linux requires an isolated X display and verifies the window's display before interaction; Windows/macOS use their native CI desktops. It checks service settings/port recovery, selected grants, one-time keys/clipboard, scope editing, encrypted ranges, lock/restart/revoke, keyboard focus and minimum-window scrolling. Results are `artifacts/app-connections-check.json` and `app-connections.png`. It never uses the personal library. `test/library-service.test.js` independently checks real HTTP/SSE clients, ungranted-data isolation, authentication/origin checks, persistence, encrypted transfer cancellation, notification cursors and settings failures. Neither check establishes a third-party adapter or LAN/mDNS discovery.

Set `PAPAN_EXECUTABLE` to an installed Papan binary for the native app-connections, desktop and organization suites. On Linux, use a private X display with `XDG_SESSION_TYPE=x11` and `WAYLAND_DISPLAY` removed; each suite verifies its window against `DISPLAY` before interaction. The tests retain disposable profiles and leave personal collections untouched.

For `test:android-ui`, build Android's `--test` APK, then run the integration test with `PAPAN_ADB` set. `PAPAN_ANDROID_DIR` selects the checkout (default `../papan-android`); `PAPAN_ANDROID_SERIAL` selects a disposable emulator or USB device. It installs only the separate test package on a verified virtual display and uses temporary collections/tunnels. Checks also cover inline Connections warnings/confirmation, repeated opening, unchanged pending destinations/pairing, deferred board messages after form dismissal and fully visible warnings at 200% fonts; both native dialog captures are required. Checks cover local collection creation, link-first image capture, native video playback/deletion, pin edit/search, per-destination deduplication, private-state reopen, camera/rotated QR pairing, real saves, explicit desktop destinations through offline/restart, password cancel/wrong/correct handling, lock invalidation and narrow/tablet/200% text layouts. Unlock before clipboard checks. This does not establish physical-phone/Wi-Fi/optical QR behavior. [Build/test details](mobile-sharing.md#build-and-checks).

The same native suite registers disposable Android DNS-SD services: Nearby desktops discovers a second receiver, displays its matching code and pairs after desktop approval without QR. Moving the original receiver's port then exercises automatic identity-verified recovery, retained token/request/destination and completion. Wrong-key proof cannot update the endpoint, and stale discovery cannot overwrite a newer manual address. The native deadline allows these bounded discovery waits. `test/phone-receiver.test.js` checks request cancellation/decline/idempotency, identity validation/revocation and automatic interface-address rebinding against real HTTP. These checks prove the native paths with isolated fixtures; personal-phone LAN discovery remains a separate check.

The protected native fixture contains a video. The phone must decode its desktop-generated thumbnail, retain it and the selected unlocked collection through portrait/landscape configuration recreation, and clear authorization after a real stop/reopen. The receiver's video-cover test checks JPEG color/dimensions, matching plaintext/encrypted output, unchanged MP4 ranges, HEAD/no-store, lock/revocation and absence of plaintext thumbnail files. The package codec check exercises the release tools' JPEG generation as well as the existing H.264/color checks.

For a real multicast regression, set `PAPAN_PHONE_DISCOVERY_HOST` to an existing private IPv4 interface and run `node scripts/phone-discovery-test.mjs`. Optional `PAPAN_APP_DIR` selects packaged source. It publishes a temporary random receiver instance, observes its initial announcement, then requires a distinct single-record response to a multicast SRV query. This separates live query handling from cached/periodic announcements and removes its service/socket afterward. It uses the selected LAN interface; loopback receiver fixtures alone cannot prove multicast behavior.

For the 15 October personal desktop update, the previously installed one-line `library-service.js` ComfyUI request adapter was carried into the local package without changing repository source. Packaged `test:app-connections` passes against those exact carried bytes. Its hash, archive, backup and rollback are recorded in [verification](verification.md#android-nearby-pairing-and-reconnection-15-october-2026); generic build evidence alone must not be presented as evidence for that local variant.

Optional `PAPAN_ANDROID_DEMO_ROOT=/path/to/papan` adds native aligned-grid sizing, single-line title/source bounds, absence of a solid caption block and rendered-fade contrast at every text row over a white image, 200% artwork captions, per-collection persistence, retained scroll position, frame-fit and Light/Dark/System checks. It copies only the existing credited public-domain catalog/cache into the disposable test package, then captures actual artwork boards and the size panel. Normal APKs contain no seeded artwork/library. Screenshot transfers validate PNG headers and allow bounded 16 MiB captures; missing required design captures fail the run.

`test:previews` uses isolated headless Chromium and local videos of different lengths to check preview selection, both slider handles, boundary frames, independent video ranges, clip playback, cancellation, validation, and the queued-move payload. It stubs the preload boundary, so it does not replace native Electron checks. Set `PAPAN_CHROMIUM` to a Chromium executable; the Linux default is `/usr/bin/chromium`.

`test:pose` checks the video viewer action, selected album item, absence of server configuration, errors, queue progress, first-use setup disclosure without a download, explicit pose playback, hidden attachment previews/navigation/cover editing, extraction while protected and unlocked, locked-pin hiding, and short-window controls in isolated headless Chromium. `test/pose.test.js` checks checksum-verified model caching, real worker-process cancellation, media batching, ordinary/encrypted attachment commits, independent album attachments, attachment validation and media cleanup, private decrypted input, failure cleanup, locked retries, encrypted queue persistence, and reopening. `test/pose-ui.test.js` checks production renderer bindings in JSDOM. Actual inference is an opt-in live check with the two pinned weights from `src/pose.js`; normal unit tests never download models. `scripts/pose-live-test.js` exercises actual inference and pin commits from a prepared fixture/cache; `PAPAN_APP_DIR` selects the packaged app code and `PAPAN_POSE_PROTECTED=1` checks encrypted source/output and cleanup. `PAPAN_POSE_RUNTIME_DOWNLOAD=1` verifies read-only setup inspection and a real runtime download from a loopback fixture serving the release asset before inference; models are prepared locally. It retains only the public runtime fixture cache for a subsequent fully offline check.

`npm run setup` does not install pose dependencies. Source developers opt in with `npm run setup:pose`, which creates an isolated `.venv-pose/`. Release building uses `npm run build:pose` to set up and package the independent `papan-pose` worker. `PAPAN_POSE_WORKER=1` selects the source worker during development. The requirements pin all runtime dependencies and are installed with `--no-deps`: headless OpenCV supplies the `cv2` API instead of the overlapping GUI OpenCV wheels listed in rtmlib's metadata. Keep this replacement only while the worker uses no GUI/contrib APIs; recheck dependencies when changing that usage. The packaged worker includes native dependency notices and exact versions in `vendor/pose-source/`. No CUDA dependency is bundled.

After opting into pose dependencies, run `.venv-pose/bin/python test/pose-worker.py -v` (Windows: `.venv-pose/Scripts/python.exe`). It uses controlled multi-person detections with actual rtmlib skeleton drawing to check people limits, tracking across batches and detection order changes, missing subjects, confidence filtering and request validation. Normal `npm test` still requires no pose dependencies. `scripts/pose-cleanup-live-test.js` is an opt-in offline packaged check using the prepared public fixture and verified dependency cache; `PAPAN_APP_DIR` points at the packaged application code. It performs real all/one/two-person extraction and encrypted replacement, checks all frames, stable pose/source IDs, unchanged original bytes/audio, saved settings, idempotent retries and plaintext cleanup, and retains compatibility fixtures under `artifacts/pose-cleanup-live/` without replacing earlier evidence.

`test:playback` runs the renderer in the same isolated browser against the production file-response code over loopback HTTP. It checks byte responses, forward/backward seeking, native timeline clicks, and resumed playback from a saved MP4 after the original source server stops. The preload API is stubbed; it does not exercise Electron's custom protocol registration.

`test:visibility` checks decoded video playback in isolated headless Chromium: scroll-out/scroll-in position retention, saved-pin updates retaining the same video and explicit pause, viewport edges, header/footer coverage, reduced motion, zooming, and clipped viewer/editor playback. Visible board videos continue playing and looping while unfocused. Hidden windows pause and resume after a paint, with at most two preview starts per frame, including when shown without focus; viewer playback also remains independent of focus. Native-window visibility/focus signals and hidden-document events are simulated through the stubbed preload boundary; native Electron window events are a separate check.

`test:slideshow` holds image and video responses past the slideshow interval and samples frames to check that a decoded frame stays visible until the next media loads and seeks to its preview start. It also checks slide order/timing while the window is unfocused, failed image/video recovery, collection switches during loading, and transitions in both directions between images and videos. It uses the actual renderer, SVG/PNG/GIF images and decoded video in isolated headless Chromium, with the preload API stubbed.

`test:protection` uses the actual renderer, library, encryption, queue, and ranged media response in headless Chromium. It checks password setup/change/removal, immediate unlock popups for tabs and file opening, cancellation during unlock, locked search/media, restart, video seeking, and automatic queue cleanup. IPC is stubbed and the `papan:` media scheme is mapped to loopback HTTP. Unit tests separately exercise authentication, corruption, recovery, file ownership, cross-collection moves, and portable encrypted copies. [Encryption format](encryption.md).

`test:settings` checks the compact sections, keyboard navigation, draft preservation, autosave from each section, validation of hidden fields, failure recovery, creation, and short-window scrolling in isolated headless Chromium. It also captures each settings section. The preload boundary is stubbed.

`test:scroll` checks late startup previews during the first scroll and accumulated wheel input; saves during smooth scrolling in both directions; retained previews, loaded rows, and partial scroll positions; out-of-order refresh replies; reordering and board-selection races; background tab/history changes; and unchanged tab focus. It also covers adaptive wheel zoom at 560–3840px, both visible zoom limits, preceding rows staying fully hidden, row alignment and zoom round trips, animation cancellation, resizing, live preview-size controls, search summaries, lazy loading, and the final row reaching the top. It uses the actual renderer in isolated headless Chromium with the preload boundary stubbed.

`test:browser-session` checks the actual Privacy toggle, IPC validation, private preference file, and restart persistence on an isolated display. Set `PAPAN_TEST_X_URL` explicitly to test a login-required post using local browser discovery; ordinary test runs do not read personal browser sessions. Unit checks use a synthetic Firefox cookie database and a fake helper to verify domain scoping, public-first extraction, cancellation, and clean download retries.

`test:tabs` checks temporary tabs, shortcuts, ordering, close/reopen behavior, password cancellation, and narrow toolbar layouts in isolated headless Chromium. Unused tabs, cancelled inspections, invalid metadata, and queue-registration failures must leave the library byte-for-byte unchanged. The first save must create exactly one collection with defaults in the same tab position. The test uses the actual library and production pin-preparation, enqueue/rollback, and reorder handlers from `main.js`; IPC, extraction, downloads, and file picking are stubbed.

`test:history` checks clearing and failed saves, persistence after reopening the library, the All collections view, reopening ordinary and encrypted collections, and new recent entries after closing. It verifies that collection metadata, pins, removal history, saved media, encrypted vaults, and external collection files survive clearing. The renderer runs in isolated headless Chromium with the production clear/close/reopen handlers and real library/crypto; IPC, the file picker, and main-process save/cache wrappers are stubbed.

`node scripts/site-checks.mjs` optionally inspects public sample posts without login. It is excluded from required checks because remote platforms change availability. Inspect its reported results instead of assuming a site name guarantees support.

`test/turbo.test.js` checks video host link routing and runs `test/turbo.py` against local HTTP fixtures through the real yt-dlp downloader. It covers matching identities across download/video/embed links, renewed signed URLs, exact media bytes, optional thumbnails, unavailable/malformed responses, the 512 MiB cap, changed selections, and the existing generic video extractor. It runs in `npm test` without internet access. The optional site checks include both video host example link forms.

`test/soop.test.js` checks single clip service routing and runs `test/soop.py` through the existing yt-dlp clip service API and downloader against local HTTP fixtures. It verifies stable identities, renewed download URLs, exact original/preview bytes, sign-in requirements and scoped cookies, removed/private clips, and changed selections. Browser-session tests additionally decode synthetic Firefox session snapshots, reject unrelated/expired/container/partitioned cookies, preserve host/path/Secure scope, avoid stale snapshot fallback and leave files unchanged. LZ4 4.4.5 is pinned for Firefox snapshot decoding and included in the frozen helper with its source/license archive. These tests never read personal browsers or access the internet.

`test/activity-ui.test.js` exercises the production renderer's independent phone/download subscriptions in JSDOM: startup order, combined active counts, progress, receipt filtering, redacted titles, recovery errors, and action routing even when queue IDs coincide. `test:pose` additionally checks simultaneous mobile/pose progress, installation-gated card buttons, direct pose playback, and the transparent outlined badge's placement and computed colors; screenshots are `artifacts/activity-panel.png` and `artifacts/pose-card.png`. `test:slideshow` checks that pose controls continue to describe the visible video while the next image is loading. These renderer checks stub preload/IPC; receiver behavior remains covered by the unit and native phone suites.

## Build native packages

Build on the target OS and architecture. In addition to the development prerequisites, install Bash, a C compiler, make, pkg-config, and preferably NASM. On Windows use MSYS2 MINGW64 with GCC; the [workflow](../.github/workflows/desktop.yml) lists its packages.

```sh
npm run build:tools
npm run build:pose
npm run build:ffmpeg
npm run package
```

The first command creates a standalone Python helper and retains exact source distributions and checksums. The second builds the optional pose runtime. The third builds pinned FFmpeg, x264, and dav1d sources with dependency autodetection and network protocols disabled. Papan downloads remote media itself and uses FFmpeg on local files. Build sources, configuration, and notices accompany the binary. Without NASM, the build falls back to portable C implementations, which may be slower.

Preview scaling uses bicubic interpolation with accurate rounding to avoid corrupted YUV colors in the bundled FFmpeg 7 fast scaling path. Packaging checks both AV1 decoding and decoded colors after the production portrait-video conversion. `previewVersion: 1` marks corrected video previews; older saved videos are rebuilt through the download queue after loading an unlocked collection. Revisit this compatibility repair when unversioned previews are no longer supported.

The final command packages the app and writes `Papan-<version>-<platform>-<arch>.tar.gz` on Linux/macOS or `.zip` on Windows, plus a SHA-256 checksum. The archive includes core media tools, production dependencies, licensing information, and helper/native source archives. Pose dependencies ship as a separate `Papan-pose-<version>-<platform>-<arch>` executable asset with a checksum; the base app includes only its download manifest and source/license notices. The first confirmed extraction downloads and verifies it. Before publishing a new desktop version, publish its matching pose asset in the same release; URLs are pinned to that version, never `latest`. Local development version assets are not publicly available until release publication. Documentation, screenshots, development tests, and sample profiles are excluded.

Set `PAPAN_EXECUTABLE` to the packaged executable and rerun `test:desktop` and `test:organization` to exercise that build. On macOS the executable is `Papan.app/Contents/MacOS/papan` inside the package. CI performs these checks before uploading artifacts.

## Releases

The GitHub workflow builds on Linux x64, Windows x64, and the macOS runner's native architecture. It runs the desktop, layout, interactions, collections, organization, and app-connections source suites on every platform, native headless page discovery on Linux, and all ten isolated renderer suites on Linux using the runner's Google Chrome executable. Packaged-app checks include desktop, organization, and app connections on every platform, plus phone reception on Linux. A `v*` tag publishes the packages only after every native build and packaged workflow passes. Versioned archives and checksums become GitHub Release assets; the source at that tag and included dependency source archives remain available alongside them.

Before tagging, update `package.json`, the lockfile, the README's versioned download links, and [release notes](release-notes.md), then inspect the passing main-branch run. Signed installers, macOS notarization, and an updater are not implemented. Keep platform claims tied to recorded runner evidence.

## README demo

`npm run demo` downloads credited public-domain artwork, creates an isolated profile, captures the real interface, and removes the profile. Images used for capture stay under ignored `artifacts/demo/`; only screenshots and attribution are committed. Nothing from this demo is seeded into an installed app.
