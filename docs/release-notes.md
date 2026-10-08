Papan v0.3.0 adds local pose extraction and brings downloads, pose work, and incoming phone shares together in Activity.

- **Local pose control videos.** Extract DWPose from a saved video on your CPU, without a GPU, Python installation, or running ComfyUI. The result stays attached to the original pin and album video; original video/audio, covers, and previews are preserved.
- **Optional, verified setup.** First use explains the download and requirements before starting. Papan downloads the platform runtime from this release and about 335 MiB of pinned models, checks SHA-256 hashes, then reuses them offline. The checked Linux runtime plus models total about 442 MiB. Allow at least 1 GiB free disk space plus working space for the video.
- **Pose cleanup and playback.** Keep all people or limit detections to 1–10, adjust joint confidence, and replace the pose safely in place. Unlocked protected collections keep source/output media encrypted; cancellation and failures remove temporary plaintext and incomplete outputs.
- **Compact card controls.** Once pose tools are installed, a stickman icon offers extraction or pose playback. A transparent outlined pose badge marks the displayed video's result. Clicking the preview opens pin details, replacing the redundant three-dot button.
- **Shared background progress.** Activity shows unfinished downloads, pose jobs, and mobile shares with the correct recovery actions. Successful shares disappear from Activity while their saved receipts remain in Receive from phone.

- **Reliable rapid collection.** Closing and immediately reopening Add link cancels the old inspection while keeping the new one active.

[Full changelog](https://github.com/chelij/papan/blob/v0.3.0/CHANGELOG.md) · [Pose setup and usage](https://github.com/chelij/papan/blob/v0.3.0/docs/usage.md#extract-poses-for-controlnet)

Download the desktop archive for your OS/architecture, extract it, and launch `papan`, `papan.exe`, or `Papan.app`. Keep the extracted folder together. The separate `Papan-pose-0.3.0-*` assets are downloaded automatically after pose setup is confirmed; ordinary collection use does not need them. Each archive/runtime includes a SHA-256 checksum.

Collection containers and the phone receiver protocol remain version 1. Existing ComfyUI v0.1.3 readers can select saved pose videos through their existing video outputs; ordinary, portable, and encrypted fixture checks passed. Older desktop readers may display pose attachments as ordinary album media. Finish or dismiss pose tasks before downgrading. No new extension sockets are introduced.

Publication is gated on native source and packaged-app checks for Linux x64, Windows x64, and macOS ARM64, plus frozen pose-runtime startup and deterministic worker checks. Actual pose inference has been checked on Linux; Windows/macOS inference, a published Android/desktop or desktop/ComfyUI release pair, and H3 generation quality remain unverified. Desktop builds are unsigned; Windows signing and macOS notarization are not configured.

Desktop and pose-worker code are GPL-3.0-or-later; the separate extraction helper is GPL-2.0-only. Packages retain dependency notices and corresponding Python/FFmpeg/x264/dav1d sources. The separately downloaded models are Apache-2.0. [Third-party notices](https://github.com/chelij/papan/blob/v0.3.0/THIRD-PARTY.md).
