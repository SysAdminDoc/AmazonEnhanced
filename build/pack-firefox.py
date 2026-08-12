#!/usr/bin/env python3
"""Build the Firefox WebExtension package (XPI) from the readable source tree."""

import json
import importlib.util
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
_read_locale_patterns = PACK_CRX._read_locale_patterns
_read_version = PACK_CRX._read_version


FIREFOX_BACKGROUND_SCRIPTS = [
    "browser-polyfill.min.js",
    "price-history-io.js",
    "wishlist-import.js",
    "feature-modules.js",
    "service-worker-warm.js",
    "error-buffer.js",
    "pdp-diff.js",
    "background.js",
]


def build_manifest() -> dict:
    with open(REPO / "manifest.json", "r", encoding="utf-8") as handle:
        manifest = json.load(handle)

    patterns = _read_locale_patterns()
    if len(patterns) != 20:
        raise ValueError(f"expected 20 Amazon locale patterns, found {len(patterns)}")

    manifest["browser_specific_settings"] = {
        "gecko": {
            "id": "amazonenhanced@sysadmindoc.com",
            "strict_min_version": "128.0",
            "data_collection_permissions": {
                "required": ["none"],
                "optional": ["websiteActivity"]
            }
        }
    }
    manifest.pop("side_panel", None)
    manifest["sidebar_action"] = {
        "default_panel": "sidepanel.html",
        "default_title": "AmazonEnhanced Price History"
    }
    manifest["permissions"] = [
        permission for permission in manifest.get("permissions", [])
        if permission != "sidePanel"
    ]
    manifest["background"] = {
        "scripts": FIREFOX_BACKGROUND_SCRIPTS,
        "type": "classic"
    }

    for script in manifest.get("content_scripts", []):
        existing = script.get("matches", [])
        if any("amazon." in match for match in existing):
            script["matches"] = patterns + [match for match in existing if "amazon." not in match]
        if "browser-polyfill.min.js" not in script.get("js", []):
            script["js"] = ["browser-polyfill.min.js"] + script.get("js", [])
    for resource in manifest.get("web_accessible_resources", []):
        existing = resource.get("matches", [])
        if any("amazon." in match for match in existing):
            resource["matches"] = patterns + [match for match in existing if "amazon." not in match]

    for script in manifest.get("content_scripts", []):
        if any("amazon." in match for match in script.get("matches", [])) and set(script.get("matches", [])) != set(patterns):
            raise ValueError("content-script locale patterns do not match locales.json")
    for resource in manifest.get("web_accessible_resources", []):
        if any("amazon." in match for match in resource.get("matches", [])) and not set(patterns).issubset(set(resource.get("matches", []))):
            raise ValueError("web-accessible locale patterns do not match locales.json")
    return manifest


def package_files() -> list[str]:
    return list(INCLUDE_FILES)


def build_xpi() -> Path:
    output = REPO / f"AmazonEnhanced-v{_read_version()}.xpi"
    manifest = build_manifest()
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
    result = build_xpi()
    print(f"wrote {result} ({result.stat().st_size:,} bytes)")
