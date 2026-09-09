const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const networkRules = require('../network-rules.js');
const crossSiteFixtures = require('./fixtures/cross-site-reviews.json');
const { matchesExtensionManifest } = require('./extension-identity.js');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PROFILE_PREFIX = 'amazonenhanced-chromium-smoke-';
const EDGE_TREE_PREFIX = 'amazonenhanced-edge-package-';
const TIMEOUT_MS = 20000;
const AD_MARKER = 'amze-smoke-ad';

const AD_PROBE_URLS = Object.freeze([
  `https://amazon-adsystem.com/${AD_MARKER}.gif`,
  `https://sponsored-ads.amazon.com/${AD_MARKER}.gif`,
  `https://pagead2.googlesyndication.com/pagead/${AD_MARKER}.gif`,
  `https://advertising.amazon.dev/${AD_MARKER}.gif`,
  `https://ara.paa-reporting-advertising.amazon/${AD_MARKER}.gif`,
  `https://unagi-na.amazon.com/1/events/com.amazon.eel.SponsoredProductsEventTracking.prod/${AD_MARKER}`,
  `https://m.media-amazon.com/images/G/01/ad-feedback/${AD_MARKER}.gif`
]);

const RETAIL_FIXTURES = Object.freeze(Object.fromEntries(
  crossSiteFixtures.sites.map(fixture => [fixture.id, fixture])
));

