const fs = require('node:fs/promises');
const path = require('node:path');
const esbuild = require('esbuild');
const { createZip } = require('../zip-store.js');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const JS_FILES = [
  'early-inject.js',
  'feature-modules.js',
  'service-worker-warm.js',
  'error-buffer.js',
  'session-state.js',
  'shadow-ui.js',
  'unit-price.js',
  'price-history.js',
  'variant-price.js',
  'price-history-io.js',
  'upgrade-skip.js',
  'prime-trial.js',
  'shipping-diff.js',
  'return-reasons.js',
  'wishlist-import.js',
  'invoice-export.js',
  'zip-store.js',
  'receipt-markdown.js',
  'mutation-queue.js',
  'content.js',
  'background.js',
  'popup.js',
  'sidepanel.js'
];
const CSS_FILES = ['theme.css', 'shadow-ui.css', 'popup.css'];
const STATIC_FILES = [
  'browser-polyfill.min.js',
  'defaults.json',
  'locales.json',
  'selectors.json',
  'popup.html',
  'sidepanel.html',
  'THIRD_PARTY_NOTICES.txt',
  'LICENSE'
];

async function readJson(name) {
  return JSON.parse(await fs.readFile(path.join(ROOT, name), 'utf8'));
}

async function writeReleaseManifest() {
  const manifest = await readJson('manifest.json');
  const locales = await readJson('locales.json');
  const patterns = locales.locales.map(entry => entry.pattern).filter(Boolean);
  if (patterns.length !== 20) throw new Error(`expected 20 locale patterns, found ${patterns.length}`);
  for (const script of manifest.content_scripts || []) script.matches = patterns;
  for (const resource of manifest.web_accessible_resources || []) resource.matches = patterns;
  await fs.writeFile(path.join(DIST, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function copyStaticFiles() {
  await Promise.all(STATIC_FILES.map(async name => {
    await fs.copyFile(path.join(ROOT, name), path.join(DIST, name));
  }));
  await fs.cp(path.join(ROOT, 'icons'), path.join(DIST, 'icons'), { recursive: true });
  await fs.cp(path.join(ROOT, '_locales'), path.join(DIST, '_locales'), { recursive: true });
}

async function collectFiles(root, prefix = '') {
  const entries = await fs.readdir(path.join(root, prefix), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(root, relative));
    else files.push(relative.replaceAll(path.sep, '/'));
  }
  return files;
}

async function writeReleaseZip(manifest) {
  const names = await collectFiles(DIST);
  const files = await Promise.all(names.map(async name => ({
    name,
    data: await fs.readFile(path.join(DIST, name))
  })));
  const zip = createZip(files, new Date(0), { preservePaths: true });
  const output = path.join(ROOT, `AmazonEnhanced-v${manifest.version}-release.zip`);
  await fs.writeFile(output, zip);
  return output;
}

async function build() {
  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(DIST, { recursive: true });
  await esbuild.build({
    entryPoints: JS_FILES.map(name => path.join(ROOT, name)),
    outdir: DIST,
    outbase: ROOT,
    bundle: false,
    minify: true,
    target: 'es2020',
    logLevel: 'warning'
  });
  await esbuild.build({
    entryPoints: CSS_FILES.map(name => path.join(ROOT, name)),
    outdir: DIST,
    outbase: ROOT,
    bundle: false,
    minify: true,
    logLevel: 'warning'
  });
  await copyStaticFiles();
  const manifest = await writeReleaseManifest();
  const zip = await writeReleaseZip(manifest);
  const outputFiles = await collectFiles(DIST);
  console.log(`built ${outputFiles.length} files in ${DIST}`);
  console.log(`wrote ${zip} (${(await fs.stat(zip)).size.toLocaleString()} bytes)`);
}

build().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
