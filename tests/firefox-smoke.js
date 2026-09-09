const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const networkRules = require('../network-rules.js');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const XPI = path.join(ROOT, `AmazonEnhanced-v${MANIFEST.version}.xpi`);
const OPEN_CORPORATES_ORIGIN = 'https://api.opencorporates.com/*';
const AD_MARKER = 'amze-firefox-ad-probe';
const TIMEOUT_MS = 30000;

const SEARCH_HTML = `<!doctype html>
  <html><head><meta charset="utf-8"><title>Firefox search fixture</title></head><body>
    <main id="search">
      <article id="core-search-result" class="s-result-item" data-component-type="s-search-result" data-asin="B000000001">Core result</article>
      <article id="sponsored-result" data-component-type="sp-sponsored-result">Sponsored result</article>
      <aside id="ad-shell" class="AdHolder">Ad shell</aside>
    </main>
    <script>
      window.__amzeFixture = { adSettled: false };
      fetch('http://amazon-adsystem.com/${AD_MARKER}.gif', { mode: 'no-cors' })
        .catch(() => null)
        .finally(() => { window.__amzeFixture.adSettled = true; });
    </script>
  </body></html>`;

const PDP_HTML = `<!doctype html>
  <html><head><meta charset="utf-8"><title>Firefox PDP fixture</title></head><body>
    <main id="dp">
      <h1 id="productTitle">Core product</h1>
      <section id="buybox"><button id="core-buy-action">Add to Cart</button></section>
      <aside id="sp_detail">Sponsored PDP shell</aside>
    </main>
  </body></html>`;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function findOnPath(name) {
  for (const directory of String(process.env.PATH || '').split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, name);
    if (fs.existsSync(candidate)) return path.resolve(candidate);
  }
  return '';
}