const ROUTES = Object.freeze([
  {
    name: 'search',
    url: 'https://www.amazon.com/amze-smoke/search',
    html: `<!doctype html>
      <html><head><meta charset="utf-8"><title>Search fixture</title></head><body>
        <main id="search">
          <article id="core-search-result" class="s-result-item" data-component-type="s-search-result" data-asin="B000000001">
            <h2>Core search result</h2>
          </article>
          <article id="eager-sponsored" data-component-type="sp-sponsored-result">Sponsored fixture</article>
          <aside id="eager-ad-shell" class="AdHolder">Ad shell</aside>
          <article id="localized-label-only" class="s-result-item" data-component-type="s-search-result" data-asin="B000000003">
            <span class="a-color-secondary">Patrocinado</span>
          </article>
        </main>
        <script>
          window.__amzeFixture = { lateInserted: false, adProbeSettled: false };
          setTimeout(() => {
            const late = document.createElement('article');
            late.id = 'late-sponsored';
            late.setAttribute('data-component-type', 'sp-sponsored-result');
            late.innerHTML = '<span class="puis-sponsored-label-text">Sponsored</span>';
            document.querySelector('#search').appendChild(late);
            window.__amzeFixture.lateInserted = true;
          }, 350);
          Promise.allSettled(${JSON.stringify(AD_PROBE_URLS)}.map(url => fetch(url, { mode: 'no-cors' })))
            .then(() => { window.__amzeFixture.adProbeSettled = true; });
        </script>
      </body></html>`,
    expression: `(() => {
      const visible = selector => {
        const node = document.querySelector(selector);
        if (!node) return false;
        const style = getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden';
      };
      return document.documentElement.dataset.amzeReady === '1'
        && document.documentElement.dataset.amzeTheme === 'dark'
        && visible('#core-search-result')
        && !document.querySelector('#eager-sponsored')
        && !document.querySelector('#eager-ad-shell')
        && !document.querySelector('#localized-label-only')
        && window.__amzeFixture?.lateInserted === true
        && !document.querySelector('#late-sponsored')
        && window.__amzeFixture?.adProbeSettled === true;
    })()`
  },
  {
    name: 'pdp',
    url: 'https://www.amazon.com/amze-smoke/dp/B000000002',
    html: `<!doctype html>
      <html><head><meta charset="utf-8"><title>PDP fixture</title></head><body>
        <main id="dp">
          <h1 id="productTitle">Core product</h1>
          <section id="buybox"><button id="core-buy-action">Add to Cart</button></section>
          <aside id="pdp-sponsored" data-component-type="sp-sponsored-result">Sponsored fixture</aside>
          <aside id="sp_detail">Sponsored shell</aside>
        </main>
      </body></html>`,
    expression: `(() => {
      const visible = selector => {
        const node = document.querySelector(selector);
        if (!node) return false;
        const style = getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden';
      };
      return document.documentElement.dataset.amzeReady === '1'
        && visible('#productTitle')
        && visible('#core-buy-action')
        && !document.querySelector('#pdp-sponsored')
        && !visible('#sp_detail');
    })()`
  },
  {
    name: 'cart',
    url: 'https://www.amazon.com/amze-smoke/gp/cart/view.html',
    html: `<!doctype html>
      <html><head><meta charset="utf-8"><title>Cart fixture</title></head><body>
        <main id="sc-active-cart">
          <article id="core-cart-item">Core cart item</article>
          <aside id="sc-new-upsell">Sponsored cart upsell</aside>
        </main>
      </body></html>`,
    expression: `(() => {
      const visible = selector => {
        const node = document.querySelector(selector);
        if (!node) return false;
        const style = getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden';
      };
      return document.documentElement.dataset.amzeReady === '1'
        && visible('#core-cart-item')
        && !document.querySelector('#sc-new-upsell');
    })()`
  },
  {
    name: 'prime',
    url: 'https://www.primevideo.com/amze-smoke/home',
    html: `<!doctype html>
      <html><head><meta charset="utf-8"><title>Prime fixture</title></head><body>
        <main>
          <button id="core-prime-action">Watch core offer</button>
          <aside id="prime-video-ad" class="dv-player-ad-container">Video ad</aside>
          <aside id="prime-join" data-testid="pv-nav-join-prime">Join Prime</aside>
          <aside id="prime-sponsored" data-testid="sponsored-carousel">Sponsored</aside>
        </main>
        <script>
          window.__amzeFixture = { adProbeSettled: false };
          fetch('https://amazon-adsystem.com/${AD_MARKER}-prime.gif', { mode: 'no-cors' })
            .catch(() => null)
            .finally(() => { window.__amzeFixture.adProbeSettled = true; });
        </script>
      </body></html>`,
    expression: `(() => {
      const hidden = selector => {
        const node = document.querySelector(selector);
        if (!node) return false;
        const style = getComputedStyle(node);
        return style.display === 'none' || style.visibility === 'hidden';
      };
      const core = document.querySelector('#core-prime-action');
      const coreStyle = core && getComputedStyle(core);
      return !!document.querySelector('#amze-prime-video-declutter')
        && !!core
        && coreStyle.display !== 'none'
        && coreStyle.visibility !== 'hidden'
        && hidden('#prime-video-ad')
        && hidden('#prime-join')
        && hidden('#prime-sponsored')
        && window.__amzeFixture?.adProbeSettled === true;
    })()`
  },
  {
    name: 'walmart-reviews',
    url: `https://${RETAIL_FIXTURES.walmart.hostname}${RETAIL_FIXTURES.walmart.productPaths[0]}`,
    html: `<!doctype html>
      <html><head><meta charset="utf-8"><title>Walmart reviews fixture</title></head><body>
        <main>
          <section data-testid="reviews">
            <span data-testid="review-count">1.2K reviews</span>
            <div id="fixture-review-list"></div>
          </section>
        </main>
        <script>
          window.__amzeFixture = { reviewsInserted: false };
          setTimeout(() => {
            document.querySelector('#fixture-review-list').innerHTML = \
              '<article data-testid="review" data-reviewid="walmart-1">Verified purchase' +
                '<h3 data-testid="review-title">Useful</h3>' +
                '<p data-testid="review-text">Privacy-safe Walmart fixture one.</p>' +
                '<span data-testid="review-rating" aria-label="5 out of 5 stars"></span>' +
                '<span data-testid="review-author">Fixture author one</span></article>' +
              '<article data-testid="review" data-reviewid="walmart-2">' +
                '<h3 data-testid="review-title">Limited</h3>' +
                '<p data-testid="review-text">Privacy-safe Walmart fixture two.</p>' +
                '<span data-testid="review-rating" aria-label="2 out of 5 stars"></span>' +
                '<span data-testid="review-author">Fixture author two</span></article>';
            window.__amzeFixture.reviewsInserted = true;
          }, 350);
        </script>
      </body></html>`,
    expression: `(() => {
      const host = document.querySelector('#amze-cross-site-review');
      const text = host?.shadowRoot?.textContent || '';
      return window.__amzeFixture?.reviewsInserted === true
        && text.includes('AmazonEnhanced review analysis · Walmart')
        && text.includes('Visible sample: 2')
        && text.includes('Total reviews: 1,200');
    })()`
  },
  {
    name: 'target-reviews',
    url: `https://${RETAIL_FIXTURES.target.hostname}${RETAIL_FIXTURES.target.productPaths[0]}`,
    html: `<!doctype html>
      <html><head><meta charset="utf-8"><title>Target reviews fixture</title></head><body>
        <main>
          <section data-test="reviews">
            <span data-test="review-count">842 reviews</span>
            <div id="fixture-review-list"></div>
          </section>
        </main>
        <script>
          window.__amzeFixture = { reviewsInserted: false };
          setTimeout(() => {
            document.querySelector('#fixture-review-list').innerHTML = \
              '<article data-test="review" data-reviewid="target-1">Verified buyer' +
                '<h3 data-test="review-title">Useful</h3>' +
                '<p data-test="review-text">Privacy-safe Target fixture one.</p>' +
                '<span data-test="review-rating" aria-label="4 out of 5 stars"></span>' +
                '<span data-test="review-author">Fixture author one</span></article>' +
              '<article data-test="review" data-reviewid="target-2">' +
                '<h3 data-test="review-title">Limited</h3>' +
                '<p data-test="review-text">Privacy-safe Target fixture two.</p>' +
                '<span data-test="review-rating" aria-label="2 out of 5 stars"></span>' +
                '<span data-test="review-author">Fixture author two</span></article>';
            window.__amzeFixture.reviewsInserted = true;
          }, 350);
        </script>
      </body></html>`,
    expression: `(() => {
      const host = document.querySelector('#amze-cross-site-review');
      const text = host?.shadowRoot?.textContent || '';
      return window.__amzeFixture?.reviewsInserted === true
        && text.includes('AmazonEnhanced review analysis · Target')
        && text.includes('Visible sample: 2')
        && text.includes('Total reviews: 842');
    })()`
  },
  {
    name: 'bestbuy-route-change',
    url: `https://${RETAIL_FIXTURES.bestbuy.hostname}${RETAIL_FIXTURES.bestbuy.productPaths[0]}`,
    html: `<!doctype html>
      <html><head><meta charset="utf-8"><title>Best Buy reviews fixture</title></head><body>
        <main>
          <section class="reviews-list">
            <span class="review-count">2.4K reviews</span>
            <div id="fixture-review-list"></div>
          </section>
        </main>
        <script>
          window.__amzeFixture = { firstInserted: false, panelRemovedAfterLeave: false, secondInserted: false };
          const reviews = prefix =>
            '<article class="review-item" data-review-id="' + prefix + '-1">Verified purchase' +
              '<h3 class="review-title">' + prefix + ' useful</h3>' +
              '<p class="ugc-review-body">Privacy-safe Best Buy ' + prefix + ' fixture one.</p>' +
              '<span class="review-rating" aria-label="5 out of 5 stars"></span>' +
              '<span class="ugc-author">Fixture author one</span></article>' +
            '<article class="review-item" data-review-id="' + prefix + '-2">' +
              '<h3 class="review-title">' + prefix + ' limited</h3>' +
              '<p class="ugc-review-body">Privacy-safe Best Buy ' + prefix + ' fixture two.</p>' +
              '<span class="review-rating" aria-label="1 out of 5 stars"></span>' +
              '<span class="ugc-author">Fixture author two</span></article>';
          setTimeout(() => {
            document.querySelector('#fixture-review-list').innerHTML = reviews('First');
            window.__amzeFixture.firstInserted = true;
          }, 350);
          setTimeout(() => {
            history.pushState({}, '', '${RETAIL_FIXTURES.bestbuy.nonProductPath}');
            setTimeout(() => {
              window.__amzeFixture.panelRemovedAfterLeave = !document.querySelector('#amze-cross-site-review');
              history.pushState({}, '', '/product/second-privacy-safe-product/sku/7654321');
              document.querySelector('#fixture-review-list').innerHTML = reviews('Second');
              window.__amzeFixture.secondInserted = true;
            }, 800);
          }, 1300);
        </script>
      </body></html>`,
    expression: `(() => {
      const host = document.querySelector('#amze-cross-site-review');
      const text = host?.shadowRoot?.textContent || '';
      return window.__amzeFixture?.firstInserted === true
        && window.__amzeFixture?.panelRemovedAfterLeave === true
        && window.__amzeFixture?.secondInserted === true
        && location.pathname === '/product/second-privacy-safe-product/sku/7654321'
        && text.includes('AmazonEnhanced review analysis · Best Buy')
        && text.includes('Second useful')
        && !text.includes('First useful');
    })()`
  },
  {
    name: 'etsy-reviews',
    url: `https://${RETAIL_FIXTURES.etsy.hostname}${RETAIL_FIXTURES.etsy.productPaths[0]}`,
    html: `<!doctype html>
      <html><head><meta charset="utf-8"><title>Etsy reviews fixture</title></head><body>
        <main>
          <section data-testid="reviews">
            <span data-review-count>315 reviews</span>
            <div id="fixture-review-list"></div>
          </section>
        </main>
        <script>
          window.__amzeFixture = { reviewsInserted: false };
          setTimeout(() => {
            document.querySelector('#fixture-review-list').innerHTML = \
              '<article data-review-id="etsy-1">Verified buyer' +
                '<h3 data-review-title>Useful</h3>' +
                '<p data-review-body>Privacy-safe Etsy fixture one.</p>' +
                '<span data-rating="5"></span>' +
                '<span data-review-author>Fixture author one</span></article>' +
              '<article data-review-id="etsy-2">' +
                '<h3 data-review-title>Limited</h3>' +
                '<p data-review-body>Privacy-safe Etsy fixture two.</p>' +
                '<span data-rating="3"></span>' +
                '<span data-review-author>Fixture author two</span></article>';
            window.__amzeFixture.reviewsInserted = true;
          }, 350);
        </script>
      </body></html>`,
    expression: `(() => {
      const host = document.querySelector('#amze-cross-site-review');
      const text = host?.shadowRoot?.textContent || '';
      return window.__amzeFixture?.reviewsInserted === true
        && text.includes('AmazonEnhanced review analysis · Etsy')
        && text.includes('Visible sample: 2')
        && text.includes('Total reviews: 315');
    })()`
  }
]);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}

