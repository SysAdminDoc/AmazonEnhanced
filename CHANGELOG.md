# Changelog

## [2.0.2] - 2026-04-14

### Fixed
- **Block Amazon APE / Javelin SafeFrame sponsored ads.** The homepage/gateway "Featured in Video Games"-style sponsored cards render through a different system than the `sp-sponsored-result` tiles on search pages. They use `cel_widget_id="adplacements:..."`, `data-csa-c-painter="JavelinRenderingService"`, `[class*="ad-placements"]`, and `ape_*_placement`/`ape_*_iframe` IDs. All of these are now covered by both the CSS `hideSponsored`/`shadeSponsored` rules and the JS sponsored detector.

## [2.0.1] - 2026-04-14

### Fixed
- **Persistent white widgets on PDP and homepage.** Investigation of raw MHTML snapshots showed the problem: `rgb(255, 255, 255)` values are declared in Amazon's embedded `<style>` blocks (not inline `style=""` attributes), so CSS attribute-selectors can't reach them. The runtime JS sweep (`killWhiteBackgrounds`) is now the primary defense.
- **Expanded JS sweep coverage** to cover the 200+ `*_feature_div` ids on a typical PDP via `[id$="_feature_div"]`, plus `#buybox`, `#desktop_buybox`, `#apex_*`, `#corePrice*`, cart/orders containers, review blocks, table rows, homepage `.a-carousel*` and `.a-cardui*` patterns.
- **Dropped once-only check gate** — Amazon's own JS paints backgrounds after our first sweep; elements now remain eligible until they're marked dark.
- **Raised per-sweep cap** from 400 to 800 elements (modern PDPs have 200+ feature_divs alone).
- **Lowered near-white threshold** from 230 to 235 across all RGB channels — catches `#fff`, `#f7f7f7`, `#eaeded`, and Amazon's common off-whites while leaving genuine grey tones alone.
- **Delayed re-sweeps** at 1.5s, 4s, and 8s post-init to catch elements styled by Amazon's late-running JS (carousel widgets, lazy-loaded sections).
- **Explicit CSS pre-paint** for 25 common PDP widget ids so they're dark on first paint, avoiding flash-of-white before the sweep runs.

## [2.0.0] - 2026-04-14

Major feature release. 15 new features across dark-pattern protection, transparency tools, data portability, and accessibility.

### Added — Dark-pattern pack
- **Auto-decline warranty / protection plan.** Silently selects "No thanks" on SquareTrade/Allstate upsells at PDP, cart, and post-ATC interstitials (`#siNoCoverage`, `[data-feature-name="attachWarranty"]`, cart service-contract selects).
- **Force one-time purchase.** Detects pre-selected Subscribe & Save radios at PDP load and switches back to one-time (`#oneTimePurchase`, `input[name="subscriptionPlan"]`).
- **Auto-uncheck gift-receipt / share-info / add-on dark patterns** at checkout.
- **Extra "Sort by" options** — injects *Most reviews*, *Newest*, *Best $/unit* into the search sort dropdown (client-side DOM reorder; leverages existing unit-price calc).
- **CPU Tamer** (experimental) — MAIN-world-injected throttler that clamps background `setInterval`/`setTimeout` to ≥1s when tab is hidden.

### Added — Transparency pack
- **Country-of-origin badge.** Parses the Product Details table on PDPs, caches per ASIN in `chrome.storage.local`, and surfaces the origin both as a PDP badge and inline on cached search tiles.
- **Reveal seller** (SoldBy-clone). Shows the actual 3P seller name + seller-page link near the product title.
- **Variation bait detector.** Warns when a listing groups variants with >3× price spread — a common bait-and-switch pattern.
- **Local price history.** Logs each observed PDP price per ASIN to `chrome.storage.local` (capped at 60 entries/ASIN). Renders an inline SVG sparkline with low/high/current when you revisit a product. No external API, no Keepa account.

### Added — Tools & data portability
- **Copy clean product link.** Button on PDPs that copies a Markdown-formatted link + price to clipboard.
- **Order history export.** Buttons on `/your-orders` pages to export the currently-visible page as CSV or JSON.
- **Wishlist export.** Buttons on wishlist pages to export as CSV, JSON, or Markdown.
- **Late-delivery watcher.** Background alarm (every 6 hours) scans seeded orders; fires a Chrome notification when a promised delivery date passes without "Delivered" status. Uses new `notifications` permission.

### Added — Accessibility & safety
- **Large-text mode** — bumps body text to 17px, headings scale accordingly.
- **High-contrast mode** — yellow-on-black with cyan links, green prices; overrides theme until toggled off.
- **ARIA fixes** — adds `aria-label` to Amazon's icon-only buttons so screen readers can announce them.
- **Allergen / ingredient watchlist.** User-defined terms (newline-separated) scan product title, bullets, description, A+ content, and details on every PDP. Matches show a warning banner.

### Added — UI
- Popup expanded from 6 tabs to 10: *Ads · Declutter · Reviews · Price · Cart · Trust · Tools · Brands · A11y · Theme*.
- Width bumped 420→460px.
- New chrome classes: `.amze-pdp-badge`, `.amze-pdp-warn`, `.amze-action-btn`, `.amze-export-wrap`, `.amze-badge-country`.

### Changed
- `manifest.json` — added `notifications` permission for the late-delivery watcher.
- `early-inject.js` — also sets `data-amze-large-text` / `data-amze-high-contrast` on `<html>`.

## [1.1.2] - 2026-04-14

### Fixed
- Persistent white backgrounds on cart, checkout, and PDP widgets. Added inline-style attribute CSS overrides + runtime JS sweep that marks near-white containers with `data-amze-kw`.
- Tile image-mode now has 10px padding + visible border/shadow (was near-invisible at 4px).

## [1.1.1] - 2026-04-14

### Fixed
- Lavender-card homepage bug — `.a-dynamic-image` was hitting container divs. All image-mode selectors now `img`-scoped.
- Added dark-theme coverage for `.a-cardui`, `.gw-card`, `[class*="FluidCard"]`, `#hlb-message`, `#hlb-subcart`, `#sw-subtotal`, `#rcx_container`, and other widgets.

## [1.1.0] - 2026-04-14

### Added
- Image dark-mode system: `off`, `tile` (default), `dim`, `invert`, `smart`.
- Broader dark-theme coverage (autocomplete, modals, reviews, side refinement panel, checkout, account/orders, variant swatches).

## [1.0.0] - 2026-04-14

Initial release — 20 Amazon locales; sponsored removal, 13 declutter toggles, review scoring, price-per-unit, MSRP flag, affiliate stripper, brand filters, Catppuccin/AMOLED/Light themes.
