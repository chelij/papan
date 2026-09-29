Papan's first public desktop release: a local board for images, videos, and readable articles.

- Paste directly onto the canvas, select what to keep, and save in the background.
- Edit titles and covers, move pins, add tags and notes, and undo removals across restarts.
- Search every collection, including closed tabs, with media, source, and tag filters.
- Choose cached previews or downloaded originals separately from click behavior.
- Save lightweight `.papan` lists or export `.papan.zip` copies containing local media.
- Adaptive rows, stable album frames, silent video previews, drag and keyboard reordering.

Download the archive matching your OS/architecture, extract it, and launch `papan`, `papan.exe`, or `Papan.app`. Keep the extracted folder together. Python and media tools do not need to be installed separately. Each archive has a SHA-256 checksum.

The release workflow runs source and packaged-app checks on the native Linux, Windows, and macOS runners before publishing. These are unsigned early builds; Windows signing and macOS notarization are not configured. Linux builds target the Ubuntu 22.04 runner baseline. Public source extraction may fail when a platform blocks unauthenticated access. No sample library, account, cloud service, or browser-cookie import is included.

Desktop code is GPL-3.0-or-later; the separate helper is GPL-2.0-only. Packages retain dependency notices, exact Python sources, and FFmpeg/x264 sources and build configuration. See `THIRD-PARTY.md` in the repository for details.