function findChromium() {
  const edgePackage = process.argv.includes('--edge-package');
  const environment = [
    edgePackage ? process.env.AMZE_EDGE_PATH : '',
    process.env.AMZE_CHROMIUM_PATH,
    process.env.CHROME_PATH
  ].filter(Boolean);
  if (environment.length) {
    const explicit = path.resolve(environment[0]);
    if (!fs.existsSync(explicit)) throw new Error(`Configured Chromium binary does not exist: ${explicit}`);
    return explicit;
  }
  let platformCandidates = process.platform === 'win32'
    ? [
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
      ]
    : process.platform === 'darwin'
      ? [
          '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
        ]
      : [
          '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge',
          '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'
        ];
  if (edgePackage) {
    platformCandidates = platformCandidates.filter(candidate => /(?:^|[/\\])(?:msedge(?:\.exe)?|Microsoft Edge|microsoft-edge)$/i.test(candidate));
  }
  const found = platformCandidates.find(candidate => fs.existsSync(candidate));
  if (!found) {
    throw new Error('Chromium not found. Set AMZE_CHROMIUM_PATH to an installed Chrome/Chromium/Edge binary.');
  }
  return path.resolve(found);
}

function prepareExtensionTree() {
  if (!process.argv.includes('--edge-package')) {
    return { extensionPath: DIST, temporaryTree: '' };
  }
  const edgeZip = path.join(ROOT, `AmazonEnhanced-v${JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version}-edge.zip`);
  assert.ok(fs.existsSync(edgeZip), `Edge package is missing: ${edgeZip}; run npm run build:edge first`);
  const temporaryTree = fs.mkdtempSync(path.join(os.tmpdir(), EDGE_TREE_PREFIX));
  const extracted = spawnSync('tar', ['-xf', edgeZip, '-C', temporaryTree], {
    cwd: os.tmpdir(),
    windowsHide: true,
    encoding: 'utf8'
  });
  if (extracted.status !== 0) {
    removeTemporaryTree(temporaryTree, EDGE_TREE_PREFIX);
    throw new Error(`Could not extract Edge package: ${extracted.stderr || extracted.stdout || extracted.status}`);
  }
  return { extensionPath: temporaryTree, temporaryTree };
}

