# Verification — 2026-09-29

## Local checks

Environment: Linux x64, Node.js 26.8.2, Electron 44.4.5. Media helper: gallery-dl 1.32.14, yt-dlp 2026.08.19, Instaloader 4.15.3.

- `npm run check`: passed.
- `npm test`: eight test groups passed, covering URL routing/validation, article/media extraction, serialized persistence and metadata recovery, collection settings, real downloads, saved collection references and failure cleanup.
- `npm run test:desktop`: passed in the real Electron app with a temporary library. Checks include the initial black screen and exact prompt, selected media and cover, slideshow changes, source-link dispatch, silent video autoplay, multiple collections and persisted settings, online-to-offline conversion, reopening images/video/text after restart with the fixture server stopped, search/removal, and all 104 pins reached through continuous scrolling.
- Standalone extraction helper built with PyInstaller and its versions command passed without the development Python environment.
- The complete desktop test also passed against the packaged Linux executable. A separate packaged-app check discovered and saved a real YouTube video, then verified that its grid preview was playing silently.
- A synthetic `.netrc` check confirmed the helper disables automatically inherited HTTP credentials before extraction. The check prepared requests locally and did not access any user credential file or send a network request.

Screenshots and machine-readable live results are in the ignored `artifacts/` directory.

## Collection files and closing tabs

- `.papan` files contain ordered pins, source links, text, settings and absolute references to existing media. Saving and opening perform no media copies or moves. Files keep a previous metadata snapshot; mismatched revisions and unavailable destinations reject edits before the local collection changes.
- The collection suite passed in Electron with isolated data. It covers picker cancellation, first save, automatic settings/order updates, closing all tabs, restart with tabs still closed, reopening, conflicting external changes, and retained media after removing the local collection entry. Picker responses use temporary paths; the real IPC handlers, storage and renderer are exercised.
- With the fixture server stopped, a fresh profile opened the collection file and played its original video, image and text from their existing locations. The fresh profile's media folder remained empty. Screenshots: `artifacts/open-collections.png` and `artifacts/collection-destination.png`; results: `artifacts/collections-check.json`.
- Syntax checks, all eight test groups, and the full desktop, layout and interaction suites passed. Native dragging still works with tab close buttons, and the six toolbar buttons remain visible at narrow widths.
- The rebuilt Linux app passed the collection suite, including reopening the cached local copy when the destination is unavailable. Packaged source matches the tested implementation. The existing user library stayed unchanged during verification; a named metadata backup was retained before the update.

## Shared album frames

- Albums use the median of their visual media's aspect ratios, with a geometric midpoint for the two middle values. This favors common proportions and treats equally tall/wide alternatives symmetrically. Cover choice and media order do not determine the frame. Slides crop to fill it; individual media retains its own proportions.
- Syntax checks, all five core test groups, and the desktop, layout and interaction suites passed. The desktop suite verifies a fixed frame across a portrait/landscape slideshow and full video-to-image playback, including a video whose dimensions were missing from saved metadata.
- Layout cases cover a 3:4 majority with a 9:16 cover, different cover/order, caption text, balanced wide/tall media, different resolutions, unknown image dimensions, an unavailable slide, and live square-frame preview/cancellation. Album frames remain unchanged when slides advance. Results and screenshots: `artifacts/layout-check.json`, `artifacts/album-frames.png`.
- Native dragging now also exercises an album with a cover narrower than its shared frame. Its outlined placeholder preserves the shared proportions, neighbors reflow before drop, and the final positions match the preview.
- Rebuilt the Linux portable app, verified its renderer files match the source, and passed the complete desktop suite against that package, including fixed mixed video/image frames and offline reopening.

## Toolbar, dragging and live settings

- Pin dragging now uses an empty outlined placeholder in the adaptive row layout. Native mouse checks verify that neighboring pins move before drop, the outline retains the pin's proportions, the saved order stays unchanged during hover, a still pointer does not repeatedly reshuffle the board, and the final drop matches the preview geometry. Cancelling a preview across rows restores the original positions. These checks passed in development and in the rebuilt Linux portable app; the layout suite and all five core test groups also passed. `artifacts/pin-drag-preview.png` shows the result.
- Syntax checks and all five core test groups passed. The updated desktop and layout suites also passed.
- The interaction suite verifies the status below the logo and four matching toolbar buttons, search opening/focus/filter clearing, and controls remaining visible at 560–1200px.
- Native pointer drags move pins and tabs before or after another item. Keyboard reordering, cancelling a drag, preserving normal clicks, rejecting invalid or cross-collection moves, and saved order after restart passed. Order uses the existing serialized atomic library writes and previous-snapshot recovery.
- Density and media fit visibly update before Save. Closing restores the saved layout; saving survives restart. The desktop suite verifies live slideshow timing and video pause/resume while settings remain open, without saving prematurely.
- Screenshots: `artifacts/toolbar-and-dragging.png` and `artifacts/settings-live-preview.png`. Interaction results: `artifacts/interaction-check.json`.
- The rebuilt Linux portable app passed the same interaction suite, including persisted order/settings after restart.

## Collection tabs

