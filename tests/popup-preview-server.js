const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const port = Number.parseInt(process.argv[2] || '4173', 10);
const manifestVersion = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png'
};

const previewStub = String.raw`
(function () {
  const manifest = { version: '${manifestVersion}' };
  let stored = {};
  let sellerToken = '';
  let openCorporatesGranted = false;

  globalThis.chrome = {
    runtime: {
      getURL(resource) { return new URL(resource, location.origin + '/').href; },
      getManifest() { return manifest; },
      get lastError() { return null; },
      sendMessage(message, callback) {
        const responses = {
          AMZE_CLEAR_LOCAL_DATA: { ok: true },
          AMZE_IDB_MERGE_PRICE_HISTORY: { ok: true, imported: 0 },
          AMZE_GET_ERROR_REPORT: { ok: true, report: { entries: [] } },
          AMZE_CLEAR_ERROR_BUFFER: { ok: true },
          AMZE_BROADCAST_SETTINGS: { ok: true, count: 1 },
          AMZE_GET_SELLER_LOOKUP_TOKEN: { ok: true, token: sellerToken }
        };
        if (message && message.type === 'AMZE_SET_SELLER_LOOKUP_TOKEN') {
          sellerToken = String(message.token || '');
          responses.AMZE_SET_SELLER_LOOKUP_TOKEN = { ok: true, hasToken: !!sellerToken };
        }
        const response = responses[message && message.type] || { ok: true };
        if (typeof callback === 'function') queueMicrotask(() => callback(response));
        return Promise.resolve(response);
      }
    },
    permissions: {
      contains(_request, callback) {
        if (typeof callback === 'function') queueMicrotask(() => callback(openCorporatesGranted));
        return Promise.resolve(openCorporatesGranted);
      },
      request(_request, callback) {
        openCorporatesGranted = true;
        if (typeof callback === 'function') queueMicrotask(() => callback(true));
        return Promise.resolve(true);
      },
      remove(_request, callback) {
        const removed = openCorporatesGranted;
        openCorporatesGranted = false;
        if (typeof callback === 'function') queueMicrotask(() => callback(removed));
        return Promise.resolve(removed);
      }
    },
    storage: {
      local: {
        get(keys, callback) {
          const result = {};
          const requested = Array.isArray(keys) ? keys : Object.keys(keys || {});
          for (const key of requested) if (Object.prototype.hasOwnProperty.call(stored, key)) result[key] = stored[key];
          if (typeof callback === 'function') queueMicrotask(() => callback(result));
          return Promise.resolve(result);
        },
        set(value, callback) {
          stored = Object.assign({}, stored, value || {});
          if (typeof callback === 'function') queueMicrotask(callback);
          return Promise.resolve();
        },
        remove(keys, callback) {
          for (const key of [].concat(keys || [])) delete stored[key];
          if (typeof callback === 'function') queueMicrotask(callback);
          return Promise.resolve();
        },
        clear(callback) {
          stored = {};
          if (typeof callback === 'function') queueMicrotask(callback);
          return Promise.resolve();
        }
      }
    }
  };
})();
`;

function send(res, status, type, body) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'Cross-Origin-Resource-Policy': 'same-origin'
  });
  res.end(body);
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (error, body) => {
    if (error) {
      send(res, error.code === 'ENOENT' ? 404 : 500, 'text/plain; charset=utf-8', 'Not found');
      return;
    }
    send(res, 200, contentTypes[path.extname(filePath)] || 'application/octet-stream', body);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  if (url.pathname === '/preview/popup.html') {
    fs.readFile(path.join(root, 'popup.html'), 'utf8', (error, html) => {
      if (error) {
        send(res, 500, 'text/plain; charset=utf-8', 'Could not load popup.html');
        return;
      }
      const preview = html
        .replace('<head>', '<head>\n<base href="/">')
        .replace(
          '<script src="browser-polyfill.min.js"></script>',
          '<script src="/preview/stub.js"></script>'
        );
      send(res, 200, contentTypes['.html'], preview);
    });
    return;
  }
  if (url.pathname === '/preview/stub.js') {
    send(res, 200, contentTypes['.js'], previewStub);
    return;
  }

  const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const resolved = path.resolve(root, relative || 'popup.html');
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    send(res, 403, 'text/plain; charset=utf-8', 'Forbidden');
    return;
  }
  serveFile(res, resolved);
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Popup preview: http://127.0.0.1:${port}/preview/popup.html\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
