Papan v0.2.3 keeps the board stable when new pins arrive and improves preview playback when returning to the app.

- Keep existing previews, video positions, and loaded rows when a pin is added. Preserve partial scroll positions and smooth wheel scrolling while new media dimensions arrive.
- Ignore older refresh replies after newer pins or a saved reorder arrive, and retain the current board when an earlier save finishes.
- Keep the active board and tab focus when closing a background tab or clearing recent history.
- Keep the last decoded slideshow frame visible while the next image or video loads. Slow or failed media preserve the previous frame and advance safely.
- Reevaluate visible video playback on native window focus, while retaining explicit pauses and reduced-motion settings.

Existing collections and saved settings remain compatible with v0.2.2. [Full changelog](https://github.com/chelij/papan/blob/v0.2.3/CHANGELOG.md).

Download the archive matching your OS/architecture, extract it, and launch `papan`, `papan.exe`, or `Papan.app`. Keep the extracted folder together. Python and media tools are bundled. Each archive includes a SHA-256 checksum.

The release workflow gates publication on native Linux, Windows, and macOS checks, real media conversion, and packaged-app workflows. Desktop builds remain unsigned; Windows signing and macOS notarization are not configured. Source-platform availability and browser-session access can vary. No sample library or cloud account is bundled.

Desktop code is GPL-3.0-or-later; the separate extraction helper is GPL-2.0-only. Packages retain dependency notices and corresponding Python/FFmpeg/x264/dav1d sources. [Third-party notices](https://github.com/chelij/papan/blob/v0.2.3/THIRD-PARTY.md).
