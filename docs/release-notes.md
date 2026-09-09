# AmazonEnhanced v2.0.18

## What's changed

The README now starts with the product, real settings captures and direct downloads. Installation distinguishes unpacked Chromium use from temporary Firefox testing. The guide explains the automatic Cart defaults and what local prices, review indicators and exports can tell you.

Settings text now describes seller-name mismatches and broad brand filters without treating a match as proof of misconduct. Price alerts and the ingredient watchlist have clearer limits. Existing behavior is preserved.

Release JavaScript and CSS are readable. Browser checks verify the installed manifest before choosing a worker, so a built-in browser component can't be mistaken for AmazonEnhanced.

All browser packages now include the project license. Packaging stops on missing inputs. CRX signing requires the existing key and won't silently create a replacement identity.

The price-history panel no longer inherits the settings popup's two-column layout or references removed palette variables. It follows the saved theme, keeps cards readable in a narrow sidebar and labels prices as observations. Stored records lack currency metadata, so the panel no longer adds an unsupported dollar symbol.

The existing shield icon is retained. Originals and visual review evidence live in the [concept archive](../assets/concepts/2026-09-09-marketing/README.md).

## Verification boundaries

The release passed 104 JavaScript tests and six packaging tests locally. Chromium and Microsoft Edge checks verified all 27 managed network rules, ten settings sections, sidebar layout and eight blocked request probes. Firefox temporarily installed the generated XPI and passed its settings, sidebar, network-rule and synthetic search/product checks. The CRX signature matches the previous release's identity. Each browser package contains 53 verified files.

Screenshots use a fresh headless profile with the actual installed extension. Automated page checks use synthetic, clearly identified fixtures and don't sign into Amazon or place an order. They test selectors and extension behavior against those documents, not every current live marketplace layout.

The release XPI is unsigned and intended for temporary development testing. The CRX is signed with the project's existing self-host key; this isn't a Chrome Web Store approval or a promise that every browser accepts a dragged CRX. Use the release ZIP for manual Chrome/Edge installation.

Live checkout, invoice access, real-account wishlist import, external seller lookup and store publication aren't claimed as tested by these isolated checks.
