# SPDX-License-Identifier: GPL-2.0-only
# Copyright (c) 2026 Cheliyono Jenardi
"""Portable collections: only a manifest and bounded, explicitly named media."""
import json
import re
import stat
import zipfile
from pathlib import Path

MAX_MEDIA = 512 * 1024 * 1024
MAX_MANIFEST = 64 * 1024 * 1024
MAX_TOTAL = 20 * 1024 * 1024 * 1024
MEDIA_NAME = re.compile(r"media/[0-9]+-(preview|original)\.(jpg|jpeg|png|webp|gif|avif|svg|heic|mp4|webm|mov|m4v|mkv|avi|ts)\Z")


def export_bundle(request):
    specification = json.loads(Path(request["specification"]).read_text(encoding="utf-8"))
    manifest = json.dumps(specification["manifest"], ensure_ascii=False).encode("utf-8")
    files = specification["files"]
    if len(manifest) > MAX_MANIFEST or len(files) > 50000:
        raise ValueError("This collection is too large to export.")
    total = len(manifest)
    with zipfile.ZipFile(request["output"], "x", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
        archive.writestr("collection.json", manifest)
        for entry in files:
            source = Path(entry["path"])
            if not MEDIA_NAME.fullmatch(entry["name"]) or not source.is_file():
                raise ValueError("Saved media is missing. Restore it before exporting this collection.")
            size = source.stat().st_size
            total += size
            if not 0 < size <= MAX_MEDIA or total > MAX_TOTAL:
                raise ValueError("Portable copies support 512 MiB per file and 20 GiB in total.")
            archive.write(source, entry["name"])
    return {"files": len(files), "bytes": total}


def import_bundle(request):
    output = Path(request["output"])
    with zipfile.ZipFile(request["file"]) as archive:
        entries = archive.infolist()
        names = [entry.filename for entry in entries]
        if len(entries) > 50001 or len(names) != len(set(names)) or "collection.json" not in names:
            raise ValueError("This is not a supported portable collection.")
        total = 0
        for entry in entries:
            if entry.filename != "collection.json" and not MEDIA_NAME.fullmatch(entry.filename):
                raise ValueError("The archive contains an unexpected file or unsafe path.")
            mode = entry.external_attr >> 16
            if entry.flag_bits & 1 or stat.S_ISLNK(mode) or entry.is_dir():
                raise ValueError("Encrypted files, folders, and symbolic links are not supported.")
            limit = MAX_MANIFEST if entry.filename == "collection.json" else MAX_MEDIA
            total += entry.file_size
            if not 0 < entry.file_size <= limit or total > MAX_TOTAL:
                raise ValueError("The portable collection exceeds the size limit.")
        manifest = json.loads(archive.read("collection.json"))
        if manifest.get("format") != "papan-bundle" or manifest.get("version") != 1 or not isinstance(manifest.get("pins"), list):
            raise ValueError("This is not a supported portable collection.")
        references = set()
        for pin in manifest["pins"]:
            for item in pin.get("items", []):
                for field in ("previewPath", "localPath"):
                    name = item.get(field)
                    if name is not None:
                        if not isinstance(name, str) or not MEDIA_NAME.fullmatch(name):
                            raise ValueError("The archive contains an unsafe media reference.")
                        references.add(name)
        if references != set(names) - {"collection.json"}:
            raise ValueError("The archive has missing or unexpected media.")
        (output / "media").mkdir(parents=True, exist_ok=True)
        for entry in entries:
            destination = output / entry.filename
            with archive.open(entry) as source, destination.open("xb") as target:
                written = 0
                while chunk := source.read(1024 * 1024):
                    written += len(chunk)
                    if written > entry.file_size:
                        raise ValueError("The archive contains oversized media.")
                    target.write(chunk)
    return {"manifest": str(output / "collection.json")}
