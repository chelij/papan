# Papan, first desktop version

A private visual library: paste a page link, choose its media and a cover, and pin it to a board. No account is required.

## Agreed behavior

Confirmed first-version priorities: Linux, macOS and Windows packaging; public X/Twitter images and videos, YouTube videos, and Instagram posts. No login or cookie import.

The initial canvas is black with “paste link to start collecting” and an option to open a saved collection. After the first save, collections appear as tabs across the top, with a highlighted active tab and horizontal scrolling when needed. Pins are appended left to right, top to bottom in rows that adapt to their media's aspect ratios, with continuous scrolling. Visible videos autoplay silently, albums cycle as slideshows, and articles without images use text cards. Settings belong to each collection.

- A board is online or offline. Online pins open their original page. Offline pins open downloaded media in Papan and retain their source link.
- A pin can contain multiple images or videos as an album, with a chosen cover. Article text and social post text should also be selectable and preserved with their source context.
- Rows adapt to portrait, landscape, square and panoramic media. A 1–10 density slider controls tile size, with a default of 3. A second slider sets image slideshows to 1–10 seconds. Display copies use a lower resolution. Videos play their full duration silently when visible; album videos finish before advancing. Motion can be turned off and respects reduced-motion preferences.
- Users can create, rename, and delete boards, remove pins, and search their library. Pins and collection tabs can be dragged into a new saved order; Alt+Left/Right provides keyboard reordering.
- Boards, metadata, and offline files survive app restarts. Failed downloads never appear as successful offline pins.

## Work list

Current collection files update:
- Completed: save the list, settings and references to existing media in a .papan file at a chosen destination; later edits update that file without copying or moving media.
- Completed: close tabs without deletion, reopen closed collections, and open collection files from disk. Saved references retain their media even after removing the app's collection entry.
- Verified in development and the packaged Linux app using isolated libraries: save, edit, close, restart and reopen, unavailable destinations, conflicting file changes, malformed files and offline playback in a fresh profile without media copies.

Current album fit update:
- Completed: one stable frame uses the middle of all visual media's proportions, balancing wide/tall ties and favoring common proportions.
- Completed: album slides crop to fill the selected frame; individual media keeps its own proportions and the square-frame setting remains available.
- Completed: missing dimensions are resolved before starting an album, with a bounded fallback if media is unavailable.
- Verified in the desktop and layout suites: mixed proportions, cover/order independence, different resolutions, unknown image/video dimensions, fixed frames throughout playback, and live square-frame preview.
- Verified native dragging with a shared album frame, then rebuilt the Linux app and passed the complete desktop suite against the package.

Current pin drag preview:
- Completed: an outlined space with the dragged pin's proportions reflows the other pins while hovering.
- Completed: the preview remains temporary until drop; cancelling restores the original layout.
- Verified: the hover layout matches the dropped result, stays stable with a still pointer, and restores correctly after cancellation across rows.

Current toolbar and dragging update:
- Completed: the collection's online/offline label sits below the logo, and toolbar actions use matching buttons.
- Completed: drag pins and collection tabs to reorder them, preserving the adaptive layout and saving the order.
- Completed: density, media fit, slideshow timing and autoplay preview immediately in a side settings panel; Save keeps the changes and closing without saving restores the saved layout.
- Verified in a temporary library: pointer dragging, cancelled drags, normal clicks, search, keyboard access, live previews, narrow windows and saved order after restart.

Current layout update:
- Completed: proportional rows and stable album frames.
- Completed: 1–10 density and slideshow sliders, preserving older collection settings.
- Completed and verified in development and packaged Linux builds: mixed aspect ratios, resizing, dense/spacious layouts, and persistence.

Earlier preview update:
- Completed: uncropped media at its own aspect ratio, with three columns by default.
- Completed: smaller image caches and full-length silent videos; album videos finish before advancing.
- Completed and verified in both development and packaged Linux builds: portrait/landscape layout, reduced image dimensions, playback beyond eight seconds and album advancement after the video ends.

1. Completed: research open-source extractors across image, video and text sharing sites; see [extractors.md](extractors.md).
2. Completed: integrate the selected extraction tools, bounded downloads, and durable local storage. Instaloader is included as a verified public Instagram fallback.
3. Completed: build the desktop canvas, media picker, collections/settings and offline viewer.
4. Completed locally: exercise persistence, offline playback, scrolling and public-source extraction. See [verification.md](verification.md); Windows/macOS runner execution remains unverified.

The smallest end-to-end proof: start on the empty black canvas, paste a fixture page, choose its media, save, create another collection and change its settings, save an offline album/video/article, restart, stop the source server, and open the local items. Check row order, slideshow changes, silent video autoplay and loading another page of pins. Test public target-site links separately and report upstream failures honestly.

## Support boundary

The planned extraction foundation is `gallery-dl` for galleries/social media, `yt-dlp` for video, and Mozilla Readability for article text, with public HTML media and Open Graph as fallbacks. Structured social text may need the site's API. See the [site and tool map](extractors.md) for candidate coverage, specialist alternatives, and known gaps. Support must be verified per URL type: sites change and some sources require logins. The app must not silently import browser cookies. A link preview is not proof that the original media is downloadable.

Downloads are bounded to 512 MiB per item and 50 items per pin. No cloud sync, sharing, browser extension, or account system in this version. Offline copies live in the app's data directory; users should include that directory in backups.

## Product context

[Raindrop](https://raindrop.io/) and [Are.na](https://www.are.na/about) already cover related collecting workflows. Papan's proposed focus is deliberate media selection, animated browsing, and transparent local copies. That is a product hypothesis to test, not a claim of a unique market.

[Open Graph](https://ogp.me/) provides previews but does not enumerate all page media. [yt-dlp](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md) documents that site support can break as websites change.
