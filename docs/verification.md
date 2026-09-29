# Verification

Local source checks on 29 September 2026 used Linux x64, Node.js 26.8.2, and Electron 44.4.5. The helper uses gallery-dl 1.32.14, yt-dlp 2026.08.19, and Instaloader 4.15.3. All desktop checks use temporary profiles and local fixture servers.

| Check | What it proves | Local source result |
| --- | --- | --- |
| `npm run check` | Syntax across source, scripts, and tests | Pass |
| `npm test` | 11 test groups: URL routing, extraction, atomic persistence, settings, real media processing, saved lists, pin validation, queue restart/cancel/retry, portable round trip and archive rejection | Pass |
| `test:desktop` | Empty canvas, selection, albums, full-duration video, storage conversion, restart without source server, images/video/text, search and 100+ pins | Pass |
| `test:layout` | Mixed proportions, stable album frames, sliders, resizing, live settings, missing dimensions | Pass |
| `test:interactions` | Native pointer drag previews, cancellation, keyboard reorder, tabs, toolbar and responsive controls | Pass |
| `test:collections` | Native dialog paths, list saves, auto-updates, close/reopen, conflicts, unavailable destinations, retained media | Pass |
| `test:organization` | Canvas paste, editing, notes/tags/cover/move, global search including closed tabs, undo, two-destination rollback, nonblocking save, cancel/retry, portable import after deleting source media | Pass |

The organization test deliberately holds a media response open and checks that creating a collection still finishes promptly. It also changes the second saved list externally, attempts a move, and confirms neither local metadata nor the first saved list changes. Portable import is checked in a fresh profile after the source server stops and the original local media is removed.

The [desktop workflow](../.github/workflows/desktop.yml) repeats source checks on three native OS runners, builds packages, then reruns desktop and organization workflows against the packaged executables. Tagged releases are gated on all jobs. See [Actions](https://github.com/chelij/papan/actions/workflows/desktop.yml) for exact commits, OS versions, and packaged-build results.

## Native release checks

The [v0.1.0 pre-release run](https://github.com/chelij/papan/actions/runs/36526731016) passed on 29 September 2026 at commit `0e0a4ee`, the commit tagged `v0.1.0`.

| Platform | Syntax, unit, and all five source workflows | Native media build and AV1-to-H.264 check | Packaged desktop and organization workflows |
| --- | --- | --- | --- |
| Linux x64 (Ubuntu 22.04) | Pass | Pass | Pass |
| Windows x64 | Pass | Pass | Pass |
| macOS ARM64 | Pass | Pass | Pass |

The collection-file suite also checks opening the collection browser immediately after closing a tab, before the asynchronous close finishes. That sequence passes from both the Linux source app and its rebuilt package. Tests use disposable profiles, so the personal library remains untouched.

## Live sources

Earlier checks on this date successfully discovered and downloaded selected public X images/video, a public Instagram album using the unauthenticated fallback, and public YouTube videos. These are sample-level observations, not a guarantee for every link. Optional live checks write their current results to `artifacts/site-checks.json`; they are not a CI requirement.

| Sample | Source |
| --- | --- |
| X images | [Upstream sample post](https://x.com/perrypumas/status/894001459754180609) |
| X video | [Upstream sample post](https://x.com/perrypumas/status/1065692031626829824) |
| Instagram album | [Public sample album](https://www.instagram.com/p/BoHk1haB5tM/) |
| YouTube | [Big Buck Bunny](https://www.youtube.com/watch?v=aqz-KE-bpKQ), [Me at the zoo](https://www.youtube.com/watch?v=jNQXAC9IVRw) |

## Limits of the evidence

Fixture tests prove Papan's workflows without depending on live site availability. A native runner verifies that OS/architecture combination, not every Linux distribution, macOS version, or Windows desktop. Signed installation, notarization, automatic updates, multi-writer synchronization, and crash consistency across multiple external volumes are not claimed.

FFmpeg is used only on downloaded local files; a prior third-party static build crashed while reading a remote stream. Release builds use pinned source and include the corresponding FFmpeg/x264/dav1d archives and configuration. Dependency inventories are included with packages; see [third-party notices](../THIRD-PARTY.md).
