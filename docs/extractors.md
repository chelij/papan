# Extraction tools and site coverage

Research checked against upstream documentation on 2026-09-28. This broad table describes upstream candidates, not a promise that every listed site is integrated. Papan now prioritizes public X, YouTube and Instagram posts; see [verification.md](verification.md) for the sample-level live checks. This is a practical target list, not a ranking of website popularity.

## Recommended foundation

Use **gallery-dl for galleries and social media**, **yt-dlp for video**, and **Mozilla Readability for articles**. Retain source post text and metadata as well as the selected media. Use small, explicit integrations with these tools; Papan should not maintain its own collection of site scrapers.

Both discovery and downloading matter. First enumerate the available items and metadata without downloading the originals. Let the user select items and a cover. Download only that selection for an offline board. An online board keeps the source link and preview.

## Website-to-tool map

| Target sites | Open-source tools to evaluate | What Papan can collect | Qualification |
| --- | --- | --- | --- |
| YouTube, Vimeo, Twitch, Dailymotion | [yt-dlp](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md) | Videos, thumbnails, titles and available descriptions | Support depends on URL type; clips, VODs, playlists and live streams are distinct. Start with individual videos and clips. |
| TikTok | [yt-dlp](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md) for video; [gallery-dl](https://gdl-org.github.io/docs/supportedsites.html) for posts | Video posts and candidate photo-post extraction | Test photo posts separately. Listing TikTok does not prove every format works. |
| Instagram | [gallery-dl](https://gdl-org.github.io/docs/supportedsites.html); [Instaloader](https://github.com/instaloader/instaloader) as a specialist candidate | Images, carousel members, videos and captions | Login and rate limits affect extraction. Instaloader explicitly preserves captions and metadata. Do not install two overlapping tools until a tested gap justifies it. |
| Pinterest | [gallery-dl](https://gdl-org.github.io/docs/supportedsites.html) | Pin media and metadata, including pin.it links | Start with individual pins; board/profile crawling is outside the first version. |
| Flickr, Imgur | [gallery-dl](https://gdl-org.github.io/docs/supportedsites.html) | Photos, albums and galleries | OAuth is supported for Flickr; access varies by item. |
| DeviantArt, Pixiv | [gallery-dl](https://gdl-org.github.io/docs/supportedsites.html) | Artwork, multi-image works and associated metadata | Authentication can be necessary. Animated Pixiv Ugoira needs a separate conversion step. |
| X / Twitter | [gallery-dl](https://gdl-org.github.io/docs/supportedsites.html), with [yt-dlp](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md) for video | Post media and text metadata | Text-only tweets require gallery-dl's `extractor.twitter.text-tweets` setting and a post-level metadata output path. Login may be required. |
| Reddit | [gallery-dl](https://gdl-org.github.io/docs/supportedsites.html) for media; [PRAW](https://github.com/praw-dev/praw) for structured posts and comments | Galleries, videos, post bodies and optional comment context | PRAW is an API wrapper, not credential-free scraping. Its setup requires API credentials. Fetching a thread is a separate action from pinning one post. |
| Tumblr | [gallery-dl](https://gdl-org.github.io/docs/supportedsites.html) | Post media and available post metadata | Its post-type support includes text, quote, link, answer, video, audio, photo and chat sources; this alone does not prove complete text-only capture. Validate that separately. |
| Bluesky | [gallery-dl](https://gdl-org.github.io/docs/supportedsites.html) for media; [official AT Protocol SDK](https://github.com/bluesky-social/atproto/tree/main/packages/api) for post records | Text, author, images, videos, links and quote relationships | A media-only result must not drop a text-only post. Use the structured post record when needed. |
| Mastodon | [gallery-dl](https://gdl-org.github.io/docs/supportedsites.html) for media; [Mastodon.py](https://github.com/halcy/Mastodon.py) or the [native HTTP API](https://docs.joinmastodon.org/methods/statuses/) for statuses | Post text, attachments, author and source URL | Instances differ in access requirements. Resolve the original instance and status; do not assume every server is mastodon.social. |
| Facebook | [gallery-dl](https://gdl-org.github.io/docs/supportedsites.html) for listed photo/album/video URLs; [yt-dlp](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md) for videos/reels | Supported photos, albums and videos | Do not advertise arbitrary Facebook post text, private groups, or universal unauthenticated access. |
| Bilibili, Douyin | [yt-dlp](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md) | Supported videos and available metadata | Regional availability, authentication and individual extractors need verification. |
| Weibo | [gallery-dl](https://gdl-org.github.io/docs/supportedsites.html) | Listed albums, status images, articles and videos | Candidate coverage; not yet tested in Papan. |
| Medium, Substack, WordPress, news sites and personal blogs | [Mozilla Readability](https://github.com/mozilla/readability); [Trafilatura](https://github.com/adbar/trafilatura) as an alternative | Readable article text, title, byline and available metadata | These are general HTML extractors, not guaranteed site integrations. They require accessible article content and do not unlock paywalls or execute client-side apps. |
| Threads | No primary extractor selected | Source link and whatever public preview metadata is available | No dedicated Threads entry found in the checked gallery-dl or yt-dlp lists. Keep this as an explicit support gap. |

## Tool choices

### Core

- **gallery-dl:** widest relevant gallery/social coverage. Its CLI supports JSON discovery, item ranges, and JSON metadata output. Some social text support requires configuration and post-level metadata handling; downloading only image files loses that context. Active development has moved to [Codeberg](https://codeberg.org/mikf/gallery-dl), as noted in the [upstream README](https://github.com/mikf/gallery-dl).
- **yt-dlp:** video extraction and download, including stream handling. Preserve stable page URLs and extractor IDs; temporary media URLs may expire. [Upstream explicitly notes](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md) that a listed site can still break.
- **Mozilla Readability:** the initial article extractor because it fits the desktop app's JavaScript runtime. Parse fetched HTML without running page scripts. Store plain text initially; if rich HTML is displayed later, sanitize it because Readability does not do that itself.
- **FFmpeg:** a helper for full-length silent video previews and required format conversion. It is not a site extractor.
- **Sharp:** resizes cached images without cropping, retaining animation. Its [resize options](https://sharp.pixelplumbing.com/api-resize/) support an inside fit without enlargement.

### Add only for a demonstrated need

- **Instaloader:** now integrated as the Instagram fallback. Public album and single-image metadata succeeded where gallery-dl was blocked, and selected album images downloaded successfully without login.
- **Trafilatura:** an alternative article extractor with text and metadata output. Compare it with Readability on a small article corpus before adding a second text engine.
- **AT Protocol SDK, Mastodon.py/native API, PRAW:** structured social text and relationships that a media download alone does not preserve. Use native HTTP when a small integration is sufficient; SDKs remain available when their behavior is needed.
- **Tweepy:** an [open-source X API client](https://github.com/tweepy/tweepy), potentially useful with authorized API access. It does not remove the platform's access requirements.
- **[SingleFile CLI](https://github.com/gildas-lormeau/single-file-cli):** optional full-page HTML archiving if Papan later adds a “save whole page” feature. This is separate from downloading selected original media or producing a clean article.

## Integration behavior

1. Identify the source and requested URL type. Prefer a relevant extractor; resolve redirects before deciding that a short link is unsupported.
2. Inspect metadata and available items. Do not bulk-download an account or gallery during discovery. Bound pagination, item counts, output size and runtime.
3. Normalize the result into source URL, source item ID, title, author, date, text, ordered media, preview, extractor, and per-item download availability. Preserve multiple media types in one post.
4. Show images, videos and text as selectable items. A text pin gets a readable excerpt card; an album gets its chosen cover and item count.
5. On online boards, clicking opens the source. On offline boards, save only the selected items and open those local files/text. Always retain the source.
6. Re-resolve expiring URLs through the chosen extractor at download time. Preserve required request headers/session context through the tool instead of assuming a copied CDN URL will work indefinitely.
7. Report partial discovery, missing tools, login requirements, rate limits, unsupported formats and failed downloads distinctly. A preview-only result must never be marked as an offline original.

Tool execution should use explicit argument arrays, app-owned output directories and an isolated configuration. Do not silently load user configurations, executable hooks, or browser cookies. Authenticated-source support needs an intentional account connection flow. Update tools independently of Papan's UI and retain their required notices when distributing them.

## Verification before claiming support

Maintain a small public sample set for each promised URL type: single image, album, single video, mixed carousel, text-only post and article. Check discovery order, selection, complete text, download integrity, restart persistence and playback with the network unavailable. Include one blocked/login-required case to check honest failure reporting. Site support must be recorded per URL type and tested tool version.

Current evidence: upstream documentation reviewed; live public discovery passed for X images/video, YouTube video and an Instagram album. Selected X media, Instagram album images, a YouTube preview and a full YouTube video were downloaded successfully. Authenticated extraction is excluded. See [verification.md](verification.md) for the exact samples and limits.

## References

- [gallery-dl CLI options](https://gdl-org.github.io/docs/options.html)
- [gallery-dl text-only tweets](https://gdl-org.github.io/docs/configuration.html#extractor-twitter-text-tweets)
- [gallery-dl post-level metadata events](https://gdl-org.github.io/docs/configuration.html#metadata-event)
- [PRAW setup and usage](https://praw.readthedocs.io/en/stable/getting_started/quick_start.html)
- [Instaloader post downloading](https://instaloader.github.io/module/instaloader.html)
