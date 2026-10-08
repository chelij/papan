# Verification

## v0.3.0 release preflight

On 9 October 2026, the release candidate passes syntax checks, all 50 unit tests, five deterministic Python worker checks, and a Linux package build. The frozen pose runtime imports its native dependencies successfully; `build:pose` now requires both worker tests and this startup probe on every release platform. Package checks confirm version 0.3.0, exact source bytes, the matching versioned runtime URL, runtime size/hash and archive checksums, and exclusion of pose dependencies from the base app. Production codec checks decode AV1, encode H.264, and verify portrait preview colors.

The published ComfyUI v0.1.3 reader and current local reader again pass ordinary, portable and encrypted attachment fixtures, preserving IDs, all 51 frames and exact media bytes. Protected fixtures reject locked access and incorrect passwords; the current reader also preserves cleanup options and duration. These are file-contract checks, not a packaged desktop/extension release-pair or H3 quality check. Native source and packaged-app checks will run on GitHub before tagging and publication; local native UI checks remain unavailable without an isolated display.

## Activity and pose card controls (unreleased)

On 8 October 2026, desktop 0.2.3 working-tree changes based on `153fbc8` passed syntax checks, all **50** unit tests, and the pose, protection, visibility, and slideshow renderer suites on Linux (Node.js 26.11.0, Chromium 153.0.8010.52). Activity combines unfinished downloads/pose jobs and mobile shares, retains either queue during updates from the other, counts queued/running work, exposes the correct recovery actions, hides successful shares without removing receipts, and replaces private titles with redacted snapshots. Receiver protocol v1 and persisted queues are unchanged; existing unit receiver checks exercise actual pairing, media saves, retries/restarts, and encryption.

Video cards expose extract/view pose through a stickman icon only after the runtime and models are installed. The icon replaces the redundant three-dot button at the same 29 × 25 px size and upper-right position; clicking the preview still opens pin details. The follow-up syntax, production-renderer unit, pose and settings checks verify tooltips/accessibility, absence of the duplicate button, exact icon bounds, both pose actions and editing through the preview. Earlier checks cover first-use hiding, revealing controls after setup without a restart, attachment-only retained-card updates, the displayed album-video target, direct attachment playback, and keeping controls aligned with the retained frame during delayed slide loading. The source-line badge has no background, matching text/border colors, rounded corners and a contrasting outline. Its placement and colors were checked in the actual renderer and visually inspected. Evidence: `artifacts/pose-check.json`, `artifacts/pose-card.png`, `artifacts/activity-panel.png`, and `test/activity-ui.test.js`.

All browser checks used verified isolated headless Chromium. Native Electron/phone UI was not rerun because no isolated X display is available in this environment. Preload/IPC stubs do not establish a new Android/desktop release-pair check; existing compatibility limits remain. No release was published.

The local installation is now `0.2.3-pose-icon-20261008T200649`. The icon update was installed beside the preceding Activity build with a named, content-verified library backup and rollback link before atomic activation. All installed source files match the tested working tree; only `src/renderer/app.js` and `styles.css` differ from the previous installation. Native tools and the Electron executable are byte-identical, so the preceding offline installed-cache readiness evidence remains valid. Exact paths and hashes are in `artifacts/pose-icon-install-check.json`; the earlier Activity installation is recorded in `artifacts/activity-install-check.json`. The running personal window was left untouched; close and reopen Papan to activate the icon. Launch checks were not repeated for the unchanged executable path.

## Pose extraction preview (unreleased)

The 8 October 2026 cleanup update, still based on `153fbc8`, passes all **49** unit tests, syntax checks, five optional Python worker checks and isolated pose/protection renderer suites. People controls (all or 1–10), confidence presets, correct original-video replacement payloads, saved settings, refreshed playback/cache keys and short-window layout were checked using the production renderer. Installed tools show a concise Ready state; technical setup details are collapsed. Deterministic multi-person worker checks use actual rtmlib skeleton drawing and cover changing detector order, larger background detections, one/two/all limits, missing subjects, batch boundaries/progress, confidence filtering and invalid options.

