# Verification

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

The [desktop workflow](../.github/workflows/desktop.yml) repeats syntax, unit, and all five source desktop suites on Linux x64, Windows x64, and macOS ARM64. Linux also runs all nine renderer suites using the runner's Google Chrome. Every platform builds its native helper/media tools, checks AV1-to-H.264 processing, packages the app, and reruns the desktop and organization suites against the packaged executable. Tagged releases publish only after every build passes. [Recorded runs](https://github.com/chelij/papan/actions/workflows/desktop.yml) identify the exact commit and runner versions.

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
