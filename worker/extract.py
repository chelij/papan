# SPDX-License-Identifier: GPL-2.0-only
# Copyright (c) 2026 Cheliyono Jenardi
"""Papan's gallery-dl / yt-dlp process. One JSON request per run."""
import contextlib
import hashlib
import json
import logging
import os
from pathlib import Path
import sys
from urllib.parse import urlsplit

# Requests-based extractors must never read saved HTTP credentials.
os.environ["NETRC"] = os.devnull
MAX_FILE = 512 * 1024 * 1024
BROWSERS = {"chrome", "chromium", "firefox", "brave", "edge", "vivaldi", "opera", "safari"}


def session_cookies(request):
    browser = request.get("browser")
    if not browser:
        return ()
    if not isinstance(browser, str) or browser not in BROWSERS | {"auto"}:
        raise ValueError("Choose a supported browser for session fallback.")
    host = urlsplit(request["url"]).hostname.lower().removeprefix("www.")
    if host in ("x.com", "twitter.com", "mobile.twitter.com"):
        domain = ".x.com"
    elif host in ("instagram.com", "m.instagram.com"):
        domain = ".instagram.com"
    elif host in ("youtube.com", "m.youtube.com", "youtu.be"):
        domain = ".youtube.com"
    else:
        raise ValueError("Browser sessions are supported for X, Instagram, and YouTube links.")
    if browser == "auto":
        required = {".x.com": {"auth_token"}, ".instagram.com": {"sessionid"}, ".youtube.com": {"SAPISID", "__Secure-1PAPISID", "__Secure-3PAPISID"}}[domain]
        for candidate in ("firefox", "chrome", "chromium", "brave", "edge", "vivaldi", "opera", "safari"):
            try:
                cookies = session_cookies({**request, "browser": candidate})
                if any(cookie.name in required for cookie in cookies):
                    return cookies
            except ValueError:
                continue
        raise ValueError("No signed-in browser session was found for this site. Sign in in a desktop browser and unlock its password store, then retry. Firefox container logins are not supported yet.")
    from gallery_dl.cookies import load_cookies
    try:
        cookies = load_cookies([browser, None, None, None, domain])
        # Hyprland does not identify Chromium's libsecret store to the loader.
        if not cookies and sys.platform == "linux" and browser not in ("firefox", "safari"):
            cookies = load_cookies([browser, None, "gnomekeyring", None, domain])
        cookies = [cookie for cookie in cookies if not cookie.is_expired()]
    except Exception:
        raise ValueError("Could not read the browser session. Sign in to the site in that browser and unlock its password store; on Windows, you may need to close the browser.") from None
    if not cookies:
        raise ValueError("No session cookies were found for this site. Sign in to the site in the selected browser, then retry.")
    return cookies


def web_url(value):
    url = urlsplit(value)
    if url.scheme not in ("http", "https") or not url.hostname or url.username or url.password:
        raise ValueError("Only public HTTP and HTTPS links are supported.")
    return value


def media_key(meta, url, index):
    identity = [str(meta.get(k, "")) for k in ("id", "media_id", "tweet_id", "post_id", "filename", "num")]
    if not any(identity):
        identity = [urlsplit(url).path, str(index)]
    return hashlib.sha256("|".join(identity).encode()).hexdigest()[:24]


def gallery_config(output=None, cookies=()):
    from gallery_dl import config
    # No user configuration, hooks, or cache; cookies come only from explicit fallback.
    config.clear()
    for name, value in {
        "retries": 1, "timeout": 15, "sleep-request": 0,
        "post-range": "1", "file-range": "1-50", "child-range": "1",
        "postprocessors": [], "postprocess": False, "skip": False,
        "cookies": {cookie.name: cookie.value for cookie in cookies} or None, "cookies-update": False,
    }.items():
        config.set(("extractor",), name, value)
    config.set(("cache",), "file", ":memory:")
    config.set(("output",), "mode", "null")
    config.set(("output",), "private", True)
    config.set(("extractor", "twitter"), "text-tweets", True)
    config.set(("extractor", "twitter"), "quoted", False)
    config.set(("extractor", "twitter"), "retweets", False)
    config.set(("extractor", "twitter"), "ratelimit", "abort")
    config.set(("downloader",), "filesize-max", MAX_FILE)
    if output:
        config.set(("extractor",), "base-directory", output)
        config.set(("extractor",), "directory", [])
        config.set(("extractor",), "filename", "{_papan_id}.{extension}")


