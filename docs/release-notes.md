Papan v0.2.0 adds encrypted collections, editable media previews, and a smoother tab and playback experience.

- Protect individual collections and their saved media with a password. Locked tabs ask for a password before opening; encrypted saves and portable exports stay protected.
- Choose board previews from saved media. Select several videos and give each its own start/end range, with frame previews for both boundaries. The viewer still plays the complete video.
- Open temporary tabs with + or Ctrl/Cmd+T, close them with Ctrl/Cmd+W, and switch with Ctrl+Tab. A new collection is created only after confirming the first pasted link; unused tabs leave no history.
- Clear the recent list in Open collection while keeping saved collections accessible under All collections.
- Drag pins onto collection tabs to move them. Create a destination directly from the Edit pin dropdown.
- Use compact General, Storage, and Privacy settings sections. Changes save when the popup closes; preview size increases from small to large.
- Pins always open in Papan first. Saved video playback supports seeking, image slideshows retain the current image while the next loads, and successful downloads disappear from the queue.
- Clicking outside a popup dismisses it. The toolbar, divider, tab controls, keyboard focus, and scrollbar layout have been refined.

Existing unprotected libraries remain readable. Encrypted collections require v0.2.0 or later and cannot be opened by older releases. There is no password recovery; keep your password and an encrypted export somewhere safe. Collection names and destinations remain visible. See [the encryption design and limits](https://github.com/chelij/papan/blob/v0.2.0/docs/encryption.md).

Download the archive matching your OS/architecture, extract it, and launch `papan`, `papan.exe`, or `Papan.app`. Keep the extracted folder together. Python and media tools do not need to be installed separately. Each archive has a SHA-256 checksum.

The release workflow runs unit and native desktop checks on Linux, Windows, and macOS, plus the preview, playback, slideshow, protection, settings, tab, and history suites on Linux. Source and packaged-app checks must pass before packages are published. Builds are unsigned; Windows signing and macOS notarization are not configured. Linux packages target the Ubuntu 22.04 runner baseline. Public source extraction may fail when a platform blocks unauthenticated access. No sample library, account, cloud service, or browser-cookie import is included.

Desktop code is GPL-3.0-or-later; the separate helper is GPL-2.0-only. Packages retain dependency notices, exact Python sources, and FFmpeg/x264/dav1d sources and build configuration. See [third-party notices](https://github.com/chelij/papan/blob/v0.2.0/THIRD-PARTY.md).
