# Changelog

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
