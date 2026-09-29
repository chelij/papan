# Papan

A private desktop canvas for the things you collect from the web.

Start with an empty black screen: **paste link to start collecting**, or open a saved collection. Paste a public post, pick the media and a cover, and save it. The first save creates your first collection.

## Use

- Paste anywhere on the canvas, click the empty-state text, or press **Ctrl/Cmd+K** to add a link.
- Pins fill adaptive rows from left to right and top to bottom. New pins appear at the end. Drag a pin to reorder it: an empty outline reserves its space while the other pins move into their proposed positions. Dropping saves the order; Escape cancels the preview. You can also drag collection tabs. With a pin or tab focused, **Alt+Left/Right** moves it one place. Individual media preserves its aspect ratio without cropping: portraits get narrower tiles and landscapes get wider tiles. More pins load as you scroll.
- Visible videos autoplay their full length silently and loop. Albums cycle through images at the chosen interval and let each video finish before advancing. Articles without images appear as text cards.
- After the first save, collections appear as tabs across the top. Click a tab to switch, or use Left/Right and Home/End while a tab is focused. The tab strip scrolls horizontally when needed. The collection's online/offline label sits below the logo. Buttons at the top right create, open and save collections, search, open settings, and add a link. **Ctrl/Cmd+F** also opens search.
- **Save collection** (**Ctrl/Cmd+S**) chooses a destination for a `.papan` file containing the ordered list, source links, text, settings and references to existing media. Media is never copied or moved by saving or opening a collection. Later edits update the chosen file automatically. **Save as…** in collection settings, or **Ctrl/Cmd+Shift+S**, chooses another destination.
- Close a collection with the **×** on its tab; this keeps its data and media. **Open collection** (**Ctrl/Cmd+O**) offers closed collections or a `.papan` file picker. Closed tabs stay closed across restarts. Reopening uses the saved file when available and falls back to Papan's local copy with a notice if it cannot be read.
- Each collection has its own storage mode, layout density, adaptive or square frames, autoplay setting, and slideshow interval. Use the **1–10 layout density** slider for spacious to compact rows, and **1–10 seconds** between album images. Density defaults to 3; the number of items per row depends on their proportions. The settings panel sits at the side; layout, autoplay and slideshow changes preview immediately. Save settings to keep them, or close the panel to restore the saved settings.
- Albums choose one shared frame from all their images and videos, favoring common proportions and balancing wide/tall ties. Three 3:4 slides and one 9:16 slide use a 3:4 frame; a matching portrait/landscape pair uses a square. Slides crop to fill that frame, which stays fixed during playback. The cover selects the starting slide. Missing dimensions are read before playback, with a five-second fallback to available dimensions. An unfinished final row stays at a comfortable size instead of stretching its few items across the window.
- **Online:** clicking a pin opens its original page. The library caches smaller images and full-length silent videos for the grid.
- **Offline:** clicking opens the downloaded media or article inside Papan. Switching an existing collection to offline downloads its originals before committing the change. Switching back to online retains existing local originals.
- The `···` button opens a pin's details and saved items. The original source is always available.
- Reduced-motion preferences pause automatic previews and slideshows. The viewer opens videos muted and offers normal playback controls.

## Develop

Use Node.js 24.15+ (24.x) or 26+, and Python 3.11+ on Linux, Windows or macOS:

```sh
npm ci
npm run setup
npm start
```

`setup` creates a project-local Python environment and installs the pinned extractors. It also installs Electron and the platform's FFmpeg binary if npm did not run dependency install scripts. There is no account, cloud service, browser-cookie import, or API key to configure.

## Build desktop packages

Build on each target operating system:

```sh
npm run build:tools
npm run package
```

The result is a portable app and a `.tar.gz` archive in `dist/`. The archive preserves executable permissions. Builds include a standalone extraction helper and FFmpeg; end users do not need Python, gallery-dl, yt-dlp, or Instaloader installed separately.