async function waitForFile(filePath, child, timeoutMs = TIMEOUT_MS) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (fs.existsSync(filePath)) return;
    if (child.exitCode !== null) throw new Error(`Chromium exited before DevTools started (${child.exitCode})`);
    await sleep(50);
  }
  throw new Error(`DevTools endpoint did not appear at ${filePath}`);
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await withTimeout(new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    }), TIMEOUT_MS, 'DevTools WebSocket connection');
    this.socket.addEventListener('message', event => this.handleMessage(event.data));
    this.socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('DevTools connection closed'));
      this.pending.clear();
    });
  }

  handleMessage(data) {
    const message = JSON.parse(String(data));
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
      else pending.resolve(message.result || {});
      return;
    }
    const listeners = this.listeners.get(message.method);
    if (!listeners) return;
    for (const listener of [...listeners]) listener(message.params || {}, message.sessionId || '');
  }

  send(method, params = {}, sessionId = '') {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
    });
    this.socket.send(JSON.stringify(payload));
    return withTimeout(promise, TIMEOUT_MS, method);
  }

  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(listener);
    return () => this.listeners.get(method)?.delete(listener);
  }

  waitForEvent(method, predicate = () => true, timeoutMs = TIMEOUT_MS) {
    return withTimeout(new Promise((resolve, reject) => {
      const off = this.on(method, (params, sessionId) => {
        try {
          if (!predicate(params, sessionId)) return;
          off();
          resolve({ params, sessionId });
        } catch (error) {
          off();
          reject(error);
        }
      });
    }), timeoutMs, method);
  }

  close() {
    if (this.socket && this.socket.readyState < WebSocket.CLOSING) this.socket.close();
  }
}

