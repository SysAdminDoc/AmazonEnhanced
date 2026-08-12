#!/usr/bin/env python3
"""Build the Chromium-compatible Microsoft Edge Add-ons ZIP package."""

import importlib.util
import json
import zipfile
from pathlib import Path


PACK_CRX_PATH = Path(__file__).with_name("pack-crx.py")
PACK_CRX_SPEC = importlib.util.spec_from_file_location("pack_crx", PACK_CRX_PATH)
if PACK_CRX_SPEC is None or PACK_CRX_SPEC.loader is None:
    raise ImportError(f"unable to load {PACK_CRX_PATH}")
PACK_CRX = importlib.util.module_from_spec(PACK_CRX_SPEC)
PACK_CRX_SPEC.loader.exec_module(PACK_CRX)

INCLUDE_DIRS = PACK_CRX.INCLUDE_DIRS
INCLUDE_FILES = PACK_CRX.INCLUDE_FILES
REPO = PACK_CRX.REPO
_build_manifest = PACK_CRX._build_manifest
_read_locale_patterns = PACK_CRX._read_locale_patterns
_read_version = PACK_CRX._read_version


def package_files() -> list[str]:
    return list(INCLUDE_FILES)


def build_zip() -> Path:
    output = REPO / f"AmazonEnhanced-v{_read_version()}-edge.zip"
    manifest = json.loads(_build_manifest())
    patterns = _read_locale_patterns()
    if manifest.get("manifest_version") != 3:
        raise ValueError("Edge package must use Manifest V3")
    if manifest.get("background", {}).get("service_worker") != "background.js":
        raise ValueError("Edge package must use background.js as its service worker")
    if len(patterns) != 20:
        raise ValueError(f"expected 20 Amazon locale patterns, found {len(patterns)}")
    expected = set(patterns)
    if any(any("amazon." in match for match in script.get("matches", [])) and set(script.get("matches", [])) != expected for script in manifest.get("content_scripts", [])):
        raise ValueError("content-script locale patterns do not match locales.json")
    if any(any("amazon." in match for match in resource.get("matches", [])) and not expected.issubset(set(resource.get("matches", []))) for resource in manifest.get("web_accessible_resources", [])):
        raise ValueError("web-accessible locale patterns do not match locales.json")

    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in package_files():
            path = REPO / name
            if not path.exists():
                raise FileNotFoundError(path)
            if name == "manifest.json":
                archive.writestr(name, json.dumps(manifest, indent=2) + "\n")
            else:
                archive.write(path, name)
        for directory in INCLUDE_DIRS:
            root = REPO / directory
            if not root.exists():
                continue
            for path in sorted(root.rglob("*")):
                if path.is_file():
                    archive.write(path, path.relative_to(REPO).as_posix())
    return output


if __name__ == "__main__":
    result = build_zip()
    print(f"wrote {result} ({result.stat().st_size:,} bytes)")
