const test = require('node:test');
const assert = require('node:assert/strict');
const { mountElement } = require('../shadow-ui.js');

test('mounts a PDP element behind an isolated shadow host', () => {
  const previousDocument = global.document;
  const previousChrome = global.chrome;
  class FakeElement {
    constructor(tag) {
      this.tagName = tag;
      this.children = [];
      this.parentElement = null;
      this.id = '';
      this.className = '';
      this.attributes = {};
    }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    attachShadow() {
      this.shadowRoot = { children: [], appendChild: child => { this.shadowRoot.children.push(child); child.parentElement = this.shadowRoot; } };
      return this.shadowRoot;
    }
    appendChild(child) { this.children.push(child); child.parentElement = this; }
  }
  const inserted = [];
  const target = new FakeElement('div');
  target.parentElement = { insertBefore: (node, before) => inserted.push({ node, before }) };
  global.document = { createElement: tag => new FakeElement(tag) };
  global.chrome = { runtime: { getURL: path => `chrome-extension://test/${path}` } };
  try {
    const element = new FakeElement('section');
    element.id = 'amze-test-panel';
    const mounted = mountElement(element, target, 'after');
    assert.equal(mounted.host.id, 'amze-test-panel');
    assert.equal(mounted.host.attributes['data-amze-shadow-host'], '1');
    assert.equal(mounted.shadow.children[0].href, 'chrome-extension://test/shadow-ui.css');
    assert.equal(mounted.shadow.children[1], element);
    assert.equal(inserted[0].node, mounted.host);
    assert.equal(inserted[0].before, undefined);
  } finally {
    global.document = previousDocument;
    global.chrome = previousChrome;
  }
});