The [desktop workflow](.github/workflows/desktop.yml) builds and tests on Linux, Windows and macOS using each runner's native architecture. It stores build artifacts without publishing a release. Signing and notarization credentials are not configured. macOS and Windows builds require their corresponding runners; a Linux build is not evidence that those operating systems were tested.

## Extraction

| Source | Engine |
| --- | --- |
| Public X/Twitter post images, albums and videos | gallery-dl, with yt-dlp as a video fallback |
| Public YouTube videos | yt-dlp |
| Public Instagram posts and reels | gallery-dl, with Instaloader as the public-only fallback |
| Direct images/videos and media in accessible HTML | Bounded HTTP fetch and Cheerio |
| Accessible article text | Mozilla Readability |
| Resized image previews, including animations | Sharp |
| Local video previews | FFmpeg |

Only individual posts and videos are in scope. Profiles, feeds, bulk playlist downloads and live streams are not. Some public posts may still be blocked by a platform or unavailable to extractors. Papan reports that failure instead of attempting a login. Broader research and candidate tools are in [docs/extractors.md](docs/extractors.md); they are not all integrated.

Image previews are WebP copies capped at 1280 pixels on the longest edge, preserving proportions and animation. Video previews keep the full duration, remove audio, and cap the longest edge at 720 pixels at 24 fps. Smaller inputs are not enlarged. Offline collections retain the original downloads separately.

Preview creation downloads media to a temporary directory and processes it locally. Video downloads use an available low-resolution stream when the source supports it. This avoids a reproducible crash in the bundled Linux FFmpeg build when it reads a remote HLS stream. Full video previews take more time and disk space than short clips. Files are limited to 512 MiB, selections to 50 items, and each download or video-conversion operation to five minutes.

## Local data and recovery

The library is under Electron's per-user application data directory:

- Linux: `~/.config/Papan/library`
- macOS: `~/Library/Application Support/Papan/library`
- Windows: `%APPDATA%\Papan\library`

Collection settings, source links, text and metadata live in `library.json`. Downloaded media lives in `media/`. Collection settings include **open local library folder**, or **open destination folder** when a collection file has been chosen. Back up the media as well as the list: `.papan` files reference absolute media locations, so moving or deleting those files makes their saved references unavailable.

Writes are serialized and atomically replace the metadata file. `library.previous.json` retains the previous snapshot; referenced media for that snapshot remains available. A saved collection also keeps a `.previous.papan` copy. Unavailable destinations and conflicting changes made outside Papan prevent an edit from being committed; reopen the file or use Save as to resolve them. Collection files are single-writer documents, not a synchronization service.

Media referenced by saved collection files is retained even after removing their collection from the app, so reopening the list can still use those files. Other unreferenced media and interrupted temporary downloads are cleaned at the next app start. Invalid existing library JSON stops startup without replacing user data. `PAPAN_DATA_DIR` selects a separate data directory for tests and development.

## Checks

```sh
npm run check
npm test
npm run test:desktop
npm run test:layout
npm run test:interactions
npm run test:collections
```

The desktop test uses a temporary library and a local fixture server. It checks the empty canvas, media selection, adaptive rows, stable album frames, playback beyond eight seconds, album advancement after a video ends, live autoplay/slideshow settings, conversion to offline, restart with the source server stopped, offline images/video/text, search, removal and scrolling beyond 100 pins. The layout test checks mixed aspect ratios, row alignment, resizing, density changes, both sliders, persistence, shared album frames and missing dimensions. The interaction test checks native dragging (including album placeholders), saved order, cancelled drags, normal clicks, invalid moves, toolbar buttons, search and live layout previews. The collections test checks destination selection/cancellation, saved lists, automatic updates, closing/reopening, conflict and failure handling, retained media, and offline playback from a fresh profile without copying media. All write screenshots to `artifacts/` and clean up their test libraries.

```sh
node scripts/site-checks.mjs
```

This optional live check uses public upstream sample posts, performs no login, and writes its results to `artifacts/site-checks.json`. It is kept out of CI because platform availability changes. See [docs/verification.md](docs/verification.md) for observed results and remaining platform checks.
