const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const themeCss = fs.readFileSync(path.join(__dirname, '..', 'theme.css'), 'utf8');

test('Alexa for Shopping rules target panel roots without broad Rufus wildcards', () => {
  assert.match(themeCss, /#nav-flyout-rufus/);
  assert.match(themeCss, /\.copilot-chat-root/);
  assert.doesNotMatch(themeCss, /\[id\*="rufus"\]/i);
  assert.doesNotMatch(themeCss, /\[class\*="rufus"\](?! i)/i);
  assert.doesNotMatch(themeCss, /\[data-cel-widget\*="rufus"\]/i);
});
