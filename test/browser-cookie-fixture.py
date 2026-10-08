"""Run the production helper against synthetic browser cookies, never a user profile."""
import contextlib
import importlib.util
import json
from pathlib import Path
import sqlite3
import sys

from gallery_dl import cookies

profile = Path(sys.argv[1])
profile.mkdir(parents=True, exist_ok=True)
with sqlite3.connect(profile / "cookies.sqlite") as db:
    db.execute("CREATE TABLE IF NOT EXISTS moz_cookies (name TEXT, value TEXT, host TEXT, path TEXT, isSecure INTEGER, expiry INTEGER, originAttributes TEXT)")
    db.execute("DELETE FROM moz_cookies")
    db.executemany("INSERT INTO moz_cookies VALUES (?,?,?,?,?,?,?)", [
        ("session", "fixture-session", "127.0.0.1", "/", 0, 4102444800, ""),
        ("path_only", "fixture-path", "127.0.0.1", "/admin", 0, 4102444800, ""),
        ("secure_only", "fixture-secure", "127.0.0.1", "/", 1, 4102444800, ""),
        ("expired", "fixture-expired", "127.0.0.1", "/", 0, 1, ""),
        ("unrelated", "fixture-unrelated", ".other.example", "/", 0, 4102444800, ""),
    ])

native_load = cookies.load_cookies


def fixture_load(specification):
    if specification[0] != "firefox":
        raise ValueError("No synthetic profile for this browser.")
    return native_load(["firefox", str(profile), *specification[2:]])


cookies.load_cookies = fixture_load
spec = importlib.util.spec_from_file_location("papan_extract", Path(__file__).parents[1] / "worker/extract.py")
extract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extract)
try:
    with contextlib.redirect_stdout(sys.stderr):
        result = extract.main()
    print(json.dumps({"ok": True, "result": result}))
except Exception as error:
    print(json.dumps({"ok": False, "error": str(error)}))
    sys.exit(1)
