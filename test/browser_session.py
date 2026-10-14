import importlib.util
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from http.cookiejar import Cookie
import lz4.block

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
        for url, domain in [("https://twitter.com/u/status/123", ".x.com"), ("https://instagram.com/reel/example", ".instagram.com"), ("https://youtu.be/example", ".youtube.com"), ("https://turbo.cr/d/example", ".turbo.cr"), ("https://vod.sooplive.com/player/123/catch", ".sooplive.com")]:
            with patch("gallery_dl.cookies.load_cookies", return_value=[current, expired]) as load, patch.object(extract, "firefox_session_cookies", return_value=[]):
                self.assertEqual(extract.session_cookies({"browser": "firefox", "url": url}), [current])
                load.assert_called_once_with(["firefox", None, None, None, domain])

    def test_soop_imports_only_default_profile_site_session_cookies_without_writing_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            snapshots = root / "sessionstore-backups"
            snapshots.mkdir()
            cookie = {"host": ".sooplive.com", "name": "AuthTicket", "value": "fixture-session", "path": "/", "secure": True, "httponly": True,
                      "originAttributes": {"firstPartyDomain": "", "partitionKey": "", "privateBrowsingId": 0, "userContextId": 0}}
            file = snapshots / "recovery.jsonlz4"
            session = {"cookies": [cookie, {**cookie, "host": "vod.sooplive.com", "name": "UserTicket", "path": "/player"},
                                   {**cookie, "host": ".other.example"}, {**cookie, "host": "sooplive.com.evil.example"},
                                   {**cookie, "originAttributes": {"userContextId": 2}}, {**cookie, "originAttributes": {"partitionKey": "(https,other.example)"}}, {**cookie, "expiry": 1},
                                   {**cookie, "name": None}]}
            file.write_bytes(b"mozLz40\0" + lz4.block.compress(json.dumps(session).encode()))
            before = {str(file.relative_to(root)): file.read_bytes() for file in root.rglob("*") if file.is_file()}
            with patch("gallery_dl.cookies._firefox_cookies_database", return_value=(str(root / "cookies.sqlite"), False)):
                cookies = extract.firefox_session_cookies(".sooplive.com")
                self.assertEqual([cookie.name for cookie in cookies], ["AuthTicket", "UserTicket"])
                self.assertEqual((cookies[1].domain, cookies[1].domain_initial_dot, cookies[1].path, cookies[1].secure), ("vod.sooplive.com", False, "/player", True))
                self.assertEqual(cookies[0].value, "fixture-session")
                self.assertEqual({str(file.relative_to(root)): file.read_bytes() for file in root.rglob("*") if file.is_file()}, before)
                newer = root / "sessionstore.jsonlz4"
                newer.write_bytes(b"mozLz40\0" + lz4.block.compress(b'{"cookies":[]}'))
                os.utime(newer, (file.stat().st_mtime + 1, file.stat().st_mtime + 1))
                self.assertEqual(extract.firefox_session_cookies(".sooplive.com"), [], "a newer logged-out session must not revive older credentials")
                for data in [b"broken", b"mozLz40\0" + (129 * 1024 * 1024).to_bytes(4, "little"), b"mozLz40\0" + lz4.block.compress(b'{"cookies":null}')]:
                    newer.write_bytes(data)
                    os.utime(newer, (file.stat().st_mtime + 1, file.stat().st_mtime + 1))
                    self.assertEqual(extract.firefox_session_cookies(".sooplive.com"), [])

    def test_soop_auto_skips_guest_cookies_and_merges_the_current_firefox_session(self):
        guest = Cookie(0, "theme", "fixture", None, False, ".sooplive.com", True, True, "/", True, True, None, False, None, None, {})
        login = Cookie(0, "AuthTicket", "fixture-session", None, False, ".sooplive.com", True, True, "/", True, True, None, True, None, None, {})
        request = {"browser": "auto", "url": "https://vod.sooplive.com/player/123/catch"}
        with patch("gallery_dl.cookies.load_cookies", return_value=[guest]), patch.object(extract, "firefox_session_cookies", return_value=[login]) as session:
            self.assertEqual(extract.session_cookies(request), [guest, login])
            session.assert_called_once_with(".sooplive.com")
        with patch("gallery_dl.cookies.load_cookies", return_value=[guest]), patch.object(extract, "firefox_session_cookies", return_value=[]):
            with self.assertRaisesRegex(ValueError, "No signed-in browser session"):
                extract.session_cookies(request)

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

    def test_general_pages_read_only_the_linked_site_and_keep_cookie_scope(self):
        domain_cookie = Cookie(0, "session", "fixture", None, False, ".reddit.com", True, True, "/", True, True, None, False, None, None, {})
        sibling = Cookie(0, "sibling", "fixture", None, False, "old.reddit.com", True, False, "/", True, True, None, False, None, None, {})
        root_only = Cookie(0, "root", "fixture", None, False, "reddit.com", True, False, "/", True, True, None, False, None, None, {})
        request = {"action": "browser-cookies", "browser": "auto", "url": "https://www.reddit.com/r/example/comments/123/post", "cookieDomain": "reddit.com"}
        with patch("gallery_dl.cookies.load_cookies", return_value=[domain_cookie, sibling, root_only]) as load:
            self.assertEqual(extract.session_cookies(request), [domain_cookie])
            load.assert_called_once_with(["firefox", None, None, None, ".reddit.com"])
        with patch("gallery_dl.cookies.load_cookies", side_effect=AssertionError("must not read browser")):
            with self.assertRaises(ValueError):
                extract.session_cookies({**request, "cookieDomain": "other.example"})
            self.assertEqual(extract.session_cookies({**request, "browser": ""}), ())


if __name__ == "__main__":
    unittest.main()
