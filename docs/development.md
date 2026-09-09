# AmazonEnhanced v2.0.18 development

The extension uses Manifest V3 and plain JavaScript, CSS and HTML. Node.js 22 or newer supplies the test runner and WebSocket support for browser checks. Packaging also uses Python with `cryptography` for CRX signing.

```sh
npm ci
npm test
npm run test:packages
npm run build:release
npm run test:browser
python build/pack-crx.py
python build/pack-edge.py
python build/pack-firefox.py
npm run test:edge
npm run test:firefox
```

`build:release` refreshes the reloadable `dist/` tree and release ZIP. Project JavaScript and CSS remain readable. The Mozilla compatibility runtime is distributed unchanged with its notice. CRX signing uses the existing ignored key at `build/amazonenhanced.pem`; don't replace it, publish it or generate a new identity for an update.

Chromium tests use an owned temporary profile and synthetic Amazon, Prime Video and retailer documents. They verify the installed manifest before selecting its service worker. A built-in browser worker can also be named `background.js`.

Set `AMZE_CHROMIUM_PATH` to the browser executable when needed. Edge package checks accept `AMZE_EDGE_PATH`. Firefox uses `AMZE_FIREFOX_PATH` and `GECKODRIVER_PATH`. Keep browser checks headless on shared machines. Temporary Firefox installation doesn't establish Mozilla signing or permanent-install acceptance.

The Firefox harness grants geckodriver system access only inside its newly launched test session so it can read that profile's assigned extension ID. Its driver binds to loopback, its browser stays headless and a local fixture proxy handles site requests. It never attaches to an existing browser. See [Mozilla's testing flag documentation](https://firefox-source-docs.mozilla.org/testing/geckodriver/Flags.html).

## Key files

| File | Role |
| --- | --- |
| `manifest.json`, `locales.json` | Browser permissions and marketplace patterns |
| `defaults.json` | Initial settings and feature flags |
| `early-inject.js`, `theme.css` | Early theme and declutter rules |
| `content.js`, `feature-modules.js` | Page runtime and conditional feature loading |
| `network-rules.js`, `sponsored-detection.js` | Bounded request rules and label classification |
| `background.js` | Local storage, messages, alarms and optional seller lookup |
| `popup.html`, `popup.css`, `popup.js` | Ten-section settings interface |
| `sidepanel.html`, `sidepanel.js` | Local price history and alerts |
| `tests/` | Unit fixtures and installed-browser checks |
| `build/` | Source for builders and packers; not a disposable output folder |

The source archive under `assets/concepts` is historical evidence. It isn't a second active extension tree. Tests and package builders must use current root source, never the original snapshot.
