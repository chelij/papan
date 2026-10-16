Papan v0.3.3 brings desktop collection browsing to [Papan for Android 0.3.0](https://github.com/chelij/papan-android/releases/tag/v0.3.0).

- **Browse desktop boards on your phone.** Enable phone browsing in Receive from phone, then view open collections and save links into a chosen destination. Protected collections ask for their password on the phone and retain access for the running app session.
- **Pair nearby and reconnect automatically.** Choose a nearby desktop in Android, compare its six-digit code and approve on the computer. Paired phones verify the same desktop before recovering a changed IP address or receiver port. QR/manual pairing remains available.
- **Keep desktop previews and order.** Authenticated image/video covers and collection proportions give the phone vertical previews where appropriate. Desktop rearrangements appear on the phone without changing saved order or asking again for already authorized collections.
- **Preserve queued destinations.** Links retain their selected collection through offline storage, retry and endpoint recovery. Phone and desktop libraries remain separate.
- **Restore macOS CI coverage.** The receiver fixture's second loopback address is assigned and removed explicitly.

[Full changelog](https://github.com/chelij/papan/blob/v0.3.3/CHANGELOG.md) · [User guide](https://github.com/chelij/papan/blob/v0.3.3/docs/usage.md) · [Phone setup and protection](https://github.com/chelij/papan/blob/v0.3.3/docs/mobile-sharing.md)

Download the desktop archive for your OS/architecture, extract it, and launch `papan`, `papan.exe`, or `Papan.app`. Keep the extracted folder together. The separate `Papan-pose-0.3.3-*` runtimes download after pose setup is confirmed; ordinary collection use does not need them. Every archive/runtime includes a SHA-256 checksum. Install Android's APK from its separate release.

Native Android 16/API 36 checks use a disposable headless emulator and private displays. They cover phone collection/capture/editing, selected desktop saves, protected session lifetimes, rotation, desktop order, paging/search, cached thumbnails, video playback and the Explore-style board/viewer, including synchronized scrolling bars. Three saves reach the real temporary receiver. The signed Android APK matches the tested application classes/source and installed package bytes. Physical phones are excluded from automated behavior tests; installation preserves app data. [Exact evidence and limits](https://github.com/chelij/papan/blob/main/docs/verification.md#android-synchronized-scrolling-bars-16-october-2026).

Release publication requires passing native source and packaged-app checks on Linux x64, Windows x64 and macOS ARM64. Saved, portable and encrypted collection formats, pose attachments and the local app-library protocol remain unchanged. ComfyUI v0.1.4 retains its existing live/saved-file compatibility; no extension update is required. Receiver v1 gains optional Android browsing/session/thumbnail/discovery capabilities while preserving legacy clients.

Sharing uses HTTP on a trusted local network. Phone and desktop libraries do not synchronize automatically. Physical animation/performance, optical QR, Android 8, iOS, a complete published Android Wi-Fi release-pair check and Windows/macOS pose inference remain unverified. Desktop builds are unsigned; signing, notarization and automatic updates are not implemented.

Desktop and pose-worker code are GPL-3.0-or-later; the separate extraction helper is GPL-2.0-only. Packages retain dependency notices and corresponding Python/FFmpeg/x264/dav1d sources. The separately downloaded models are Apache-2.0. [Third-party notices](https://github.com/chelij/papan/blob/v0.3.3/THIRD-PARTY.md).
