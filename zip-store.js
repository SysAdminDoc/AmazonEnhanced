(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.AmzeZipStore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  let crcTable = null;

  function getCrcTable() {
    if (crcTable) return crcTable;
    crcTable = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      return c >>> 0;
    });
    return crcTable;
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    const table = getCrcTable();
    for (const byte of bytes) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function u16(value) {
    return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
  }

  function u32(value) {
    return new Uint8Array([
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 24) & 0xff
    ]);
  }

  function concat(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    parts.forEach(part => {
      result.set(part, offset);
      offset += part.length;
    });
    return result;
  }

  function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    return new Uint8Array(data || []);
  }

  function dosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    return {
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
    };
  }

  function createZip(files, now = new Date(), options = {}) {
    const encoder = new TextEncoder();
    const preservePaths = !!options.preservePaths;
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const stamp = dosDateTime(now);

    for (const file of (files || [])) {
      const rawName = String(file.name || 'file.bin');
      const safeName = preservePaths
        ? rawName.replace(/\\/g, '/').split('/').filter(part => part && part !== '.' && part !== '..').join('/')
        : rawName.replace(/[\\/]+/g, '-');
      const name = encoder.encode(safeName || 'file.bin');
      const data = toBytes(file.data);
      const crc = crc32(data);
      const local = concat([
        new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
        u16(20), u16(0x0800), u16(0), u16(stamp.time), u16(stamp.date),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name, data
      ]);
      localParts.push(local);
      const central = concat([
        new Uint8Array([0x50, 0x4b, 0x01, 0x02]),
        u16(20), u16(20), u16(0x0800), u16(0), u16(stamp.time), u16(stamp.date),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name
      ]);
      centralParts.push(central);
      offset += local.length;
    }

    const localData = concat(localParts);
    const centralData = concat(centralParts);
    const end = concat([
      new Uint8Array([0x50, 0x4b, 0x05, 0x06]),
      u16(0), u16(0), u16(centralParts.length), u16(centralParts.length),
      u32(centralData.length), u32(localData.length), u16(0)
    ]);
    return concat([localData, centralData, end]);
  }

  return { crc32, createZip };
});