async function launchChromium(binary, extensionPath) {
  assert.ok(fs.existsSync(path.join(extensionPath, 'manifest.json')), `extension manifest is missing from ${extensionPath}`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), PROFILE_PREFIX));
  const args = [
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-sync',
    '--disable-translate',
    '--metrics-recording-only',
    '--disable-search-engine-choice-screen',
    '--disable-features=AutofillServerCommunication,MediaRouter,OptimizationHints,Translate',
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--window-size=1440,900',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    ...(process.env.AMZE_SMOKE_HEADFUL === '1' ? [] : ['--headless=new']),
    'about:blank'
  ];
  const child = spawn(binary, args, {
    cwd: ROOT,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000); });
  const activePort = path.join(profile, 'DevToolsActivePort');
  try {
    await waitForFile(activePort, child);
    const [port, browserPath] = fs.readFileSync(activePort, 'utf8').trim().split(/\r?\n/);
    const client = new CdpClient(`ws://127.0.0.1:${port}${browserPath}`);
    await client.connect();
    return { child, client, profile, stderr: () => stderr };
  } catch (error) {
    error.message += stderr ? `\nChromium stderr:\n${stderr}` : '';
    terminateProcessTree(child);
    await sleep(300);
    removeProfile(profile);
    throw error;
  }
}

function terminateProcessTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    });
  } else {
    try { child.kill('SIGKILL'); } catch (error) {}
  }
}

function removeProfile(profile) {
  removeTemporaryTree(profile, PROFILE_PREFIX);
}

function removeTemporaryTree(target, expectedPrefix) {
  const resolved = path.resolve(target);
  const tempRoot = path.resolve(os.tmpdir()) + path.sep;
  if (!resolved.startsWith(tempRoot) || !path.basename(resolved).startsWith(expectedPrefix)) {
    throw new Error(`Refusing to remove unexpected temporary path: ${resolved}`);
  }
  fs.rmSync(resolved, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 100
  });
}

async function waitForServiceWorker(client, manifest) {
  const started = Date.now();
  const rejected = new Set();
  let lastError = '';
  while (Date.now() - started < TIMEOUT_MS) {
    const { targetInfos } = await client.send('Target.getTargets');
    const candidates = targetInfos.filter(info => (
      info.type === 'service_worker'
      && /^chrome-extension:\/\/[^/]+\/background\.js$/.test(info.url)
      && !rejected.has(info.targetId)
    ));
    for (const target of candidates) {
      let sessionId;
      try {
        ({ sessionId } = await client.send('Target.attachToTarget', { targetId: target.targetId, flatten: true }));
        const actual = await evaluate(client, sessionId, 'chrome.runtime.getManifest()');
        if (matchesExtensionManifest(actual, manifest)) return target;
        rejected.add(target.targetId);
      } catch (error) {
        lastError = error.message;
      } finally {
        if (sessionId) await client.send('Target.detachFromTarget', { sessionId });
      }
    }
    await sleep(100);
  }
  throw new Error(`AmazonEnhanced ${manifest.version} worker was not verified (${rejected.size} unrelated workers rejected). ${lastError}`);
}

