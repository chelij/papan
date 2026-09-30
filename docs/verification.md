# Verification

The v0.2.0 local preflight on 30 September 2026 passed syntax checks, all 23 unit test groups, and all seven renderer suites. Tests use disposable profiles and local fixture servers; the personal library is never a test fixture. The pinned extraction helper uses gallery-dl 1.32.14, yt-dlp 2026.08.19, and Instaloader 4.15.3.

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
| `test:slideshow` | No blank frames after the first image; delayed/broken-image handling, slide order and display intervals, collection switches during loading, and video-to-image transitions |
| `test:protection` | Password setup/change/removal, unlock popups and cancellation, locked search/media, restart locking, encrypted video seeking, successful queue cleanup, and failed-task access |
| `test:settings` | Compact sections, keyboard navigation, stable bounds, drafts and autosave, hidden-field validation, save failures, creation, and short-window scrolling |
| `test:tabs` | Temporary tabs, shortcuts, ordering, close/reopen, narrow layouts, password cancellation, unchanged metadata after unused/cancelled tabs, and exactly one collection on the first confirmed save |
| `test:history` | Clearing and failed saves, restart persistence, All collections access, ordinary/encrypted reopening, and new recent entries after closing; collection files, media, and removal history remain intact |

Encryption unit tests cover incorrect passwords, altered manifests and media chunks, cross-chunk ranges, password/key rotation, encrypted queue rollback, current/recovery metadata, portable encrypted copies, shared/imported file preservation, and move/delete/restore flows. A separate local headless Electron probe checks actual media protocol responses and real main-process protection handlers without opening a window. Its IPC transport and native dialogs are replaced with fixture calls. [Encryption format and limits](encryption.md).

## Native release checks

The [desktop workflow](../.github/workflows/desktop.yml) repeats syntax, unit, and all five source desktop suites on Linux x64, Windows x64, and macOS ARM64. Linux also runs all seven renderer suites using the runner's Google Chrome. Every platform builds its native helper/media tools, checks AV1-to-H.264 processing, packages the app, and reruns the desktop and organization suites against the packaged executable. Tagged releases publish only after every build passes. [Recorded runs](https://github.com/chelij/papan/actions/workflows/desktop.yml) identify the exact commit and runner versions.

The previous [v0.1.1 pre-release run](https://github.com/chelij/papan/actions/runs/36540499279) and [tagged release run](https://github.com/chelij/papan/actions/runs/36541095426) passed all native source and packaged checks on all three platforms. That evidence covers v0.1.1; the v0.2.0 changes require their own passing native run before tagging. No native test window is opened on the primary local monitor.

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
