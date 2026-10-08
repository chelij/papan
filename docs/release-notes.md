Papan v0.3.1 fixes image discovery from webpages and Reddit posts.

- **Images loaded by webpages.** Find media added by JavaScript, lazy and responsive images, hidden gallery slides, and lightbox originals. Direct media and static pages keep their fast path.
- **Reddit galleries.** Collect the selected post's original photos in both current and classic layouts, excluding sidebar images, adverts, comments, and duplicate previews. Keep its title, author, and text.
- **Existing browser sessions.** After public discovery or a media download fails, retry with the linked site's local browser cookies when **Privacy → use browser sessions** is enabled. Cookies stay local, remain scoped to the site, and are cleared after temporary browser use. This also applies to links received from Android.
- **Clear verification errors.** Human-verification pages are reported instead of becoming text pins. Complete verification or sign in in your browser, then retry in Papan.

[Full changelog](https://github.com/chelij/papan/blob/v0.3.1/CHANGELOG.md) · [User guide](https://github.com/chelij/papan/blob/v0.3.1/docs/usage.md)

Download the desktop archive for your OS/architecture, extract it, and launch `papan`, `papan.exe`, or `Papan.app`. Keep the extracted folder together. The separate `Papan-pose-0.3.1-*` runtimes download automatically after pose setup is confirmed; ordinary collection use does not need them. Each archive/runtime includes a SHA-256 checksum.

All 55 unit tests and native headless discovery checks pass locally, including cancellation before a download runner starts. Native checks cover cookie-gated galleries using a synthetic Firefox profile, anonymous-first/off behavior, redirect scoping, decoded downloads, and cancellation cleanup. The reported Reddit link yielded all 13 original photos using an existing browser session, and the user confirmed the installed fix works. Release packages are gated by native source and packaged-app checks for Linux x64, Windows x64, and macOS ARM64.

Collection formats, pose attachments, and receiver protocol remain unchanged. Existing Android v0.2.0 and ComfyUI v0.1.3 contract evidence remains valid; this release does not establish a new published release-pair check. Browser storage, extensions, and fingerprint are not copied, so some verification challenges, interactive galleries, or browser-only streams may still prevent collection. Windows/macOS pose inference remains unverified. Desktop builds are unsigned; Windows signing and macOS notarization are not configured.

Desktop and pose-worker code are GPL-3.0-or-later; the separate extraction helper is GPL-2.0-only. Packages retain dependency notices and corresponding Python/FFmpeg/x264/dav1d sources. The separately downloaded models are Apache-2.0. [Third-party notices](https://github.com/chelij/papan/blob/v0.3.1/THIRD-PARTY.md).