function evaluate(client, sessionId, expression, options = {}) {
  return client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: !!options.userGesture
  }, sessionId).then(result => {
    if (result.exceptionDetails) {
      const description = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
      throw new Error(`Runtime evaluation failed: ${description}`);
    }
    return result.result?.value;
  });
}

async function inspectExtensionPage(client, url, expression, label) {
  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
  await Promise.all([
    client.send('Page.enable', {}, sessionId),
    client.send('Runtime.enable', {}, sessionId)
  ]);
  try {
    const loaded = client.waitForEvent(
      'Page.loadEventFired',
      (_params, eventSessionId) => eventSessionId === sessionId
    );
    await client.send('Page.navigate', { url }, sessionId);
    await loaded;
    const value = await waitForValue(client, sessionId, expression, label);
    return { sessionId, value };
  } catch (error) {
    await client.send('Target.closeTarget', { targetId }).catch(() => {});
    throw error;
  }
}

async function waitForValue(client, sessionId, expression, label, timeoutMs = TIMEOUT_MS) {
  const started = Date.now();
  let lastValue;
  while (Date.now() - started < timeoutMs) {
    try {
      lastValue = await evaluate(client, sessionId, expression);
      if (lastValue) return lastValue;
    } catch (error) {
      lastValue = error.message;
    }
    await sleep(100);
  }
  throw new Error(`${label} did not become true (last value: ${JSON.stringify(lastValue)})`);
}

async function verifyDynamicRules(client, serviceWorker) {
  const { sessionId } = await client.send('Target.attachToTarget', {
    targetId: serviceWorker.targetId,
    flatten: true
  });
  await client.send('Runtime.enable', {}, sessionId);
  const rules = await waitForValue(
    client,
    sessionId,
    `(async () => {
      const rules = await chrome.declarativeNetRequest.getDynamicRules();
      return rules.length === ${networkRules.MANAGED_RULE_IDS.length} ? rules : null;
    })()`,
    '27 managed dynamic rules'
  );
  assert.deepEqual(
    rules.map(rule => rule.id).sort((a, b) => a - b),
    [...networkRules.MANAGED_RULE_IDS].sort((a, b) => a - b),
    'managed dynamic rule IDs differ from network-rules.js'
  );
  assert.equal(rules.filter(rule => rule.action?.type === 'block').length, 7, 'expected seven blocking rules');
  assert.equal(rules.filter(rule => rule.action?.type === 'redirect').length, 20, 'expected 20 redirect rules');
  return { sessionId, rules };
}

