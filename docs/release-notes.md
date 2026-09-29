Collection settings now save automatically when you close them.

- Close collection settings with ×, Escape, or Enter to save your changes. The Save settings button has been removed.
- Invalid settings or failed saves keep your edits visible, with an option to discard them.
- Opening and closing unchanged settings does not rewrite your saved collection list.
- New collections still use the Create collection button; closing cancels creation.

Download the archive matching your OS/architecture, extract it, and launch `papan`, `papan.exe`, or `Papan.app`. Keep the extracted folder together. Python and media tools do not need to be installed separately. Each archive has a SHA-256 checksum.

The release workflow runs source and packaged-app checks on the native Linux, Windows, and macOS runners before publishing. These are unsigned early builds; Windows signing and macOS notarization are not configured. Linux builds target the Ubuntu 22.04 runner baseline. Public source extraction may fail when a platform blocks unauthenticated access. No sample library, account, cloud service, or browser-cookie import is included.

Desktop code is GPL-3.0-or-later; the separate helper is GPL-2.0-only. Packages retain dependency notices, exact Python sources, and FFmpeg/x264/dav1d sources and build configuration. See `THIRD-PARTY.md` in the repository for details.
