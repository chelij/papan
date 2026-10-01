import importlib.util
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from http.cookiejar import Cookie

spec = importlib.util.spec_from_file_location("papan_extract", Path(__file__).parents[1] / "worker/extract.py")
extract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extract)


class BrowserSessionTests(unittest.TestCase):
    def test_auto_finds_a_signed_in_browser_instead_of_using_a_guest_session(self):
        guest = Cookie(0, "guest_id", "fixture", None, False, ".x.com", True, True, "/", True, True, None, False, None, None, {})
        login = Cookie(0, "auth_token", "fixture", None, False, ".x.com", True, True, "/", True, True, None, False, None, None, {})
        with patch("gallery_dl.cookies.load_cookies", side_effect=lambda spec: [guest] if spec[0] == "firefox" else [login]) as load:
            self.assertEqual(extract.session_cookies({"browser": "auto", "url": "https://x.com/u/status/123"}), [login])
            self.assertEqual([call.args[0][0] for call in load.call_args_list], ["firefox", "chrome"])

    def test_public_requests_never_read_browser_cookies(self):
        with patch("gallery_dl.cookies.load_cookies", side_effect=AssertionError("must not read browser")):
            self.assertEqual(extract.session_cookies({"url": "https://x.com/user/status/123"}), ())

    def test_selection_and_site_are_validated_before_browser_access(self):
        with patch("gallery_dl.cookies.load_cookies", side_effect=AssertionError("must not read browser")):
            for browser, url in [("/path/to/profile", "https://x.com/user/status/123"), ("chrome", "https://x.com.evil.example/post")]:
                with self.assertRaises(ValueError):
                    extract.session_cookies({"browser": browser, "url": url})

    def test_each_site_reads_only_its_cookie_domain_and_drops_expired_cookies(self):
        current = Cookie(0, "session", "fixture", None, False, ".x.com", True, True, "/", True, True, None, False, None, None, {})
        expired = Cookie(0, "expired", "fixture", None, False, ".x.com", True, True, "/", True, True, 1, False, None, None, {})
        for url, domain in [("https://twitter.com/u/status/123", ".x.com"), ("https://instagram.com/reel/example", ".instagram.com"), ("https://youtu.be/example", ".youtube.com")]:
            with patch("gallery_dl.cookies.load_cookies", return_value=[current, expired]) as load:
                self.assertEqual(extract.session_cookies({"browser": "firefox", "url": url}), [current])
                load.assert_called_once_with(["firefox", None, None, None, domain])

    def test_native_cookie_reader_filters_other_sites_without_exporting_values(self):
        from gallery_dl.cookies import load_cookies
        with tempfile.TemporaryDirectory(prefix="papan-cookie-fixture-") as directory:
            file = Path(directory) / "cookies.sqlite"
            with sqlite3.connect(file) as db:
                db.execute("CREATE TABLE moz_cookies (name TEXT, value TEXT, host TEXT, path TEXT, isSecure INTEGER, expiry INTEGER, originAttributes TEXT)")
                db.executemany("INSERT INTO moz_cookies VALUES (?,?,?,?,?,?,?)", [("session", "fixture-x", ".x.com", "/", 1, 4102444800, ""), ("private", "fixture-other", ".other.example", "/", 1, 4102444800, "")])
            db.close()
            self.assertEqual([cookie.name for cookie in load_cookies(["firefox", directory, None, None, ".x.com"])], ["session"])
            self.assertEqual(sorted(file.name for file in Path(directory).iterdir()), ["cookies.sqlite"])

    def test_session_cookies_are_never_exported_or_written_back(self):
        from gallery_dl import config
        extract.gallery_config(cookies=[Cookie(0, "session", "fixture", None, False, ".x.com", True, True, "/", True, True, None, False, None, None, {})])
        self.assertFalse(config.get(("extractor",), "cookies-update"))
        self.assertEqual(config.get(("cache",), "file"), ":memory:")
        self.assertIsNone(extract.video_options({})["cookiefile"])
        self.assertIsNone(extract.video_options({})["cookiesfrombrowser"])


if __name__ == "__main__":
    unittest.main()
