# AmazonEnhanced — Working Notes

## Overview
Chrome MV3 extension for Amazon UX: ad/sponsor removal, section declutter, local review-quality scoring, price-per-unit tools, Amazon-brand filtering, and theming.

## Version: v1.1.2 (2026-04-14)

## Stack
- Manifest V3 (service worker, no background page).
- No build tooling. Vanilla JS/CSS/HTML. Ship readable.
- ImageMagick (`magick`) renders PNG icons from `icon.svg`.
- Python + `cryptography` for CRX3 packing (`build/pack-crx.py`).

## Architecture
- **`manifest.json`** — 20 Amazon locale match patterns. Permissions: `storage`, `alarms`.
- **`early-inject.js`** (document_start) — reads `chrome.storage.local['amzeSettings']` and sets `data-amze-theme`, `data-amze-density`, `data-amze-image-mode`, and per-feature `data-amze-<flag>` attrs on `<html>`. Anti-FOUC via body opacity held at 0 until `data-amze-ready="1"`.
- **`theme.css`** (document_start) — Catppuccin Mocha + AMOLED + Light. Scoped by `html[data-amze-theme]`, `html[data-amze-image-mode]`, and per-flag attrs. Declutter rules live here so toggling a flag activates/deactivates without reflow.
- **`content.js`** (document_end) — runtime:
  - Sponsored tile detection (selector + label text fallback)
  - Brand filter (Amazon-brand list + regex blocklist + gibberish heuristic)
  - Price-per-unit inference (title regex → canonical unit → badge)
  - List-price inflation warning (>70% MSRP gap)
  - Review scoring heuristic (polarization, 1-star share, verified ratio)
  - Affiliate param stripper + /dp/ASIN canonicalization
  - **Smart-image dark-mode** — canvas samples 6 corner+mid pixels on each image; marks with `data-amze-invert="1"|"0"|"cors"`. Fails silently on CORS tainted canvas.
  - MutationObserver (debounced 180ms) for infinite scroll
- **`background.js`** — seeds defaults, broadcasts settings from popup to all Amazon tabs.
- **`popup.html/css/js`** — 6-tab settings UI. Image-mode picker is a 5-button segmented control in the Theme tab.

## Key paths
- `content.js:30` — DEFAULT_SETTINGS (triplicate source of truth)
- `content.js:239` — UNIT_MAP (add units here)
- `content.js:224` — AMAZON_BRANDS list
- `content.js:~355` — `processImageForSmartInvert` (canvas corner sampling)
- `theme.css:~486` — image-mode rules (section 6)
- `theme.css:~600` — theme polish (modals, stars, tables, checkout) (section 7)

## Image dark-mode
Five modes exposed via `data-amze-image-mode`:
- `off` — no rules
- `tile` (default) — light off-white card wrap, `#e8e8ee` padded background with rounded corners
- `dim` — `filter: brightness(0.85) contrast(1.05)`
- `invert` — `filter: invert(0.92) hue-rotate(180deg) contrast(1.05)`
- `smart` — content.js samples image corners; applies invert only to `img[data-amze-invert="1"]`; falls back to tile for `"0"` and `"cors"`

**Caveat on "true transparent dark":** Amazon product shots are flat JPGs. Real transparency would require canvas pixel replacement + data-URL substitution, which (a) kills performance, (b) breaks lazy loading, (c) fails entirely when `m.media-amazon.com` doesn't return `Access-Control-Allow-Origin`. Smart-invert is the practical ceiling.

## Gotchas
- `DEFAULT_SETTINGS` duplicated across **three** files: `content.js`, `background.js`, `popup.js`. Any add/remove must touch all three.
- Amazon rotates `data-cel-widget` / `cel_widget_id` values. When sponsored tiles leak, append selectors to `theme.css` section 3 AND `SPONSORED_SELECTORS` in `content.js`.
- Locale number parsing: `parseNumber()` auto-detects US vs EU decimal by whichever of `.`/`,` appears last. Critical for `.de/.fr/.es` prices.
- Anti-FOUC: body opacity 0 until `data-amze-ready="1"`, only for dark/amoled.
- Never use `backdrop-filter: blur()` in content-script CSS.
- Smart-image canvas read may fail with DOMException on tainted canvas (Amazon CDN sends CORS headers inconsistently) — caught and marked as `"cors"`.
- `data-amze-img` flag prevents re-evaluating the same image; clear on settings-change.
- Popup segmented buttons are scoped by `[data-density]` and `[data-image]` — don't select `.amze-seg-btn` generically or the two groups will thrash each other.

## Build & release
```bash
cd ~/repos/AmazonEnhanced
# ZIP:
"/c/Windows/System32/tar.exe" -a -cf AmazonEnhanced-v1.1.0.zip -C <staged-dir> .
# CRX:
python build/pack-crx.py
# Release:
gh release create vX.Y.Z --title "vX.Y.Z" AmazonEnhanced-vX.Y.Z.zip AmazonEnhanced-vX.Y.Z.crx
```

- Signing key: `build/amazonenhanced.pem` (gitignored). Preserves extension ID across releases.
- Icons rendered via `magick -background none -size NxN icon.svg icons/N.png`.

## Reference MHTMLs (local only, gitignored)
`Amazon.com Shopping Cart.mhtml`, `Amazon.com. Spend less. Smile more..mhtml`, `Amazon.com_ Treadmill ... Product Types.mhtml`, `Your Account.mhtml`.

## Status
- v1.1.2 — Nuclear inline-style white-bg overrides (beats `style="background:#fff"` via attribute selectors). Added runtime JS sweep `killWhiteBackgrounds` that marks computed-white containers with `data-amze-kw="1"`. Tile mode padding increased from 4→10px with visible border/shadow so the frame is actually visible.
- v1.1.1 — bugfix: `.a-dynamic-image` was hitting container divs. All image-mode selectors now `img`-qualified. Added coverage for `.a-cardui`, `.gw-card`, `[class*="FluidCard"]`, cart upsells, Prime Visa strip, subtotal buy-box, related-products sidebar (`#rcx_container`).
- v1.1.0 — image dark-mode system (5 modes); broader theme coverage (modals, stars, tables, checkout, account, reviews, side panel, badges, focus, selection).
- v1.0.0 — initial release.