- Replaced the toolbar collection dropdown with tabs. Syntax checks, all five core test groups, and the complete desktop regression check passed.
- Packaged-app checks verified click switching, the correct collection's pins and storage mode, arrow-key wrapping, Home/End, focus, and creating, renaming and deleting collections.
- A narrow-window check found that long tabs could exceed the strip width. Tab widths now respect the available space. The rebuilt package passed checks with 14 collections at widths from 560px to 1200px, including both sides of the responsive breakpoint; the active tab and toolbar actions remain visible.
- Screenshots: `artifacts/collection-tabs.png` and `artifacts/collection-tabs-overflow.png`. Responsive results: `artifacts/collection-tabs-check.json`.

## Adaptive rows and sliders

- The layout test passes for 9:16, 4:3, 16:9, 1:1, 3:2, 2:3, 3:1, 5:4 and 21:9 media. It checks preserved aspect ratios, insertion order, no overlap, aligned row heights, and filled completed rows at 1280px and 640px window widths.
- Both sliders cover 1–10. Density changes tile sizes, while the slideshow value is measured in seconds. Mouse dragging, keyboard adjustment, displayed values, persistence after restart, and cancelling unsaved changes passed.
- Responsive tests restore Electron's native viewport before checking pointer coordinates; simulated viewport scaling otherwise changes native slider hit testing. The scrolling assertion accepts loading more than one batch when the new layout is still near the bottom.
- Earlier named tile sizes and column counts are read as equivalent density values. Loading normalizes the in-memory settings without overwriting the saved file; normal saves retain the previous snapshot.
- `artifacts/adaptive-layout.png` shows the verified mixed-ratio layout. `artifacts/layout-check.json` records the layout results.
- The full desktop regression check passed after the layout change, including full video playback, stable album frames, offline reopening and scrolling through 104 pins. The rebuilt Linux portable app also passed the dedicated layout and slider checks.

## Earlier full-media preview update

- Syntax checks and all five core test groups passed after the update. Image checks verify a 3200 × 1600 original is retained offline while its preview is 1280 × 640; animated image previews retain both frames and their timing.
- The desktop check passed with three columns, uncropped landscape and portrait tiles, and a 12-second video resized from 1280 × 960 to 720 × 540. The online album video continued beyond eight seconds and advanced only after ending. Offline playback, collection settings, and scrolling past 100 pins still passed.
- The complete updated desktop check also passed against the rebuilt Linux portable app, including native image resizing from the packaged Sharp dependency.
- Native image resizing uses Sharp, whose [documented resize options](https://sharp.pixelplumbing.com/api-resize/) support proportional downsampling without enlargement. Its native module is included in the desktop package.

## Public source checks

These are sample-level results from this machine, not a guarantee for every post. No login, user cookies, account connection or browser session was used. Downloaded test files were stored in temporary libraries and removed after the checks.

| Source | Sample | Observed result |
| --- | --- | --- |
| X images | https://x.com/perrypumas/status/894001459754180609 | gallery-dl discovered four images and text; a selected original image downloaded successfully. |
| X video | https://x.com/perrypumas/status/1065692031626829824 | gallery-dl discovered the video and text; full video and local silent preview saved successfully. |
| Instagram album | https://www.instagram.com/p/BoHk1haB5tM/ | gallery-dl was blocked; Instaloader's unauthenticated fallback discovered five images and caption text. Two selected images downloaded successfully. |
| YouTube preview | https://www.youtube.com/watch?v=aqz-KE-bpKQ | yt-dlp discovered the video and text; preview generation succeeded after the network-download fix described below. |
| YouTube offline | https://www.youtube.com/watch?v=jNQXAC9IVRw | yt-dlp downloaded the full video; local preview generation succeeded. |

The X and Instagram sample URLs come from upstream gallery-dl extraction tests. The YouTube samples are public videos. Discovery results are in `artifacts/site-checks.json`; download results are in `artifacts/download-checks.json`.

## Fixes found during verification

- Continuous scrolling could stall at the second page because the sentinel's intersection state had not reset before another scroll. A near-end check on scroll/resize and after each appended page now reaches the final page reliably.
- The initial video-preview format selector assumed a combined audio/video format. Some YouTube responses offered separate streams only. Preview selection now accepts video-only formats; full downloads can merge separate audio/video streams.
- The bundled FFmpeg 7.0.2 static Linux binary segfaulted while reading a remote stream for an eight-second range download. The core confirmed SIGSEGV during that command; no OOM event was recorded. The binary has no useful debug symbols, so an exact internal fault was not established. Papan now lets yt-dlp download the stream and uses FFmpeg only on the local file. The temporary crash-diagnosis core copy was removed, and no user library data was involved.
- Screenshot capture sometimes ran before Electron showed its first frame. The desktop test now waits for a visible window and rendered frames.
- Packaged helpers cannot be spawned from an Electron ASAR archive. The portable package keeps its runtime files unpacked; the packaged desktop and YouTube checks passed with this layout.

## Distribution checks

The Linux x64 portable app and archive were built and tested locally. The project includes native build/test jobs for Linux, Windows and macOS. Cross-platform paths, keyboard shortcuts, the app data directory, the Python helper and FFmpeg selection use platform APIs. Windows/macOS jobs have not been executed from this local session. Signing, notarization and installer publishing are not configured.

Video preview generation downloads a low-resolution version when available and encodes its full duration locally. Online pins keep the resulting silent playback copy. Files remain bounded to 512 MiB and each download or video-conversion operation to five minutes.