async function openFixture(client, route, adEvidence) {
  const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true });
  await Promise.all([
    client.send('Page.enable', {}, sessionId),
    client.send('Runtime.enable', {}, sessionId),
    client.send('Network.enable', {}, sessionId),
    client.send('Fetch.enable', {
      patterns: [
        { urlPattern: route.url, requestStage: 'Request' },
        { urlPattern: `*${AD_MARKER}*`, requestStage: 'Request' }
      ]
    }, sessionId)
  ]);

  const offFetch = client.on('Fetch.requestPaused', (params, eventSessionId) => {
    if (eventSessionId !== sessionId) return;
    const url = params.request?.url || '';
    if (url.includes(AD_MARKER)) {
      adEvidence.escaped.push({ route: route.name, url });
      client.send('Fetch.failRequest', {
        requestId: params.requestId,
        errorReason: 'BlockedByClient'
      }, sessionId).catch(() => {});
      return;
    }
    if (url === route.url) {
      client.send('Fetch.fulfillRequest', {
        requestId: params.requestId,
        responseCode: 200,
        responseHeaders: [
          { name: 'Content-Type', value: 'text/html; charset=utf-8' },
          { name: 'Cache-Control', value: 'no-store' }
        ],
        body: Buffer.from(route.html).toString('base64')
      }, sessionId).catch(() => {});
      return;
    }
    client.send('Fetch.continueRequest', { requestId: params.requestId }, sessionId).catch(() => {});
  });
  const offResponse = client.on('Network.responseReceived', (params, eventSessionId) => {
    if (eventSessionId !== sessionId) return;
    const url = params.response?.url || '';
    if (url.includes(AD_MARKER)) {
      adEvidence.responses.push({ route: route.name, url, status: params.response.status });
    }
  });
  const requestUrls = new Map();
  const offRequest = client.on('Network.requestWillBeSent', (params, eventSessionId) => {
    if (eventSessionId !== sessionId) return;
    const url = params.request?.url || '';
    if (url.includes(AD_MARKER)) requestUrls.set(params.requestId, url);
  });
  const offFailure = client.on('Network.loadingFailed', (params, eventSessionId) => {
    if (eventSessionId !== sessionId) return;
    const url = requestUrls.get(params.requestId);
    if (!url) return;
    adEvidence.failures.push({
      route: route.name,
      url,
      reason: params.blockedReason || params.errorText || 'request_failed'
    });
  });

  try {
    const loaded = client.waitForEvent(
      'Page.loadEventFired',
      (_params, eventSessionId) => eventSessionId === sessionId
    );
    await client.send('Page.navigate', { url: route.url }, sessionId);
    await loaded;
    await waitForValue(client, sessionId, route.expression, `${route.name} fixture outcome`);
    const state = await evaluate(client, sessionId, `({
      url: location.href,
      title: document.title,
      ready: document.documentElement.dataset.amzeReady || '',
      theme: document.documentElement.dataset.amzeTheme || '',
      visibleAdShells: Array.from(document.querySelectorAll(
        '[data-component-type="sp-sponsored-result"], .AdHolder, #sp_detail, #sc-new-upsell, [data-testid*="sponsored" i], .dv-player-ad-container'
      )).filter(node => {
        const style = getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden';
      }).length
    })`);
    if (route.name !== 'bestbuy-route-change') {
      assert.equal(state.url, route.url, `${route.name} fixture URL changed unexpectedly`);
    }
    assert.equal(state.visibleAdShells, 0, `${route.name} left a visible ad shell`);
    return state;
  } finally {
    offFetch();
    offResponse();
    offRequest();
    offFailure();
    await client.send('Target.closeTarget', { targetId }).catch(() => {});
  }
}

