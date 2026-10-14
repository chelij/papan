Papan v0.3.2 improves preview playback, startup recovery, and video imports.

- **Smoother previews.** Resume hidden previews in small batches after the window paints. Visible videos and slideshows keep playing when you work in another window or on another monitor; explicit pauses stay paused.
- **Startup recovery.** Show a loading error and retry action when the library cannot be read, keeping collection actions unavailable until loading succeeds.
- **More reliable video imports.** Refresh temporary media links for downloads and retries, and use matching Firefox session-only login cookies when needed. Credentials stay local and are never saved with collections.
- **Connect local apps.** Give compatible apps on this computer read-only access to selected collections, with separate keys, editable grants, search, media streaming, change notifications, and revocation. Protected collections must be unlocked in Papan; locking or revoking access cancels their active transfers.

[Full changelog](https://github.com/chelij/papan/blob/v0.3.2/CHANGELOG.md) · [User guide](https://github.com/chelij/papan/blob/v0.3.2/docs/usage.md)

Download the desktop archive for your OS/architecture, extract it, and launch `papan`, `papan.exe`, or `Papan.app`. Keep the extracted folder together. The separate `Papan-pose-0.3.2-*` runtimes download automatically after pose setup is confirmed; ordinary collection use does not need them. Each archive/runtime includes a SHA-256 checksum.

All 64 unit groups and the affected renderer/discovery checks pass locally. Native Linux checks verify real focus changes and complete video inspection, saving, decoding, byte ranges, and seeking through the installed app and frozen helper. Release packages are gated by native source and packaged-app checks for Linux x64, Windows x64, and macOS ARM64.

Collection formats, pose attachments, and the Android receiver protocol remain unchanged. App connections introduce a separate, opt-in local library protocol v1 using loopback only. Use the separately released ComfyUI extension v0.1.4 for live connections; v0.1.3 continues reading saved files. Existing Android and saved-file evidence is retained. Firefox containers and partitioned sessions, browser-bound verification, Windows/macOS pose inference, signed installers, and notarization retain their existing limits.

The [main preflight](https://github.com/chelij/papan/actions/runs/38542341012) and [tagged release](https://github.com/chelij/papan/actions/runs/38543780320) passed on all three platforms. All twelve public assets and their checksums are verified. The matching [ComfyUI v0.1.4 release](https://github.com/chelij/comfyui-papan/releases/tag/v0.1.4) passes real-provider tests and Linux live/saved-file workflows in classic and Nodes 2.0. [Verification and compatibility](https://github.com/chelij/papan/blob/main/docs/verification.md#v032-release).

Desktop and pose-worker code are GPL-3.0-or-later; the separate extraction helper is GPL-2.0-only. Packages retain dependency notices and corresponding Python/FFmpeg/x264/dav1d sources. The separately downloaded models are Apache-2.0. [Third-party notices](https://github.com/chelij/papan/blob/v0.3.2/THIRD-PARTY.md).