def gallery_inspect(url, cookies=()):
    from gallery_dl import job
    gallery_config(cookies=cookies)
    probe = job.DataJob(url, file=None)
    probe.run()
    if probe.exception:
        raise probe.exception
    items = []
    for index, (media_url, meta) in enumerate(zip(probe.data_urls, probe.data_meta), 1):
        if not media_url.startswith(("https://", "http://", "ytdl:")):
            continue
        ext = str(meta.get("extension", "")).lower()
        kind = "video" if ext in ("mp4", "webm", "mov", "mkv", "m4v") or media_url.startswith("ytdl:") else "image"
        items.append({
            "key": media_key(meta, media_url, index), "kind": kind,
            "url": media_url if media_url.startswith(("http://", "https://")) else None,
            "poster": meta.get("thumbnail") or meta.get("thumbnail_url"),
            "width": meta.get("width"), "height": meta.get("height"),
        })
    meta = (probe.data_post or probe.data_meta or [{}])[0]
    body = meta.get("content") or meta.get("description") or meta.get("caption") or ""
    if isinstance(body, dict):
        body = body.get("text", "")
    author = meta.get("author") or meta.get("user") or meta.get("username") or ""
    if isinstance(author, dict):
        author = author.get("name") or author.get("username") or author.get("nick") or ""
    if not items and not body:
        raise ValueError("This post did not expose any public media. It may require a login or be unavailable.")
    return {"title": str(meta.get("title") or body or author or "Saved post")[:200],
            "author": str(author), "text": str(body)[:100000], "items": items}


class QuietLogger:
    def debug(self, message):
        pass

    def warning(self, message):
        pass

    def error(self, message):
        pass


def video_options(request):
    from yt_dlp.globals import plugin_dirs
    from yt_dlp.utils import DownloadError
    plugin_dirs.value = []
    def limit_download(progress):
        if progress.get("downloaded_bytes", 0) > MAX_FILE:
            raise DownloadError("The selected media exceeds 512 MiB.")
    options = {
        "quiet": True, "no_warnings": True, "logger": QuietLogger(),
        "noplaylist": True, "playlistend": 1, "socket_timeout": 15,
        "retries": 1, "extractor_retries": 1, "fragment_retries": 1,
        "cachedir": False, "max_filesize": MAX_FILE, "overwrites": True,
        "format": "bv[height<=1080][vcodec^=avc1]+ba[ext=m4a]/b[ext=mp4][height<=1080]/bv[height<=1080]+ba/best",
        "merge_output_format": "mp4", "cookiefile": None, "cookiesfrombrowser": None,
        "ffmpeg_location": request.get("ffmpeg"),
        "hls_prefer_native": True, "skip_unavailable_fragments": False,
        "progress_hooks": [limit_download],
    }
    if request.get("node"):
        options["js_runtimes"] = {"node": {"path": request["node"]}}
    return options


def video_inspect(request, cookies=()):
    import yt_dlp
    with yt_dlp.YoutubeDL(video_options(request)) as downloader:
        for cookie in cookies:
            downloader.cookiejar.set_cookie(cookie)
        info = downloader.extract_info(request["url"], download=False)
    if info.get("entries"):
        entries = list(info["entries"])
        if len(entries) != 1:
            raise ValueError("Paste a single video or post, rather than a channel or playlist.")
        info = entries[0]
    if info.get("is_live"):
        raise ValueError("Live streams are not supported yet. Paste a recorded video or clip.")
    direct = info.get("url", "")
    if not direct.startswith(("http://", "https://")) or info.get("protocol", "").startswith(("m3u8", "http_dash")):
        direct = None
    return {"title": info.get("title") or "Video", "author": info.get("uploader") or "",
            "text": (info.get("description") or "")[:100000], "items": [{
                "key": str(info.get("id", "video")), "kind": "video", "url": direct,
                "poster": info.get("thumbnail"), "width": info.get("width"), "height": info.get("height"),
            }]}


def gallery_download(request, cookies=()):
    from gallery_dl import job
    gallery_config(request["output"], cookies)
    requested = set(request["keys"])
    saved = []

    class SelectedDownload(job.DownloadJob):
        # Keep gallery-dl's downloader/session while selecting only inspected items.
        index = 0

        def handle_url(self, url, metadata):
            self.index += 1
            key = media_key(metadata, url, self.index)
            if key not in requested:
                return
            metadata["_papan_id"] = key
            super().handle_url(url, metadata)
            path = Path(self.pathfmt.realpath)
            if path.is_file() and path.stat().st_size:
                saved.append({"key": key, "file": str(path.resolve())})

    download = SelectedDownload(request["url"])
    download.run()
    if download.status or {item["key"] for item in saved} != requested:
        raise ValueError("Some selected media could not be downloaded. The post may have changed or require a login.")
    return saved


def video_download(request, cookies=()):
    import yt_dlp
    options = video_options(request)
    options["outtmpl"] = str(Path(request["output"]) / "video.%(ext)s")
    if request.get("preview"):
        # Fetch the full low-resolution stream; the app makes a silent local copy.
        # FFmpeg network-range downloads crash in the bundled Linux build.
        options["format"] = "bv[height<=360]/b[height<=360]/bv/best"
    with yt_dlp.YoutubeDL(options) as downloader:
        for cookie in cookies:
            downloader.cookiejar.set_cookie(cookie)
        info = downloader.extract_info(request["url"], download=True)
    files = [p for p in Path(request["output"]).iterdir() if p.is_file() and p.suffix.lower() in (".mp4", ".webm", ".mkv", ".mov")]
    if len(files) != 1 or not files[0].stat().st_size or files[0].stat().st_size > MAX_FILE:
        raise ValueError("The video could not be saved within the 512 MiB limit.")
    if str(info.get("id", "video")) != request["keys"][0]:
        raise ValueError("The source video changed. Paste its link again.")
    return [{"key": request["keys"][0], "file": str(files[0].resolve())}]


