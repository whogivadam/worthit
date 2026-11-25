// Reading and writing zips with Node's own zlib.
//
// `check-zip.mjs` already reads a central directory by hand rather than
// shelling out to `unzip` or taking a dependency; this is that same decision
// carried as far as writing one, because the Edge package is the release zip
// with a single manifest key removed (see lib/edge-package.mjs).
//
// `read` keeps each entry's compressed bytes and its metadata, and `write`
// re-emits them untouched. Only an entry whose contents are replaced is
// deflated afresh, so every other file in the output is identical to the input
// byte for byte -- in the compressed stream, not merely once extracted.
//
// Deliberately narrow: no zip64, no encryption, no data descriptors. The
// archives here are a few dozen small files, so the formats that exist to cope
// with more than that are a liability rather than a gap.

import zlib from 'node:zlib';

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const STORE = 0;
const DEFLATE = 8;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let bit = 0; bit < 8; bit += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

/** CRC-32 as the zip format wants it, unsigned. */
export function crc32(buffer) {
  let c = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

export class ZipError extends Error {}

/**
 * Every entry of a zip, in the order the central directory lists them, each
 * carrying the compressed bytes needed to re-emit it unchanged.
 */
export function read(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== END_SIGNATURE) end -= 1;
  if (end < 0) throw new ZipError('not a zip: no end-of-central-directory record');

  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const entries = [];

  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(offset) !== CENTRAL_SIGNATURE) {
      throw new ZipError(`central directory entry ${i} has the wrong signature`);
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    const local = buffer.readUInt32LE(offset + 42);

    if (buffer.readUInt32LE(local) !== LOCAL_SIGNATURE) {
      throw new ZipError(`${name} has the wrong local header signature`);
    }
    // The local header's own extra field is the authority on where the data
    // starts; zip tools routinely write a different one from the central copy.
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const compressedSize = buffer.readUInt32LE(offset + 20);

    entries.push({
      name,
      method: buffer.readUInt16LE(offset + 10),
      time: buffer.readUInt16LE(offset + 12),
      date: buffer.readUInt16LE(offset + 14),
      crc: buffer.readUInt32LE(offset + 16),
      size: buffer.readUInt32LE(offset + 24),
      attributes: buffer.readUInt32LE(offset + 38),
      compressed: buffer.subarray(start, start + compressedSize),
    });

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

/** One entry's contents, decompressed. */
export function contents(entry) {
  if (entry.method === STORE) return Buffer.from(entry.compressed);
  if (entry.method === DEFLATE) return zlib.inflateRawSync(entry.compressed);
  throw new ZipError(`${entry.name}: unsupported compression method ${entry.method}`);
}

/**
 * An entry carrying new contents, deflated now. Keeps the name, timestamp and
 * attributes so the only thing that changes about it is what it holds.
 */
export function replace(entry, data) {
  const compressed = zlib.deflateRawSync(data, { level: 9 });
  // A tiny file can deflate larger than it started; storing it is both smaller
  // and what every zip writer does here.
  const stored = compressed.length >= data.length;
  return {
    ...entry,
    method: stored ? STORE : DEFLATE,
    crc: crc32(data),
    size: data.length,
    compressed: stored ? data : compressed,
  };
}

/** A zip holding the given entries, in the given order. */
export function write(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(entry.method, 8);
    local.writeUInt16LE(entry.time, 10);
    local.writeUInt16LE(entry.date, 12);
    local.writeUInt32LE(entry.crc, 14);
    local.writeUInt32LE(entry.compressed.length, 18);
    local.writeUInt32LE(entry.size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(entry.method, 10);
    central.writeUInt16LE(entry.time, 12);
    central.writeUInt16LE(entry.date, 14);
    central.writeUInt32LE(entry.crc, 16);
    central.writeUInt32LE(entry.compressed.length, 20);
    central.writeUInt32LE(entry.size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(entry.attributes, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    locals.push(local, entry.compressed);
    centrals.push(central);
    offset += local.length + entry.compressed.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_SIGNATURE, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, directory, end]);
}
