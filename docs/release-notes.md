Papan v0.3.4 improves webpage capture and saved-collection recovery.

Changes since **v0.3.3**:

- Keep recovery backups beside extensionless saved collection files.
- Accept direct-media MIME headers with whitespace before parameters.
- Save links whose media filenames contain literal percent signs or invalid UTF-8 escapes.
- Preserve commas inside responsive-image URLs when choosing from `srcset`.
- Honor a webpage's declared document base when resolving relative images and videos, while retaining the original source link and existing URL validation.

[Changelog](https://github.com/chelij/papan/blob/v0.3.4/CHANGELOG.md) · [Full comparison](https://github.com/chelij/papan/compare/v0.3.3...v0.3.4) · [Download the diff](https://github.com/chelij/papan/releases/download/v0.3.4/papan-v0.3.3-to-v0.3.4.diff)

Download the archive for your OS/architecture, extract it, and launch `papan`, `papan.exe`, or `Papan.app`. Keep the extracted folder together. Matching `Papan-pose-0.3.4-*` runtimes are separate assets and download only after pose setup is confirmed. Every archive, runtime and diff has a SHA-256 checksum.

This release is gated by native source and packaged-app checks on Linux x64, Windows x64 and macOS ARM64, including collection export/import and local app connections. Linux also checks webpage discovery, renderer workflows and phone reception. The 78 desktop tests cover the new regressions. [Checks and publication evidence](https://github.com/chelij/papan/blob/main/docs/verification.md#reliability-releases-17-october-2026).

Collection formats, pose attachments and receiver/library protocols retain v1 compatibility. [Android 0.3.1](https://github.com/chelij/papan-android/releases/tag/v0.3.1) and [ComfyUI 0.1.5](https://github.com/chelij/comfyui-papan/releases/tag/v0.1.5) carry their companion reliability fixes. Existing supported clients remain compatible; Android browsing still requires desktop 0.3.3+, and live ComfyUI connections require desktop 0.3.2+.

Desktop builds remain unsigned, with no macOS notarization or automatic updater. Sharing uses HTTP on a trusted local network. Phone and desktop libraries remain separate. Physical performance, optical QR/Wi-Fi, Android 8/iOS, Windows/macOS ComfyUI behavior and H3 generation quality retain their documented verification limits. [User guide](https://github.com/chelij/papan/blob/main/docs/usage.md) · [Protection limits](https://github.com/chelij/papan/blob/main/docs/mobile-sharing.md).

Licensed GPL-3.0-or-later. Runtime source and dependency notices accompany the packages. [Dependency notices](https://github.com/chelij/papan/blob/v0.3.4/THIRD-PARTY.md).