async function main() {
  const binary = findChromium();
  const packageTree = prepareExtensionTree();
  const manifest = JSON.parse(fs.readFileSync(path.join(packageTree.extensionPath, 'manifest.json'), 'utf8'));
  assert.equal(manifest.background?.service_worker, 'background.js');
  const amazonScripts = manifest.content_scripts.find(script => (
    script.js?.includes('content.js') && script.matches?.some(match => match.includes('amazon.com'))
  ));
  assert.ok(amazonScripts, 'dist manifest is missing the Amazon content script');
  assert.ok(amazonScripts.js.includes('health-report.js'), 'health-report.js is missing from the content-script chain');

  let runtime;
  const adEvidence = { escaped: [], responses: [], failures: [] };
  let primaryError = null;
  try {
    runtime = await launchChromium(binary, packageTree.extensionPath);
    await runtime.client.send('Target.setDiscoverTargets', { discover: true });
    const serviceWorker = await waitForServiceWorker(runtime.client, manifest);
    const extensionId = new URL(serviceWorker.url).hostname;
    const { sessionId: workerSessionId, rules } = await verifyDynamicRules(runtime.client, serviceWorker);
    const platform = await evaluate(runtime.client, workerSessionId, `(async () => {
      const manifest = chrome.runtime.getManifest();
      return {
        sidePanel: manifest.side_panel?.default_path || '',
        hasSidePanelPermission: manifest.permissions.includes('sidePanel'),
        optionalOpenCorporates: manifest.optional_host_permissions?.includes('https://api.opencorporates.com/*') || false,
        openCorporatesGranted: await chrome.permissions.contains({ origins: ['https://api.opencorporates.com/*'] }),
        settingsSeeded: !!(await chrome.storage.local.get(['amzeSettings'])).amzeSettings
      };
    })()`);
    assert.deepEqual(platform, {
      sidePanel: 'sidepanel.html',
      hasSidePanelPermission: true,
      optionalOpenCorporates: true,
      openCorporatesGranted: false,
      settingsSeeded: true
    });

    const popup = await inspectExtensionPage(
      runtime.client,
      `chrome-extension://${extensionId}/popup.html`,
      `(() => {
        const seller = document.querySelector('[data-flag="sellerLookup"]');
        const token = document.querySelector('#amze-oc-token');
        const helper = document.querySelector('#amze-oc-permission-status');
        return document.querySelectorAll('[role="tab"]').length === 10
          && seller && !seller.checked && token && token.disabled && helper
          && helper.textContent.includes('Enable seller lookup') ? {
          tabCount: 10,
          sellerEnabled: seller.checked,
          tokenDisabled: token.disabled,
          permissionCopy: helper.textContent.trim()
        } : null;
      })()`,
      'settings popup state'
    );
    assert.deepEqual(popup.value, {
      tabCount: 10,
      sellerEnabled: false,
      tokenDisabled: true,
      permissionCopy: 'Enable seller lookup to grant access to OpenCorporates.'
    });
    const permissionFlow = await evaluate(runtime.client, popup.sessionId, `(async () => ({
      requestApi: typeof chrome.permissions?.request === 'function',
      removeApi: typeof chrome.permissions?.remove === 'function',
      granted: await chrome.permissions.contains({ origins: ['https://api.opencorporates.com/*'] })
    }))()`);
    assert.deepEqual(permissionFlow, { requestApi: true, removeApi: true, granted: false });

    const sidePanel = await inspectExtensionPage(
      runtime.client,
      `chrome-extension://${extensionId}/sidepanel.html`,
      `(() => document.querySelectorAll('.amze-sp-tab').length === 2 ? {
        title: document.title,
        layout: getComputedStyle(document.body).display,
        separated: document.querySelector('.amze-sp-header').getBoundingClientRect().bottom <= document.querySelector('.amze-sp-tabs').getBoundingClientRect().top,
        empty: document.querySelector('#sp-empty')?.textContent.trim() || ''
      } : null)()`,
      'side-panel page state'
    );
    assert.equal(sidePanel.value.title, 'AmazonEnhanced Price History');
    assert.equal(sidePanel.value.layout, 'flex');
    assert.equal(sidePanel.value.separated, true);
    assert.match(sidePanel.value.empty, /Browse Amazon product pages/);
    const outcomes = [];
    for (const route of ROUTES) outcomes.push(await openFixture(runtime.client, route, adEvidence));

    assert.deepEqual(adEvidence.responses, [], 'a known ad request returned a response');
    assert.deepEqual(adEvidence.escaped, [], 'a known ad request escaped DNR and reached the safety interceptor');
    assert.equal(
      new Set(adEvidence.failures.map(failure => `${failure.route}\u0000${failure.url}`)).size,
      AD_PROBE_URLS.length + 1,
      'not every known ad probe produced a browser-level request failure'
    );

    console.log(`Chromium: ${binary}`);
    console.log(`Package: ${packageTree.temporaryTree ? 'generated Edge ZIP tree' : 'dist release tree'}`);
    console.log(`Extension: ${extensionId} (${serviceWorker.url})`);
    console.log(`Dynamic rules: ${rules.length} (7 block / 20 redirect)`);
    console.log('Settings: 10 tabs; OpenCorporates permission optional, available, and not pre-granted');
    console.log('Side panel: manifest mapping and empty state verified');
    console.log(`Routes: ${outcomes.map(outcome => outcome.title.replace(' fixture', '')).join(', ')}`);
    console.log(`Ad probes: ${AD_PROBE_URLS.length + 1} blocked before response; visible ad shells: 0`);
  } catch (error) {
    primaryError = error;
    if (runtime && runtime.stderr()) error.message += `\nChromium stderr:\n${runtime.stderr()}`;
    throw error;
  } finally {
    if (runtime) {
      runtime.client.close();
      terminateProcessTree(runtime.child);
      await sleep(300);
      try {
        removeProfile(runtime.profile);
      } catch (cleanupError) {
        if (!primaryError) throw cleanupError;
        primaryError.message += `\nProfile cleanup also failed: ${cleanupError.message}`;
      }
    }
    if (packageTree.temporaryTree) {
      try {
        removeTemporaryTree(packageTree.temporaryTree, EDGE_TREE_PREFIX);
      } catch (cleanupError) {
        if (!primaryError) throw cleanupError;
        primaryError.message += `\nEdge package cleanup also failed: ${cleanupError.message}`;
      }
    }
  }
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