def instagram_post(url, cookies=()):
    import instaloader
    parts = urlsplit(url).path.strip("/").split("/")
    if len(parts) < 2 or parts[0] not in ("p", "reel", "reels", "tv"):
        raise ValueError("Paste an individual Instagram post or reel.")
    loader = instaloader.Instaloader(quiet=True, max_connection_attempts=1, request_timeout=15)
    for cookie in cookies:
        loader.context._session.cookies.set_cookie(cookie)
    post = instaloader.Post.from_shortcode(loader.context, parts[1])
    if post.typename == "GraphSidecar":
        nodes = list(post.get_sidecar_nodes())
        items = [{"key": f"{post.mediaid}:{index}", "kind": "video" if node.is_video else "image",
                  "url": node.video_url if node.is_video else node.display_url, "poster": node.display_url}
                 for index, node in enumerate(nodes)]
    else:
        items = [{"key": f"{post.mediaid}:0", "kind": "video" if post.is_video else "image",
                  "url": post.video_url if post.is_video else post.url, "poster": post.url}]
    return loader, post, items


def instagram_inspect(url, cookies=()):
    _loader, post, items = instagram_post(url, cookies)
    caption = post.caption or ""
    return {"title": caption[:200] or f"{post.owner_username} on Instagram", "author": post.owner_username,
            "text": caption[:100000], "items": items[:50]}


def instagram_download(request, cookies=()):
    loader, _post, items = instagram_post(request["url"], cookies)
    wanted = set(request["keys"])
    selected = [item for item in items if item["key"] in wanted]
    if len(selected) != len(wanted):
        raise ValueError("The Instagram post changed. Paste its link again.")
    saved = []
    for item in selected:
        # Instaloader's public request session preserves the site's CDN behavior.
        # Stream ourselves to enforce the same size cap as the other downloaders.
        response = loader.context.get_raw(web_url(item["url"]))
        extension = ".mp4" if item["kind"] == "video" else ".jpg"
        filename = hashlib.sha256(item["key"].encode()).hexdigest()[:24] + extension
        target = Path(request["output"]) / filename
        length = 0
        with response, target.open("wb") as output:
            content_type = response.headers.get("Content-Type", "").lower()
            if not content_type.startswith(item["kind"] + "/"):
                raise ValueError("Instagram returned a page instead of the selected media.")
            if int(response.headers.get("Content-Length", "0")) > MAX_FILE:
                raise ValueError("The selected file exceeds 512 MiB.")
            for chunk in response.iter_content(65536):
                length += len(chunk)
                if length > MAX_FILE:
                    raise ValueError("The selected file exceeds 512 MiB.")
                output.write(chunk)
        if not length:
            raise ValueError("Instagram returned an empty media file.")
        saved.append({"key": item["key"], "file": str(target.resolve())})
    return saved


def main():
    logging.basicConfig(stream=sys.stderr, level=logging.ERROR)
    request = json.loads(sys.stdin.read(1024 * 1024))
    if request["action"] in ("export-bundle", "import-bundle"):
        from archive import export_bundle, import_bundle
        return export_bundle(request) if request["action"] == "export-bundle" else import_bundle(request)
    if request["action"] == "versions":
        from gallery_dl.version import __version__ as gallery_version
        from yt_dlp.version import __version__ as video_version
        from instaloader import __version__ as instagram_version
        return {"gallery-dl": gallery_version, "yt-dlp": video_version, "Instaloader": instagram_version}
    request["url"] = web_url(request["url"])
    cookies = session_cookies(request)
    if request["action"] == "inspect":
        if request["engine"] == "gallery":
            return gallery_inspect(request["url"], cookies)
        if request["engine"] == "instagram":
            return instagram_inspect(request["url"], cookies)
        return video_inspect(request, cookies)
    if request["action"] == "download":
        if not 0 < len(request["keys"]) <= 50:
            raise ValueError("Select between 1 and 50 items.")
        Path(request["output"]).mkdir(parents=True, exist_ok=True)
        if request["engine"] == "gallery":
            return gallery_download(request, cookies)
        if request["engine"] == "instagram":
            return instagram_download(request, cookies)
        return video_download(request, cookies)
    raise ValueError("Unknown extraction action.")


if __name__ == "__main__":
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8")
    try:
        # Libraries can print progress; stdout is reserved for the JSON response.
        with contextlib.redirect_stdout(sys.stderr):
            result = main()
        print(json.dumps({"ok": True, "result": result}, ensure_ascii=False))
    except Exception as error:
        print(json.dumps({"ok": False, "error": str(error)[:1200]}, ensure_ascii=False))
        sys.exit(1)
