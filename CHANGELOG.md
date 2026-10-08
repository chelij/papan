# Changelog

## 0.3.0 — 2026-10-09

Changes since [v0.2.3](https://github.com/chelij/papan/releases/tag/v0.2.3).

### Added

- Extract local DWPose control videos from saved videos without a GPU, Python installation, or running ComfyUI server. Attach each result to its original pin and album video while preserving the original video, audio, cover, and previews.
- Download the optional platform runtime and pinned models only after confirming first-use setup. Show download size and requirements, verify every asset with SHA-256, and reuse installed tools offline. Pose dependencies are separate release assets rather than part of the base app.
- View an extracted pose explicitly, choose all people or a limit of 1–10, cycle joint-confidence presets, and re-extract safely in place. Preserve attachment identities, settings, and collection encryption across retries and reopening.
- Show a compact stickman action on video cards once pose tools are installed. Its tooltip identifies extraction or playback, and a transparent outlined pose badge indicates an extracted result for the displayed video.

### Changed

- Rename Downloads to Activity and include unfinished mobile shares alongside downloads and pose work. Combine queued/running counts, show saving and unlock progress, and route recovery actions to the correct queue. Saved phone receipts remain available in receiver settings.
- Remove the redundant three-dot card button. Clicking the preview still opens the complete pin viewer and editor; the pose icon uses the former button's size and position.

### Fixed

- Retain derived pose media during preview repair, collection conversion, media cleanup, recovery, and removal history. Keep protected source/output media encrypted and clean up temporary plaintext on cancellation or failure.
- Keep a newly reopened add dialog’s inspection active when an earlier close event arrives; cancel the closed request without discarding the new one.
- Preserve playing card previews when attachments change, and keep pose controls aligned with the displayed album video while the next slide loads.

### Compatibility and checks

- Collection containers and phone receiver protocol remain version 1. Pose attachments use optional video-item metadata. Older desktop readers may show them as ordinary album media; finish or dismiss pose tasks before downgrading.
- Existing ComfyUI v0.1.3 readers can select saved pose videos through their existing video outputs. Fixture checks cover ordinary, portable, and encrypted attachments; a published desktop/extension pair and H3 generation quality are not established by those checks.
- Add renderer, queue, attachment, protection, frame-batching, and people/confidence regressions. Release builds also exercise deterministic skeleton drawing and frozen pose-runtime imports on each platform. Local real inference is verified on Linux; Windows/macOS inference remains unverified.

## 0.2.3 — 2026-10-07

Changes since [v0.2.2](https://github.com/chelij/papan/releases/tag/v0.2.2).

### Fixed

- Keep existing board previews, video positions, measured dimensions, and loaded rows when new pins arrive. Preserve partial scroll positions and smooth wheel scrolling while new media proportions are applied after scrolling settles.
- Ignore older library refresh replies after newer data or a saved reorder arrives. Keep the user's current board when an earlier save finishes, while honoring pending foreground requests to open a collection.
- Retain the active board when closing an unused background tab or clearing recent history. Keep unchanged collection tabs and their keyboard focus during background refreshes.
- Keep the last decoded frame visible while a slideshow video loads and seeks to its preview start. Slow or failed images and videos preserve the previous frame, advance correctly, and cancel safely when switching boards.
- Publish native window visibility on focus so visible video previews can promptly reevaluate playback after returning to the app.

### Checks

- Cover saves before and during smooth scrolling in both directions, loaded-row retention, late dimensions, overlapping refresh replies, saved reorder protection, foreground board choices, and unchanged tab focus.
- Sample slideshow frames through delayed and failed media transitions, and verify that saves retain the same decoded video and explicit pause state.

## 0.2.2 — 2026-10-04

Changes since [v0.2.1](https://github.com/chelij/papan/releases/tag/v0.2.1).

### Changed

- Scroll the board smoothly by one row per mouse-wheel step, using the current preview height. Rapid wheel input accumulates rows; reduced-motion preferences disable the animation.
- Expand preview size from 10 to 40 levels, with finer steps and smaller previews. Ctrl+wheel skips levels that produce identical columns at the current window width.
- Keep the same pin in the top row when zooming or resizing, and cancel obsolete scroll animations when row dimensions change.
- Add blank space below the board so the final row can reach the top. Align rows beneath the header without showing a strip of the preceding row, including at fractional scroll positions.

### Fixed

- Pause videos outside the visible board, in clipped viewer/editor areas, and when the window or document is hidden. Resume from the retained position when playback is allowed, while preserving explicit pauses.
- Prevent native video autoplay from starting board previews outside the visible canvas.

### Checks

- Add headless regression suites for scrolling and video visibility, and run both in Linux CI.
- Cover adaptive zoom at window widths from 560 to 3840 pixels, zoom limits, smooth-scroll accumulation, top-pin retention, search summaries, lazy loading, and final-row alignment.
- Extend settings validation and saved-list tests for intermediate preview sizes, and update desktop checks for the expanded zoom range.
- Model cancellation explicitly in the temporary-tab workflow regression.

### Compatibility

- Existing collections keep their saved preview size. The default size now displays as level 35 on the new scale.
- Collections saved with intermediate or newly expanded preview sizes require an updated Papan build when opened elsewhere.