function findFirefox() {
  if (process.env.AMZE_FIREFOX_PATH) {
    const explicit = path.resolve(process.env.AMZE_FIREFOX_PATH);
    if (!fs.existsSync(explicit)) throw new Error(`Configured Firefox binary does not exist: ${explicit}`);
    return explicit;
  }
  const candidates = process.platform === 'win32'
    ? [
        'C:\\Program Files\\Mozilla Firefox\\firefox.exe',
        'C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe'
      ]
    : process.platform === 'darwin'
      ? ['/Applications/Firefox.app/Contents/MacOS/firefox']
      : ['/usr/bin/firefox', '/usr/bin/firefox-esr'];
  const ordinary = candidates.find(candidate => fs.existsSync(candidate));
  if (ordinary) return path.resolve(ordinary);
  if (process.platform === 'win32') {
    const executionAlias = findOnPath('firefox.exe');
    if (executionAlias && fs.existsSync(executionAlias)) return executionAlias;
    const appx = spawnSync('powershell.exe', [
      '-NoProfile',
      '-Command',
      "(Get-AppxPackage -Name 'Mozilla.MozillaFirefox' | Select-Object -First 1).InstallLocation"
    ], { encoding: 'utf8', windowsHide: true });
    const appxRoot = String(appx.stdout || '').trim();
    if (appx.status === 0 && appxRoot) {
      const packaged = path.join(
        appxRoot,
        'VFS',
        'ProgramFiles',
        'MozillaFirefox Package Root',
        'firefox.exe'
      );
      if (fs.existsSync(packaged)) return packaged;
    }
    const appRoot = 'C:\\Program Files\\WindowsApps';
    if (fs.existsSync(appRoot)) {
      let packageNames = [];
      try { packageNames = fs.readdirSync(appRoot); } catch (error) {}
      const packages = packageNames
        .filter(name => /^Mozilla\.MozillaFirefox_.*_x64__jag0gd4e3s9p2$/i.test(name))
        .sort()
        .reverse();
      for (const packageName of packages) {
        const candidate = path.join(
          appRoot,
          packageName,
          'VFS',
          'ProgramFiles',
          'MozillaFirefox Package Root',
          'firefox.exe'
        );
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  throw new Error('Firefox not found. Set AMZE_FIREFOX_PATH to an installed Firefox binary.');
}

function findGeckodriver() {
  if (process.env.GECKODRIVER_PATH) {
    const explicit = path.resolve(process.env.GECKODRIVER_PATH);
    if (!fs.existsSync(explicit)) throw new Error(`Configured geckodriver does not exist: ${explicit}`);
    return explicit;
  }
  const executable = process.platform === 'win32' ? 'geckodriver.exe' : 'geckodriver';
  const onPath = findOnPath(executable);
  if (onPath) return onPath;
  throw new Error('geckodriver not found. Set GECKODRIVER_PATH to the executable.');
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function startFixtureProxy() {
  const requests = [];
  const server = http.createServer((request, response) => {
    const rawUrl = String(request.url || '/');
    const parsed = new URL(rawUrl, `http://${request.headers.host || 'fixture.invalid'}`);
    requests.push(parsed.href);
    const headers = {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=utf-8'
    };
    if (parsed.pathname === '/amze-firefox/search') {
      response.writeHead(200, headers);
      response.end(SEARCH_HTML);
      return;
    }
    if (parsed.pathname === '/amze-firefox/dp/B000000002') {
      response.writeHead(200, headers);
      response.end(PDP_HTML);
      return;
    }
    response.writeHead(204, { 'Cache-Control': 'no-store' });
    response.end();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    server,
    port: server.address().port,
    requests,
    close: () => new Promise(resolve => server.close(resolve))
  };
}

class WebDriverClient {
  constructor(port) {
    this.baseUrl = `http://127.0.0.1:${port}`;
    this.sessionId = '';
  }

  async request(method, endpoint, body) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch (error) {
      throw new Error(`${method} ${endpoint} returned non-JSON: ${text.slice(0, 500)}`);
    }
    if (!response.ok || payload.value?.error) {
      const detail = payload.value?.message || payload.message || `${response.status} ${response.statusText}`;
      throw new Error(`${method} ${endpoint}: ${detail}`);
    }
    return payload.value;
  }

  command(method, endpoint, body) {
    assert.ok(this.sessionId, 'WebDriver session is not initialized');
    return this.request(method, `/session/${this.sessionId}${endpoint}`, body);
  }

  navigate(url) {
    return this.command('POST', '/url', { url });
  }

  execute(script, args = []) {
    return this.command('POST', '/execute/sync', { script, args });
  }

  executeAsync(script, args = []) {
    return this.command('POST', '/execute/async', { script, args });
  }

  setContext(context) {
    return this.command('POST', '/moz/context', { context });
  }
}

async function waitForDriver(client, child) {
  const started = Date.now();
  while (Date.now() - started < TIMEOUT_MS) {
    if (child.exitCode !== null) throw new Error(`geckodriver exited early (${child.exitCode})`);
    try {
      const status = await client.request('GET', '/status');
      if (status && status.ready) return;
    } catch (error) {}
    await sleep(100);
  }
  throw new Error('geckodriver did not become ready');
}

async function startWebDriver(firefox, geckodriver, proxyPort) {
  const port = await getFreePort();
  const child = spawn(geckodriver, ['--host', '127.0.0.1', '--port', String(port), '--log', 'warn', '--allow-system-access'], {
    cwd: os.tmpdir(),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let logs = '';
  child.stdout.on('data', chunk => { logs = (logs + chunk).slice(-10000); });
  child.stderr.on('data', chunk => { logs = (logs + chunk).slice(-10000); });
  const client = new WebDriverClient(port);
  try {
    await waitForDriver(client, child);
    const session = await client.request('POST', '/session', {
      capabilities: {
        alwaysMatch: {
          browserName: 'firefox',
          acceptInsecureCerts: true,
          pageLoadStrategy: 'normal',
          timeouts: { implicit: 0, pageLoad: TIMEOUT_MS, script: TIMEOUT_MS },
          'moz:firefoxOptions': {
            binary: firefox,
            args: ['-headless'],
            prefs: {
              'browser.shell.checkDefaultBrowser': false,
              'browser.startup.homepage': 'about:blank',
              'datareporting.policy.dataSubmissionEnabled': false,
              'devtools.chrome.enabled': true,
              'network.captive-portal-service.enabled': false,
              'network.connectivity-service.enabled': false,
              'network.proxy.type': 1,
              'network.proxy.http': '127.0.0.1',
              'network.proxy.http_port': proxyPort,
              'network.proxy.ssl': '127.0.0.1',
              'network.proxy.ssl_port': proxyPort,
              'network.proxy.share_proxy_settings': true,
              'network.proxy.no_proxies_on': 'localhost, 127.0.0.1',
              'network.stricttransportsecurity.preloadlist': false,
              'network.stricttransportsecurity.preloadlist.testing': false,
              'security.remote_settings.crlite_filters.enabled': false,
              'toolkit.telemetry.enabled': false
            }
          }
        }
      }
    });
    client.sessionId = session.sessionId;
    return { child, client, capabilities: session.capabilities, logs: () => logs };
  } catch (error) {
    if (logs) error.message += `\ngeckodriver logs:\n${logs}`;
    terminate(child);
    throw error;
  }
}

function terminate(child) {
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

async function waitForValue(driver, script, label, timeoutMs = TIMEOUT_MS) {
  const started = Date.now();
  let lastValue;
  while (Date.now() - started < timeoutMs) {
    try {
      lastValue = await driver.execute(script);
      if (lastValue) return lastValue;
    } catch (error) {
      lastValue = error.message;
    }
    await sleep(100);
  }
  throw new Error(`${label} did not become true (last value: ${JSON.stringify(lastValue)})`);
}

async function getExtensionUuid(driver, addonId) {
  await driver.setContext('chrome');
  try {
    const serialized = await driver.execute(`
      const service = globalThis.Services
        || ChromeUtils.importESModule('resource://gre/modules/Services.sys.mjs').Services;
      return service.prefs.getStringPref('extensions.webextensions.uuids', '{}');
    `);
    const mapping = JSON.parse(serialized || '{}');
    const uuid = mapping[addonId];
    if (!uuid) throw new Error(`Firefox did not assign a moz-extension UUID to ${addonId}`);
    return uuid;
  } finally {
    await driver.setContext('content');
  }
}

async function inspectExtension(driver, uuid) {
  await driver.navigate(`moz-extension://${uuid}/popup.html`);
  const popup = await waitForValue(driver, `
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
  `, 'Firefox popup state');
  assert.deepEqual(popup, {
    tabCount: 10,
    sellerEnabled: false,
    tokenDisabled: true,
    permissionCopy: 'Enable seller lookup to grant access to OpenCorporates.'
  });

  const platform = await driver.executeAsync(`
    const done = arguments[arguments.length - 1];
    Promise.all([
      browser.declarativeNetRequest.getDynamicRules(),
      browser.permissions.contains({ origins: ['${OPEN_CORPORATES_ORIGIN}'] }),
      browser.storage.local.get(['amzeSettings'])
    ]).then(([rules, permission, stored]) => {
      const manifest = browser.runtime.getManifest();
      done({
        manifest,
        rules,
        permission,
        settingsSeeded: !!stored.amzeSettings,
        requestApi: typeof browser.permissions.request === 'function',
        removeApi: typeof browser.permissions.remove === 'function'
      });
    }, error => done({ error: String(error && error.message || error) }));
  `);
  assert.equal(platform.error, undefined, platform.error);
  assert.equal(platform.rules.length, networkRules.MANAGED_RULE_IDS.length);
  assert.deepEqual(
    platform.rules.map(rule => rule.id).sort((a, b) => a - b),
    [...networkRules.MANAGED_RULE_IDS].sort((a, b) => a - b)
  );
  assert.equal(platform.permission, false);
  assert.equal(platform.settingsSeeded, true);
  assert.equal(platform.requestApi, true);
  assert.equal(platform.removeApi, true);
  assert.match(platform.manifest.sidebar_action?.default_panel || '', /\/sidepanel\.html$/);
  assert.equal(platform.manifest.side_panel, undefined);
  assert.equal(platform.manifest.permissions.includes('sidePanel'), false);
  assert.ok(platform.manifest.optional_host_permissions.includes(OPEN_CORPORATES_ORIGIN));

  await driver.navigate(`moz-extension://${uuid}/sidepanel.html`);
  const sidePanel = await waitForValue(driver, `
    return document.querySelectorAll('.amze-sp-tab').length === 2 ? {
      title: document.title,
      layout: getComputedStyle(document.body).display,
      separated: document.querySelector('.amze-sp-header').getBoundingClientRect().bottom <= document.querySelector('.amze-sp-tabs').getBoundingClientRect().top,
      empty: document.querySelector('#sp-empty')?.textContent.trim() || ''
    } : null;
  `, 'Firefox sidebar page state');
  assert.equal(sidePanel.title, 'AmazonEnhanced Price History');
  assert.equal(sidePanel.layout, 'flex');
  assert.equal(sidePanel.separated, true);
  assert.match(sidePanel.empty, /Browse Amazon product pages/);
  return platform;
}

async function verifyAmazonRoutes(driver, fixtureProxy) {
  const searchUrl = 'http://www.amazon.com/amze-firefox/search';
  await driver.navigate(searchUrl);
  const search = await waitForValue(driver, `
    const visible = selector => {
      const node = document.querySelector(selector);
      if (!node) return false;
      const style = getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden';
    };
    return document.documentElement.dataset.amzeReady === '1'
      && document.documentElement.dataset.amzeTheme === 'dark'
      && visible('#core-search-result')
      && !document.querySelector('#sponsored-result')
      && !document.querySelector('#ad-shell')
      && window.__amzeFixture?.adSettled === true ? {
        url: location.href,
        title: document.title
      } : null;
  `, 'Firefox search outcome');
  assert.equal(search.url, searchUrl);

  const pdpUrl = 'http://www.amazon.com/amze-firefox/dp/B000000002';
  await driver.navigate(pdpUrl);
  const pdp = await waitForValue(driver, `
    const visible = selector => {
      const node = document.querySelector(selector);
      if (!node) return false;
      const style = getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden';
    };
    return document.documentElement.dataset.amzeReady === '1'
      && visible('#productTitle')
      && visible('#core-buy-action')
      && !document.querySelector('#sp_detail') ? {
        url: location.href,
        title: document.title
      } : null;
  `, 'Firefox PDP outcome');
  assert.equal(pdp.url, pdpUrl);
  assert.equal(
    fixtureProxy.requests.some(url => url.includes(AD_MARKER)),
    false,
    'Firefox ad probe reached the isolated fixture proxy instead of DNR'
  );
  return [search, pdp];
}

async function main() {
  assert.ok(fs.existsSync(XPI), `Firefox package is missing: ${XPI}; run npm run build:firefox first`);
  const firefox = findFirefox();
  const geckodriver = findGeckodriver();
  const fixtureProxy = await startFixtureProxy();
  let runtime;
  let primaryError = null;
  try {
    runtime = await startWebDriver(firefox, geckodriver, fixtureProxy.port);
    const profile = path.resolve(runtime.capabilities['moz:profile'] || '');
    assert.ok(profile && !profile.startsWith(ROOT + path.sep), 'Firefox profile must stay outside the repository');
    const addonId = await runtime.client.command('POST', '/moz/addon/install', {
      path: XPI,
      temporary: true
    });
    assert.equal(addonId, 'amazonenhanced@sysadmindoc.com');
    const uuid = await getExtensionUuid(runtime.client, addonId);
    const platform = await inspectExtension(runtime.client, uuid);
    const routes = await verifyAmazonRoutes(runtime.client, fixtureProxy);

    console.log(`Firefox: ${firefox}`);
    console.log(`Profile: isolated (${profile})`);
    console.log(`Extension: ${addonId} (temporary XPI)`);
    console.log(`Dynamic rules: ${platform.rules.length} (7 block / 20 redirect)`);
    console.log('Settings: 10 tabs; OpenCorporates permission optional, available, and not pre-granted');
    console.log('Sidebar: manifest mapping and empty state verified');
    console.log(`Routes: ${routes.map(route => route.title.replace(' fixture', '')).join(', ')}`);
    console.log('Ad probes: blocked before reaching the isolated proxy; visible ad shells: 0');
  } catch (error) {
    primaryError = error;
    if (runtime && runtime.logs()) error.message += `\ngeckodriver logs:\n${runtime.logs()}`;
    throw error;
  } finally {
    if (runtime?.client.sessionId) {
      try { await runtime.client.request('DELETE', `/session/${runtime.client.sessionId}`); } catch (error) {
        if (primaryError) primaryError.message += `\nFirefox session cleanup also failed: ${error.message}`;
      }
    }
    terminate(runtime?.child);
    await fixtureProxy.close();
  }
}

main().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
