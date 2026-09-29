<img src="assets/icon.svg" width="64" alt="Papan icon">

# Papan

**A personal board for the things you find on the web.**

Good references disappear into browser tabs and download folders. Papan keeps images, videos, and readable articles together in a quiet desktop canvas. Paste a link, choose what to keep, and collect it locally. No account or cloud service required.

[Download Papan](https://github.com/chelij/papan/releases/latest) · [User guide](docs/usage.md) · [Architecture](docs/architecture.md)

![Papan showing an adaptive board of paintings, with collection tabs and a compact toolbar](docs/demo/board.png)

## What you can do

- **Paste to collect.** Choose individual media, a cover, and a destination collection. Public X posts, YouTube videos, Instagram posts, direct media, and accessible articles use dedicated extraction paths.
- **Browse visually.** Adaptive rows preserve individual media proportions. Albums keep a stable frame; visible videos play silently. Drag pins and tabs into order, or use the keyboard.
- **Make it yours.** Rename pins, change covers, move them between collections, and add tags and personal notes. Undo removals immediately or restore them after restarting.
- **Find it again.** Search titles, notes, tags, and saved text across every collection, including closed tabs. Narrow results by media type, source, and tag.
- **Keep collecting while files save.** A background queue shows progress, cancellation, failures, and retry. Downloading originals does not block library edits.
- **Choose what stays on disk.** Cache smaller previews or download originals. Choose separately whether clicking a pin opens its source or its saved media.
- **Take a collection with you.** Save a lightweight `.papan` list, or export a `.papan.zip` with its local media and metadata for another device.

<details>
<summary>See pin editing and library-wide search</summary>

![Editing a pin's title, tags, notes, collection, and cover](docs/demo/edit.png)

![Searching across collections, with each result showing its collection](docs/demo/search.png)

</details>

Screenshots use public-domain artwork from The Met. [Credits and reproducible demo](docs/demo/credits.md). The installed app starts empty; no sample collection is bundled.

## Try it

Download the archive for your operating system from [Releases](https://github.com/chelij/papan/releases/latest), extract it, and launch `papan` on Linux, `papan.exe` on Windows, or `Papan.app` on macOS. Keep the extracted folder together. Media tools are included; Python is only needed for development.

| Platform | Verification |
| --- | --- |
| [Linux x64](https://github.com/chelij/papan/releases/download/v0.1.1/Papan-0.1.1-linux-x64.tar.gz) | Source and packaged-app checks passed on Ubuntu 22.04. |
| [Windows x64](https://github.com/chelij/papan/releases/download/v0.1.1/Papan-0.1.1-win32-x64.zip) | Source and packaged-app checks passed on the native Windows runner. |
| [macOS Apple silicon](https://github.com/chelij/papan/releases/download/v0.1.1/Papan-0.1.1-darwin-arm64.tar.gz) | Source and packaged-app checks passed on the native macOS ARM64 runner. |

All three platforms passed the [v0.1.1 build checks](https://github.com/chelij/papan/actions/runs/36540499279). This is an early release. Builds are unsigned; macOS notarization and a Windows signing certificate are not configured. A successful runner check is not a claim of testing every desktop or OS version. [Check results and limits](docs/verification.md).

## Run from source

Install Node.js **24.15+** and Python **3.11+**, then:

```sh
git clone https://github.com/chelij/papan.git
cd papan
npm ci
npm run setup
npm start
```

`setup` creates a project-local Python environment and installs the pinned media tools. No API keys or browser cookies are needed. [Build packages and run checks](docs/development.md).

## Under the hood

Electron with a sandboxed vanilla JavaScript renderer; a small IPC surface; atomic local JSON writes with previous snapshots; a durable download queue; Sharp image previews; and a separate Python extraction helper. Portable imports validate archive paths and sizes before committing a new collection.

The interesting tradeoffs are local ownership, recoverable writes, responsive browsing during media work, and predictable mixed-media layout. [Read the architecture and failure handling](docs/architecture.md).

## Limits and license

Papan collects individual public posts and pages. Some platforms block unauthenticated extraction; a successful preview does not guarantee a download. Profiles, feeds, live streams, cloud sync, and account-based extraction are outside the current scope. Saved previews can be viewed without the source, but silent video previews are not original downloads.

Desktop code: **[GPL-3.0-or-later](LICENSE)**. The separate extraction helper is **[GPL-2.0-only](worker/LICENSE)**. Copyleft dependencies make an MIT-only distribution inappropriate for this build. Dependency licenses, source archives, and notices are described in [THIRD-PARTY.md](THIRD-PARTY.md).
