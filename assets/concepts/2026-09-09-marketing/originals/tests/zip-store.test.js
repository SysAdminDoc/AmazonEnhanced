const test = require('node:test');
const assert = require('node:assert/strict');
const { crc32, createZip } = require('../zip-store.js');

function decode(bytes) {
  return new TextDecoder().decode(bytes);
}

test('creates a readable store-only ZIP with central directory entries', () => {
  const zip = createZip([
    { name: 'one.txt', data: new TextEncoder().encode('hello') },
    { name: 'two.pdf', data: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]) }
  ], new Date('2026-01-02T03:04:06Z'));
  assert.deepEqual(Array.from(zip.slice(0, 4)), [0x50, 0x4b, 0x03, 0x04]);
  assert.ok(decode(zip).includes('one.txt'));
  assert.ok(decode(zip).includes('two.pdf'));
  assert.deepEqual(Array.from(zip.slice(-22, -18)), [0x50, 0x4b, 0x05, 0x06]);
});

test('can preserve trusted release-tree paths when requested', () => {
  const zip = createZip([
    { name: 'icons/128.png', data: new Uint8Array([1, 2, 3]) },
    { name: 'nested\\messages.json', data: new Uint8Array([4]) }
  ], new Date('2026-01-02T03:04:06Z'), { preservePaths: true });
  const text = decode(zip);
  assert.ok(text.includes('icons/128.png'));
  assert.ok(text.includes('nested/messages.json'));
  assert.ok(!text.includes('../'));
});

test('calculates the standard CRC32 for file data', () => {
  assert.equal(crc32(new TextEncoder().encode('hello')), 0x3610a686);
});
