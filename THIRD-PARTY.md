# Third-party software

Papan's desktop code is **GPL-3.0-or-later**. The independently executed extraction/archive helper in `worker/` is **GPL-2.0-only** because it imports gallery-dl. These licenses do not replace the licenses of dependencies.

| Component | License | Use and source |
| --- | --- | --- |
| Electron / Chromium / Node.js | MIT and bundled third-party licenses | Desktop runtime. Electron ships `LICENSE` and `LICENSES.chromium.html`; [source](https://github.com/electron/electron). |
| ffmpeg-static | GPL-3.0-or-later | JavaScript binary locator and distribution package. [Source](https://github.com/eugeneware/ffmpeg-static). |
| FFmpeg 7.0.2 + x264 | GPL-2.0-or-later for Papan's release build | Separate conversion/inspection executables, built from pinned source with x264 as the only external codec library. Source archives, SHA-256 hashes, license files, build scripts, configuration, and version output ship in `vendor/native-source/`. [FFmpeg sources](https://ffmpeg.org/releases/), [x264 source mirror](https://github.com/mirror/x264/tree/baee400fa9ced6f5481a728138fed6e867b0ff7f). |
| gallery-dl | GPL-2.0-only | Python extraction helper. [Source](https://codeberg.org/mikf/gallery-dl). |
| yt-dlp | Unlicense; optional dependencies retain their own licenses | Video extraction. [Source and licensing](https://github.com/yt-dlp/yt-dlp#license). |
| Instaloader | MIT | Public Instagram fallback. [Source](https://github.com/instaloader/instaloader). |
| Mutagen | GPL-2.0-or-later | yt-dlp dependency in the helper. [Source](https://github.com/quodlibet/mutagen). |
| Requests | Apache-2.0 | Upstream extractor HTTP dependency. [Source](https://github.com/psf/requests). |
| Mozilla Readability | Apache-2.0 | Article extraction. [Source](https://github.com/mozilla/readability). |
| Cheerio / jsdom | MIT | HTML parsing. [Cheerio](https://github.com/cheeriojs/cheerio), [jsdom](https://github.com/jsdom/jsdom). |
| Sharp | Apache-2.0 | Image processing. [Source](https://github.com/lovell/sharp). |
| libvips and its native dependencies | LGPL-2.1-or-later and bundled component licenses | Sharp's dynamically loaded native libraries. [Sources/build scripts](https://github.com/lovell/sharp-libvips), [libvips source](https://github.com/libvips/libvips). |
| PyInstaller | GPL-2.0-or-later with bootloader exception | Builds the separate helper. [Source/exception](https://pyinstaller.org/en/stable/license.html). |

## What each package includes

- Papan's JavaScript source, GPLv3 license, and notice.
- The helper source and GPLv2 license in `vendor/source/`.
- Exact installed Python source distributions, their PyPI SHA-256 checksums, and installed versions in `vendor/source/python-sources.json` and `requirements-installed.txt`.
- Production npm package versions, source locations, integrity hashes, and license files in `vendor/licenses/`. JavaScript dependencies ship as source, not bundled/minified application code.
- Electron's runtime notices and the exact FFmpeg/x264 source archives, licenses, and build configuration.

Electron and Sharp/libvips source and build information are available from their upstream projects at the exact versions recorded in the package inventory. Sharp's libvips shared library remains separately replaceable in the unpacked package. A repository license alone does not discharge the source-distribution obligations of GPL/LGPL binaries. When redistributing a modified package, retain the included notices and provide corresponding source for the exact binaries you ship.

`ffmpeg-static` supplies a convenient development binary, but that downloaded binary is excluded from releases. Release builds use `npm run build:ffmpeg` and include matching source archives instead of depending on a third-party binary provider's source links. The GPL-3.0-or-later JavaScript locator package remains a desktop dependency.

README artwork is documentation-only and is credited separately in [docs/demo/credits.md](docs/demo/credits.md). No example collection is included in the installed app.
