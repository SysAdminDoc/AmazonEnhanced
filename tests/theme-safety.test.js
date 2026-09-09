const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const themeCss = fs.readFileSync(path.join(__dirname, '..', 'theme.css'), 'utf8');

test('side panel owns its layout and uses defined popup palette variables', () => {
  const panel = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.html'), 'utf8');
  const popup = fs.readFileSync(path.join(__dirname, '..', 'popup.css'), 'utf8');
  assert.match(panel, /body\s*\{\s*display:\s*flex;/);
  for (const [, token] of panel.matchAll(/var\((--[\w-]+)\)/g)) {
    assert.ok(popup.includes(token + ':'), `undefined palette token ${token}`);
  }
  assert.match(panel, /min-height:\s*0;\s*overflow:\s*auto/);
});

test('side-panel observations are not presented as live USD quotes', () => {
  const panel = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.html'), 'utf8');
  const source = fs.readFileSync(path.join(__dirname, '..', 'sidepanel.js'), 'utf8');
  assert.match(panel, /Currency isn't stored/);
  assert.match(source, /addStat\('Last seen'/);
  assert.doesNotMatch(source, /addStat\('Now:'/);
  assert.doesNotMatch(source, /'\$'\s*\+\s*(current|min|max)/);
  assert.match(source, /chrome\.storage\.onChanged\.addListener/);
});

test('Alexa for Shopping rules target panel roots without broad Rufus wildcards', () => {
  assert.match(themeCss, /#nav-flyout-rufus/);
  assert.match(themeCss, /\.copilot-chat-root/);
  assert.doesNotMatch(themeCss, /\[id\*="rufus"\]/i);
  assert.doesNotMatch(themeCss, /\[class\*="rufus"\](?! i)/i);
  assert.doesNotMatch(themeCss, /\[data-cel-widget\*="rufus"\]/i);
});

test('Midnight Gallery keeps a premium dark palette with familiar commerce actions', () => {
  assert.match(themeCss, /--amze-bg:\s+#090d16/);
  assert.match(themeCss, /--amze-surface:\s+#101827/);
  assert.match(themeCss, /--amze-image-mat:\s+#f2f4f7/);
  assert.match(themeCss, /--amze-cta:\s+#ffd814/);
  assert.match(themeCss, /--amze-focus-glow:\s+rgba\(47, 142, 244, 0\.35\)/);
});

test('premium image tiles and motion preferences are preserved safely', () => {
  assert.match(themeCss, /background:\s+var\(--amze-image-mat\)\s+!important/);
  assert.match(themeCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(themeCss, /#checkoutDisplayPage \.a-box-inner/);
  assert.match(themeCss, /#search \.s-result-item\[data-component-type="s-search-result"\] h2 a:hover span/);
  assert.match(themeCss, /#buyBoxAccordion, \.a-accordion-row, \.a-accordion-inner/);
  assert.match(themeCss, /:is\(#nav-al-container, \.nav-flyout\)/);
  assert.match(themeCss, /#nav-search :is\(\.nav-search-submit-text, #nav-search-submit-button\)/);
  assert.match(themeCss, /#nav-search :is\(\.nav-search-scope, \.nav-search-facade, #nav-search-label-id\)/);
  assert.doesNotMatch(themeCss, /html\[data-amze-theme="dark"\] \.nav-sprite/);
});
