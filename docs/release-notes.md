Papan v0.2.1 adds local phone sharing and improves collection browsing and downloads.

- Pair [Papan for Android](https://github.com/chelij/papan-android) over a trusted local network. Shared or pasted phone links save into the selected collection, with persistent queues, receipts, retry, duplicate handling, and locked-collection protection. Download the APK from the companion's [Releases](https://github.com/chelij/papan-android/releases/latest).
- Try public extraction first, then automatically find an existing desktop browser login for X, Instagram, or YouTube when needed. Disable this fallback in Privacy settings. Cookies stay local and are never sent to a phone.
- Align every collection row in equal-width columns. Preview frames use the average proportions of the collection's media; square frames remain available.
- Resize previews with Ctrl + mouse wheel anywhere between the header and footer. Preview size persists with the collection.
- Keep the pin count and Downloads button in a fixed footer. Copy a pin's original link beside Open original.
- Fix pink video previews with accurate scaling, and rebuild older previews without changing saved originals.

Android source, APK builds, device-test runner, and releases are maintained separately in [chelij/papan-android](https://github.com/chelij/papan-android). Desktop source and the local receiver protocol remain here. iPhone Shortcut preparation is documented; it has not been tested on iPhone.

Libraries remain compatible with v0.2.0. Local sharing uses ordinary HTTP; use a trusted network and allow the selected desktop TCP port through its firewall. Download the archive matching your OS/architecture, extract it, and launch `papan`, `papan.exe`, or `Papan.app`. Keep the extracted folder together. Python and media tools are bundled. Each archive includes a SHA-256 checksum.

The release workflow gates publication on native Linux, Windows, and macOS checks, real media conversion, and packaged-app workflows. Desktop builds remain unsigned; Windows signing and macOS notarization are not configured. Source-platform availability and browser-session access can vary. No sample library or cloud account is bundled.

Desktop code is GPL-3.0-or-later; the separate extraction helper is GPL-2.0-only. Packages retain dependency notices and corresponding Python/FFmpeg/x264/dav1d sources. [Third-party notices](https://github.com/chelij/papan/blob/v0.2.1/THIRD-PARTY.md).