The real Linux packaged CPU runtime (Electron 44.4.5 Node mode) then processed a protected fixture made by duplicating the upstream public source side by side, offline from its verified cache. Raw detection found six people; limits one and two retained the corresponding counts with 51/51 detected frames, 2.125-second silent outputs, stable attachment/source IDs, unchanged original video/audio, encrypted settings/media, idempotent committed retries and empty plaintext media/staging. The current ComfyUI reader imported the exact cleaned bytes and preserved identities, options and duration; earlier unchanged frontend/workflow evidence is indexed in [ecosystem.md](ecosystem.md). Evidence is `artifacts/pose-cleanup-live/check.json`, `reader-check.json`, the reproducible `scripts/pose-cleanup-live-test.js`, and `artifacts/pose-cleanup-live.log`. This fixture does not establish identity tracking through crossings or H3 quality.

The preceding cleanup installation was `0.2.3-pose-cleanup-20261008T191738`; its verified new runtime is cached alongside the existing models, with zero remaining download bytes. A named library backup and previous-build rollback link preceded activation. `artifacts/pose-cleanup-install-check.json` records paths and source/runtime hashes. The running personal window was left untouched; reopening activated the build. No model download or generation was run against personal media, and no native test window appeared on the main monitor.

On 8 October 2026, the working tree based on `153fbc8` passes `npm run check`, all **47** unit tests, and pose, protection, preview, visibility, slideshow, and scroll suites in isolated headless Chromium. Tests cover same-pin attachments, separate album-video associations, cover/preview exclusion, ordinary/portable/encrypted reopening, private decrypted input, cancellation/failure cleanup, encrypted queue retries, duplicate prevention, interrupted earlier-task adoption, and retaining attachment folders through current/recovery/removal snapshots. The renderer check uses actual decoded video: normal previews make no pose request, and **view pose** explicitly loads and plays it. First-use setup exposes backend, requirements, and download size without queuing a download; closing the popup leaves setup unstarted.

The Linux package excludes both the pose executable and development `.venv-pose` dependencies. A package guard checks this before archiving. The independent runtime is a separate release asset with an exact size/SHA-256 manifest; the checked runtime + models total about **442 MiB**. Normal setup no longer installs pose dependencies. Source developers opt in separately; release building prepares the runtime explicitly.

Actual packaged Electron 44.4.5 Node-mode extraction processed a 2.125-second, 530 × 640 fixture made from rtmlib's upstream demo image, detecting poses in **all 51 frames** across two batches. The first-use check inspected an absent cache without creating files or making requests, then downloaded the actual runtime once from a loopback fixture, verified it, ran it, and committed an encrypted attachment on the original pin. Models were already cached for this download check. The subsequent packaged extraction disabled network fetch entirely and ran offline from the verified cache. Both preserve original pin contents, media bytes/audio, and leave no owned plaintext in media/staging. Evidence: `artifacts/pose-live/on-demand-protected-packaged-check.json`, `artifacts/pose-live/protected-packaged-check.json`, and the `artifacts/pose-attachment-*.log` checks.

