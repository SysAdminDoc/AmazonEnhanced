<p align="center">
  <img src="icon.svg" width="128" height="128" alt="AmazonEnhanced" />
</p>

<h1 align="center">AmazonEnhanced</h1>

<p align="center">
  <img src="https://img.shields.io/badge/version-1.1.0-89b4fa?style=flat-square" alt="version" />
  <img src="https://img.shields.io/badge/license-MIT-a6e3a1?style=flat-square" alt="license" />
  <img src="https://img.shields.io/badge/platform-Chrome%20MV3-f9e2af?style=flat-square" alt="platform" />
</p>

<p align="center">
  Chrome extension that de-clutters Amazon: dark theme, sponsored-result removal, review-quality scoring, price-per-unit badges, and brand filters.
</p>

---

## Features

### Ads & sponsored
- Sponsored-result removal across search pages, PDP carousels, and infinite scroll
- Optional shade mode (keeps tiles visible but dimmed + outlined)
- Video-ad and Prime-upsell nag removal
- Hero banner / promo strip removal

### Section declutter
Each of these can be toggled independently:
- `Brands related to this category`
- `Inspired by your browsing`
- `Customers also bought / viewed`
- `Buy it again` rails
- `Climate Pledge Friendly` widgets
- `Editorial recommendations`
- `From the manufacturer` A+ content
- `Compare with similar items`
- `Subscribe & Save` default upsell
- Cart upsells / saved-for-later clutter
- Homepage carousels & hero widgets
- Footer
- Inline search-result whitespace padding

### Reviews
Local review-quality score on each product page, based on:
- Star polarization (1★ + 5★ share)
- One-star share (paid-review red flag threshold)
- Verified-purchase ratio in the visible sample
- Total review volume

The adjusted rating is shown alongside Amazon's displayed rating. Runs locally on the DOM that's already loaded.

### Price tools
- Inline price-per-unit badges on search tiles (auto $/oz, $/kg, $/ct; handles EU comma decimals)
- Suspicious-MSRP flag when strikethrough list price is >70% above actual
- Amazon URL cleanup: strips `tag`, `ref_`, `pd_rd_*`, `pf_rd_*` and canonicalizes `/dp/ASIN` links

### Brand & seller filters
- Hide Amazon in-house brands (Amazon Basics, Essentials, Solimo, Pinzon, Goodthreads, Wag, etc.)
- "Gibberish brand" heuristic for 5–8 letter all-caps random-looking brand names
- User-defined regex blocklist

### Theme
- Dark (Catppuccin Mocha, default), AMOLED true-black, Light
- Comfortable or Compact density
- Anti-FOUC via `document_start`

#### Image dark-mode (v1.1.0)
Amazon product images are white-background JPGs which look harsh against a dark page. Four handling modes:

| Mode | Behavior |
|------|----------|
| **Off** | No change — Amazon images as-is |
| **Tile** (default) | Wraps each image in a soft light card. No color distortion. |
| **Dim** | `brightness(0.85) contrast(1.05)` — softens whites, keeps colors |
| **Invert** | `invert(0.92) hue-rotate(180deg)` — flips every image (ruins photos, good for icons/text) |
| **Smart** | Samples corner pixels via canvas. Inverts only images with near-white backgrounds. Falls back to tile if Amazon's CDN taints the canvas (CORS). |

There is no way to make photo backgrounds literally transparent — product shots are flat JPGs and the Amazon CDN often blocks pixel reads. Tile is the recommended default.

## Locale coverage

`.com` `.co.uk` `.ca` `.de` `.fr` `.it` `.es` `.nl` `.pl` `.se` `.com.tr` `.in` `.co.jp` `.com.au` `.com.mx` `.com.br` `.sg` `.sa` `.ae` `.eg`

## Install

From the [Releases page](https://github.com/SysAdminDoc/AmazonEnhanced/releases), grab either:

- `AmazonEnhanced-v1.1.0.zip` — extract and load unpacked in `chrome://extensions/` (Developer mode).
- `AmazonEnhanced-v1.1.0.crx` — drag-and-drop into `chrome://extensions/`.

## Settings

Toolbar popup. Six tabs: Ads, Declutter, Reviews, Price, Brands, Theme. Changes broadcast live to all open Amazon tabs.

## Architecture

```
manifest.json        MV3 manifest, 20 Amazon locales
early-inject.js      document_start: theme + flag attributes
theme.css            document_start: theme + declutter + image-mode rules
content.js           document_end: runtime orchestrator + MutationObserver
background.js        Service worker, defaults + tab broadcast
popup.html/css/js    Settings UI
icons/               16/32/48/128/512 PNGs
build/pack-crx.py    CRX3 packer
```

## License

MIT — see [LICENSE](LICENSE).
