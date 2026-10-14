import contextlib
import importlib.util
import io
import json
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import yt_dlp

spec = importlib.util.spec_from_file_location("papan_extract", Path(__file__).parents[1] / "worker/extract.py")
extract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extract)


class TurboTests(unittest.TestCase):
    video_id = "Skazh7iVsSsYA"

    def setUp(self):
        self.media = (Path(__file__).parent / "media/portrait.mp4").read_bytes()
        self.signs = 0
        self.downloads = []
        self.sign_response = None
        self.page_status = 200
        self.media_size = len(self.media)
        self.require_referer = True
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                url = urlsplit(self.path)
                if url.path == "/api/sign":
                    fixture.signs += 1
                    fixture.assertEqual(parse_qs(url.query), {"v": [fixture.video_id]})
                    body = json.dumps(fixture.sign_response if fixture.sign_response is not None else {
                        "success": True, "url": f"https://cdn.example/media/{fixture.video_id}.mp4?token={fixture.signs}",
                        "filename": f"{fixture.video_id}.mp4", "original_filename": "Reference & motion.mp4",
                    }).encode()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                elif url.path == f"/v/{fixture.video_id}":
                    body = b'<meta property="og:image" content="https://cdn.example/poster.jpg"><img src="unrelated.jpg">'
                    self.send_response(fixture.page_status)
                    self.send_header("Content-Type", "text/html")
                elif url.path == f"/media/{fixture.video_id}.mp4":
                    fixture.assertEqual(parse_qs(url.query), {"token": [str(fixture.signs)]})
                    if fixture.require_referer:
                        fixture.assertEqual(self.headers.get("Referer"), f"https://turbo.cr/embed/{fixture.video_id}")
                    fixture.downloads.append(self.path)
                    body = fixture.media
                    self.send_response(200)
                    self.send_header("Content-Type", "video/mp4")
                    self.send_header("Content-Length", str(fixture.media_size))
                else:
                    raise AssertionError(f"Unexpected request: {self.path}")
                self.end_headers()
                self.wfile.write(body)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        original_urlopen = yt_dlp.YoutubeDL.urlopen

        def local_urlopen(downloader, request):
            original_url = request.url
            url = urlsplit(request.url)
            self.assertIn(url.hostname, {"turbo.cr", "cdn.example"}, "tests must never reach the internet")
            request = request.copy()
            request.url = f"http://127.0.0.1:{self.server.server_port}{url.path}" + (f"?{url.query}" if url.query else "")
            response = original_urlopen(downloader, request)
            response.url = original_url
            return response

        self.network = patch.object(yt_dlp.YoutubeDL, "urlopen", local_urlopen)
        self.network.start()

    def tearDown(self):
        self.network.stop()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def inspect(self, kind="v"):
        return extract.video_inspect({"url": f"https://turbo.cr/{kind}/{self.video_id}"})

    def download(self, directory, kind="v", preview=False, key=None):
        with contextlib.redirect_stdout(io.StringIO()):
            return extract.video_download({"url": f"https://turbo.cr/{kind}/{self.video_id}",
                                           "keys": [key or self.video_id], "output": directory, "preview": preview})

    def test_link_forms_select_one_video_with_the_same_identity_and_original_title(self):
        for kind in ("d", "v", "embed"):
            with self.subTest(kind=kind):
                result = self.inspect(kind)
                self.assertEqual(result["title"], "Reference & motion.mp4")
                self.assertEqual(len(result["items"]), 1)
                item = result["items"][0]
                self.assertEqual((item["key"], item["kind"]), (self.video_id, "video"))
                self.assertEqual(item["poster"], "https://cdn.example/poster.jpg")
        self.assertEqual(self.downloads, [], "inspection must not download the video")

    def test_each_download_renews_the_signed_url_and_keeps_exact_original_bytes(self):
        original_url = self.inspect("d")["items"][0]["url"]
        for kind, preview in (("d", False), ("v", True)):
            with tempfile.TemporaryDirectory() as directory:
                result = self.download(directory, kind, preview)
                self.assertEqual(result[0]["key"], self.video_id)
                self.assertEqual(Path(result[0]["file"]).read_bytes(), self.media)
        self.assertEqual(self.signs, 3)
        self.assertNotIn(urlsplit(original_url).query, self.downloads[-1])

    def test_missing_optional_page_metadata_does_not_block_a_valid_video(self):
        self.page_status = 404
        self.assertIsNone(self.inspect()["items"][0]["poster"])

    def test_other_videos_still_use_the_existing_default_extractors(self):
        self.require_referer = False
        url = f"https://cdn.example/media/{self.video_id}.mp4?token=0"
        item = extract.video_inspect({"url": url})["items"][0]
        self.assertEqual((item["key"], item["kind"]), (self.video_id, "video"))
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            result = extract.video_download({"url": url, "keys": [item["key"]], "output": directory})
            self.assertEqual(Path(result[0]["file"]).read_bytes(), self.media)

    def test_unavailable_or_malformed_responses_never_save_a_thumbnail_instead(self):
        for response in ({"success": False}, [], {"success": True}, {"success": True, "url": None},
                         {"success": True, "url": "file:///tmp/secret"},
                         {"success": True, "url": "https://user:password@cdn.example/video.mp4"}):
            with self.subTest(response=response):
                self.sign_response = response
                with self.assertRaisesRegex(yt_dlp.utils.DownloadError, "Turbo"):
                    self.inspect()
        self.assertEqual(self.downloads, [])

    def test_oversized_videos_and_changed_selection_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            self.media_size = extract.MAX_FILE + 1
            with self.assertRaisesRegex(ValueError, "512 MiB"):
                self.download(directory)
            self.assertFalse(any(Path(directory).iterdir()))
        self.media_size = len(self.media)
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "source video changed"):
                self.download(directory, key="another-video")


if __name__ == "__main__":
    unittest.main()