The separate FFmpeg regression preserves all 138 frames of a 5.75-second portrait clip at 406 × 720 after three batches. Production ordinary, portable, and encrypted attachment outputs also pass the v0.1.3 and existing local ComfyUI readers, preserving source pin identity, source cover, pose item selection, association, and exact video bytes. See [ecosystem compatibility](ecosystem.md#pose-extraction-in-v030). Source fixture provenance: https://github.com/Tau-J/rtmlib/blob/main/demo.jpg. This stationary human-pose fixture does not establish H3 motion quality.

The current Linux build is `dist/Papan-linux-x64/`, with `dist/Papan-pose-0.2.3-linux-x64` as its optional runtime asset. The local update installs beside the prior build with a named library backup and rollback target, reuses the already-installed verified runtime/model cache, and activates on reopening. Local install and package evidence are `artifacts/pose-attachment-install-check.json` and `artifacts/pose-attachment-package-check.json`. Previously completed standalone pose pins are retained; retrying an interrupted earlier task can adopt its matching committed result without regenerating it. No personal media was used as a test fixture.

This is an unpublished development build. Public first-use runtime availability requires the matching versioned release asset; delivery was checked locally, not against a published GitHub release. Native Electron pose window/IPC could not run on the available isolated graphics backend; the existing Electron graphics-initialization failure remains a limit. Headless Chromium verifies renderer behavior and packaged Node mode verifies the backend/file path. No test window was opened on the main monitor. Windows/macOS inference and H3 output quality remain unverified. Older desktop builds may display pose attachments as ordinary album/preview videos.

The v0.2.0 local preflight on 30 September 2026 passed syntax checks, all 23 unit test groups, all seven renderer suites, and all five native source desktop suites. Native local windows used a private Xvfb display, verified before interaction. Tests use disposable profiles and local fixture servers; the personal library is never a test fixture. The pinned extraction helper uses gallery-dl 1.32.14, yt-dlp 2026.08.19, and Instaloader 4.15.3.

## Board refresh fixes checked on 7 October 2026

Syntax checks, all 31 unit tests, and the scroll, slideshow, visibility, tabs, history, settings, and protection suites passed locally in isolated headless Chromium. The regressions reproduce older refresh replies removing newer pins, an earlier refresh undoing a saved reorder, delayed saves overriding a later board selection, and background tab/history actions discarding loaded rows. The fixed renderer retains existing previews and loaded rows and preserves the scrolling destination when new pin proportions arrive.

Slideshow checks hold video responses through multiple timer ticks, sample decoded-frame availability, cancel pending loads when switching boards, and verify recovery after failed images and videos while keeping the previous frame visible. Visibility checks verify that a new save retains the same video element, playback position, and explicit pause.

These checks stub preload/IPC and do not exercise native wheel input or cross-platform window focus. The native-window focus event is included in the production visibility publisher; exact long-idle playback latency is not established by the headless suites. GitHub's native build workflows remain the cross-platform check for the published commit.

The [board refresh fix run](https://github.com/chelij/papan/actions/runs/37505303426) passed at commit `926dfc3`: native source and packaged-app workflows on Linux x64, Windows x64, and macOS ARM64, plus all nine renderer suites on Linux.

## Source checks

| Check | What it proves |
| --- | --- |
| `npm run check` | Syntax across source, scripts, and tests |
| `npm test` | URL routing, extraction, atomic persistence, settings, real media processing, saved lists, pin/preview validation, durable queue behavior, portable imports, byte ranges, and encryption transactions |
| `test:desktop` | Empty canvas, selection, albums, complete video, storage conversion, restart without the source server, images/video/text, search, and 100+ pins |
| `test:layout` | Mixed proportions, stable album frames, preview sizing, resizing, live settings, and missing dimensions |
| `test:interactions` | Pointer drag previews, cancellation, keyboard reorder, tabs, toolbar, responsive controls, autosave, restart persistence, and cancelled creation |
| `test:collections` | File-dialog paths, list saves, automatic updates, close/reopen, conflicts, failed-save drafts, discard, and retained media |
| `test:pose` | Video-only action, selected album item, optional setup disclosure, no download before confirmation, explicit attachment playback, hidden preview/navigation/cover media, unlocked protected extraction, locked-pin hiding, and short-window controls in isolated headless Chromium |
| `test:organization` | Paste, editing, notes/tags/cover/move, filtered global search, undo, two-destination rollback, responsive background saves, cancel/retry, and portable import after deleting the source media |

The organization suite holds a media response open and checks that creating a collection still finishes promptly. It also changes the second saved list externally, attempts a move, and confirms neither local metadata nor the first saved list changes. Portable import is checked in a fresh profile after the source server stops and the original local media is removed.

## Renderer and encryption checks

All seven renderer suites passed in isolated headless Chromium during local preflight. They use the actual renderer, with the preload/IPC boundary stubbed; they complement native Electron workflows rather than replacing them. Suites that exercise storage use the production library and handler functions. See [development](development.md) for each suite's boundaries.

| Check | What it proves |
| --- | --- |
| `test:previews` | Saved-item selection, both range handles, decoded boundary frames, independent video ranges, clip looping, complete viewer media, cancellation, validation, and queued preview metadata |
| `test:playback` | Production byte responses, forward/backward seeking, timeline clicks, saved-video playback after the source server stops, and stable settings bounds with classic scrollbars |
| `test:visibility` | Decoded-video and pause retention through scrolling and new saves, viewport edges, header/footer coverage, reduced motion, simulated window/document visibility, zooming, and clipped viewer/editor playback |
| `test:slideshow` | Decoded frames retained through delayed/failed image and video transitions, slide order and intervals, preview-start seeking, recovery, and collection switches during loading |
| `test:protection` | Password setup/change/removal, unlock popups and cancellation, locked search/media, restart locking, encrypted video seeking, successful queue cleanup, and failed-task access |
| `test:settings` | Compact sections, keyboard navigation, stable bounds, drafts and autosave, hidden-field validation, save failures, creation, and short-window scrolling |
| `test:scroll` | Saves and late dimensions retain previews, loaded rows, and pending scrolling; stale refresh/reorder and board-selection races; background tabs/history and tab focus; adaptive wheel steps and limits at 560–3840px; zoom, row boundaries, resizing, search, lazy loading, and final-row alignment |
| `test:tabs` | Temporary tabs, shortcuts, ordering, close/reopen, narrow layouts, password cancellation, unchanged metadata after unused/cancelled tabs, and exactly one collection on the first confirmed save |
| `test:history` | Clearing and failed saves, restart persistence, All collections access, ordinary/encrypted reopening, and new recent entries after closing; collection files, media, and removal history remain intact |

Encryption unit tests cover incorrect passwords, altered manifests and media chunks, cross-chunk ranges, password/key rotation, encrypted queue rollback, current/recovery metadata, portable encrypted copies, shared/imported file preservation, and move/delete/restore flows. A separate local headless Electron probe checks actual media protocol responses and real main-process protection handlers without opening a window. Its IPC transport and native dialogs are replaced with fixture calls. [Encryption format and limits](encryption.md).

## Native release checks

The [desktop workflow](../.github/workflows/desktop.yml) repeats syntax, unit, and all five source desktop suites on Linux x64, Windows x64, and macOS ARM64. Linux also runs all ten renderer suites using the runner's Google Chrome. Every platform builds its native helper/media tools, checks AV1-to-H.264 processing, packages the app, and reruns the desktop and organization suites against the packaged executable. Tagged releases publish only after every build passes. [Recorded runs](https://github.com/chelij/papan/actions/workflows/desktop.yml) identify the exact commit and runner versions.

The [v0.2.0 pre-release run](https://github.com/chelij/papan/actions/runs/36671197665) passed on 30 September 2026 at commit `5b5871d`, the commit tagged `v0.2.0`. The [tagged release run](https://github.com/chelij/papan/actions/runs/36671799461) repeated every build and test successfully before publishing all three native archives. Both runs also passed all seven Linux renderer suites. All published archive upload digests match the accompanying SHA-256 files; the checksum-file digests were verified too. No native test window was opened on the primary local monitor.

| Platform | Syntax, unit, and all five source workflows | Native media build and AV1-to-H.264 check | Packaged desktop and organization workflows |
| --- | --- | --- | --- |
| Linux x64 (Ubuntu 22.04) | Pass | Pass | Pass |
| Windows x64 | Pass | Pass | Pass |
| macOS ARM64 | Pass | Pass | Pass |

## Live sources

Checks on 29 September 2026 successfully discovered and downloaded selected public X images/video, a public Instagram album using the unauthenticated fallback, and public YouTube videos. These are sample-level observations, not a guarantee for every link. Optional live checks write their current results to `artifacts/site-checks.json`; they are not a CI requirement.

| Sample | Source |
| --- | --- |
| X images | [Upstream sample post](https://x.com/perrypumas/status/894001459754180609) |
| X video | [Upstream sample post](https://x.com/perrypumas/status/1065692031626829824) |
| Instagram album | [Public sample album](https://www.instagram.com/p/BoHk1haB5tM/) |
| YouTube | [Big Buck Bunny](https://www.youtube.com/watch?v=aqz-KE-bpKQ), [Me at the zoo](https://www.youtube.com/watch?v=jNQXAC9IVRw) |

## Limits of the evidence

Fixture tests prove Papan's workflows without depending on live site availability. A native runner verifies that OS/architecture combination, not every Linux distribution, macOS version, or Windows desktop. Signed installation, notarization, automatic updates, multi-writer synchronization, and crash consistency across multiple external volumes are not claimed.

FFmpeg is used only on downloaded local files; a prior third-party static build crashed while reading a remote stream. Release builds use pinned source and include the corresponding FFmpeg/x264/dav1d archives and configuration. Dependency inventories are included with packages; see [third-party notices](../THIRD-PARTY.md).
