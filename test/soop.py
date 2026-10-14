import contextlib
import importlib.util
import io
import json
import tempfile
import threading
import unittest
from http.cookiejar import Cookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import yt_dlp

spec = importlib.util.spec_from_file_location("papan_extract", Path(__file__).parents[1] / "worker/extract.py")
extract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extract)


class SoopTests(unittest.TestCase):
    def setUp(self):
        self.media = (Path(__file__).parent / "media/portrait.mp4").read_bytes()
        self.key = "20261014_soop_fixture_1"
        self.api_calls = 0
        self.downloads = 0
        self.private = False
        self.code = None
        fixture = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                fixture.assertEqual(self.path, "/station/video/a/view")
                form = parse_qs(self.rfile.read(int(self.headers["Content-Length"])).decode())
                fixture.assertEqual(form["nTitleNo"], ["209648853"])
                fixture.assertEqual(self.headers["Referer"], "https://vod.sooplive.com/player/209648853/catch")
                fixture.api_calls += 1
                blocked = fixture.private and "AuthTicket=fixture-session" not in self.headers.get("Cookie", "")
                data = {"title": "Catch fixture", "writer_nick": "Fixture creator", "bj_id": "fixture", "thumb": "https://videoimg.sooplive.com/poster.jpg",
                        "total_file_duration": 2125, "adult_status": "notLogin" if blocked else "normal",
                        "files": [] if blocked else [{"file": f"https://cdn.sooplive.com/video.mp4?token={fixture.api_calls}", "file_info_key": fixture.key, "duration": 2125}]}
                if fixture.code:
                    data = {"code": fixture.code}
                body = json.dumps({"result": 1, "data": data}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                url = urlsplit(self.path)
                fixture.assertEqual(url.path, "/video.mp4")
                fixture.assertEqual(parse_qs(url.query), {"token": [str(fixture.api_calls)]})
                fixture.downloads += 1
                self.send_response(200)
                self.send_header("Content-Type", "video/mp4")
                self.send_header("Content-Length", str(len(fixture.media)))
                self.end_headers()
                self.wfile.write(fixture.media)

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        original_urlopen = yt_dlp.YoutubeDL.urlopen

        def local_urlopen(downloader, request):
            original_url = request.url
            url = urlsplit(request.url)
            self.assertIn(url.hostname, {"api.m.sooplive.com", "cdn.sooplive.com"}, "tests must never reach the internet")
            request = request.copy()
            cookie_header = downloader.cookiejar.get_cookie_header(original_url)
            if cookie_header:
                request.headers["Cookie"] = cookie_header
            request.url = f"http://127.0.0.1:{self.server.server_port}{url.path}" + (f"?{url.query}" if url.query else "")
            response = original_urlopen(downloader, request)
            response.url = original_url
            return response

        self.network = patch.object(yt_dlp.YoutubeDL, "urlopen", local_urlopen)
        self.network.start()
        self.request = {"url": "https://vod.sooplive.com/player/209648853/catch"}

    def tearDown(self):
        self.network.stop()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def test_inspection_and_download_refresh_the_api_and_keep_exact_original_video(self):
        info = extract.video_inspect(self.request)
        self.assertEqual((info["title"], info["author"]), ("Catch fixture", "Fixture creator"))
        self.assertEqual((info["items"][0]["key"], info["items"][0]["kind"]), (self.key, "video"))
        self.assertEqual(self.downloads, 0, "inspection must not save the thumbnail or video")
        for preview in [False, True]:
            with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
                result = extract.video_download({**self.request, "keys": [self.key], "output": directory, "preview": preview})
                self.assertEqual(Path(result[0]["file"]).read_bytes(), self.media)
        self.assertEqual((self.api_calls, self.downloads), (3, 2))

    def test_restricted_catch_requires_site_cookies_and_never_saves_a_poster_as_video(self):
        self.private = True
        with self.assertRaisesRegex(yt_dlp.utils.DownloadError, "login|credentials"):
            extract.video_inspect(self.request)
        cookie = Cookie(0, "AuthTicket", "fixture-session", None, False, ".sooplive.com", True, True, "/", True, True, None, True, None, None, {})
        self.assertEqual(extract.video_inspect(self.request, [cookie])["items"][0]["key"], self.key)
        self.assertEqual(self.downloads, 0)

    def test_removed_private_and_changed_videos_fail(self):
        for code, message in [(-6221, "does not exist"), (-6205, "private")]:
            self.code = code
            with self.assertRaisesRegex(yt_dlp.utils.DownloadError, message):
                extract.video_inspect(self.request)
        self.code = None
        with tempfile.TemporaryDirectory() as directory, contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(ValueError, "source video changed"):
                extract.video_download({**self.request, "keys": ["changed"], "output": directory})


if __name__ == "__main__":
    unittest.main()
