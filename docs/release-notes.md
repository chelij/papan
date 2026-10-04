Papan v0.2.2 improves board scrolling, preview zoom, and video playback visibility.

- Scroll smoothly by one row per mouse-wheel step, using the current preview height. Rapid wheel input accumulates rows; reduced-motion preferences disable the animation.
- Choose from 40 preview-size levels, with finer steps and smaller previews. Ctrl + mouse wheel skips levels that would leave the column layout unchanged at the current window width.
- Keep the same pin in the top row when zooming or resizing, including when zoom changes during a scroll animation.
- Scroll any row to the top, including the final row, with blank space below the board. Row alignment no longer leaves a strip of the preceding row visible beneath the header.
- Pause videos outside the visible board, in clipped viewer/editor areas, and when the window or document is hidden. Resume from the retained playback position when allowed, while preserving explicit pauses and reduced-motion settings.

Existing collections keep their saved preview size; the default now displays as level 35 on the expanded scale. Collections saved with intermediate or newly expanded preview sizes require an updated Papan build when opened elsewhere. [Full changelog](https://github.com/chelij/papan/blob/v0.2.2/CHANGELOG.md).

Download the archive matching your OS/architecture, extract it, and launch `papan`, `papan.exe`, or `Papan.app`. Keep the extracted folder together. Python and media tools are bundled. Each archive includes a SHA-256 checksum.

The release workflow gates publication on native Linux, Windows, and macOS checks, real media conversion, and packaged-app workflows. Desktop builds remain unsigned; Windows signing and macOS notarization are not configured. Source-platform availability and browser-session access can vary. No sample library or cloud account is bundled.

Desktop code is GPL-3.0-or-later; the separate extraction helper is GPL-2.0-only. Packages retain dependency notices and corresponding Python/FFmpeg/x264/dav1d sources. [Third-party notices](https://github.com/chelij/papan/blob/v0.2.2/THIRD-PARTY.md).
