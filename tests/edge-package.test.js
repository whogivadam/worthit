'use strict';

// Covers the zip writer and the one manifest change Edge requires.
//
// The writer is hand-rolled, so its CRC-32 is cross-checked against zlib's own
// rather than against itself, and every round trip is read back through the
// reader the rest of the tooling uses.

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');

const loadZip = () => import('../scripts/lib/zip.mjs');
const loadPackage = () => import('../scripts/lib/edge-package.mjs');

const RELEASED = {
  manifest_version: 3,
  name: '__MSG_extensionName__',
  version: '0.7.1',
  background: {
    scripts: ['lib/rates.js', 'background/background.js'],
    service_worker: 'background/background.js',
  },
  permissions: ['storage'],
};

/** A zip shaped like the released one: a manifest and a few other files. */
async function buildZip(manifest = RELEASED, extra = {}) {
  const zip = await loadZip();
  const files = {
    'manifest.json': `${JSON.stringify(manifest, null, 2)}\n`,
    'background/background.js': "if (typeof importScripts === 'function') importScripts('/lib/rates.js');\n",
    'lib/rates.js': 'x'.repeat(5000),
    LICENSE: 'MIT\n',
    ...extra,
  };
  const entries = Object.entries(files).map(([name, text]) => {
    const data = Buffer.from(text, 'utf8');
    return zip.replace(
      { name, time: 0x6000, date: 0x5900, attributes: 0x81a40000 },
      data,
    );
  });
  return { buffer: zip.write(entries), files };
}

test('the hand-rolled CRC-32 matches zlib', async () => {
  const { crc32 } = await loadZip();
  for (const sample of ['', 'a', 'hello', 'The quick brown fox', 'x'.repeat(10000)]) {
    const buffer = Buffer.from(sample, 'utf8');
    assert.equal(crc32(buffer), zlib.crc32(buffer), `crc32 differs for ${sample.length} bytes`);
  }
  // A known constant, so a matching pair of wrong implementations still fails.
  assert.equal(crc32(Buffer.from('hello')), 0x3610a686);
});

test('a written zip reads back with every file intact', async () => {
  const zip = await loadZip();
  const { buffer, files } = await buildZip();
  const entries = zip.read(buffer);

  assert.deepEqual(entries.map((e) => e.name), Object.keys(files));
  for (const entry of entries) {
    assert.equal(zip.contents(entry).toString('utf8'), files[entry.name], entry.name);
  }
});

test('a file that deflates larger than it started is stored instead', async () => {
  const zip = await loadZip();
  // Four incompressible-ish bytes: deflate adds framing, so storing is smaller.
  const entry = zip.replace({ name: 'tiny', time: 0, date: 0, attributes: 0 }, Buffer.from('ab'));
  assert.equal(entry.method, 0, 'it should be stored, not deflated');
  assert.equal(zip.contents(entry).toString('utf8'), 'ab');
});

test('background.scripts is removed and nothing else about the manifest changes', async () => {
  const { edgeManifest } = await loadPackage();
  const stripped = JSON.parse(edgeManifest(`${JSON.stringify(RELEASED, null, 2)}\n`));

  assert.deepEqual(stripped.background, { service_worker: 'background/background.js' });
  // Everything outside `background` survives untouched.
  const without = (manifest) => {
    const rest = { ...manifest };
    delete rest.background;
    return rest;
  };
  assert.deepEqual(without(stripped), without(RELEASED));
});

test('a manifest with nothing to strip is reported rather than rewritten', async () => {
  const { edgeManifest } = await loadPackage();
  const already = { ...RELEASED, background: { service_worker: 'background/background.js' } };
  assert.equal(edgeManifest(JSON.stringify(already)), null);
});

test('removing the only background key is refused', async () => {
  const { edgeManifest, EdgePackageError } = await loadPackage();
  // Stripping here would ship an extension with no background entry point:
  // the validator accepts it and the product quietly does nothing.
  const firefoxOnly = { ...RELEASED, background: { scripts: ['background/background.js'] } };
  assert.throws(
    () => edgeManifest(JSON.stringify(firefoxOnly)),
    (error) => error instanceof EdgePackageError && /no background\.service_worker/.test(error.message),
  );
});

test('the Edge package differs from the release zip by exactly that one key', async () => {
  const zip = await loadZip();
  const { edgePackage, verifyEdgePackage } = await loadPackage();
  const { buffer: released } = await buildZip();

  const built = edgePackage(released);
  assert.equal(built.changed, true);
  verifyEdgePackage(released, built.buffer);

  const before = zip.read(released);
  const after = zip.read(built.buffer);
  assert.deepEqual(after.map((e) => e.name), before.map((e) => e.name), 'same entries, same order');

  for (let i = 0; i < before.length; i += 1) {
    if (before[i].name === 'manifest.json') continue;
    // Not merely equal once extracted: the compressed bytes are carried over,
    // so an untouched file is the same bytes it was in the released zip.
    assert.ok(
      before[i].compressed.equals(after[i].compressed),
      `${before[i].name} was re-compressed`,
    );
    assert.equal(before[i].crc, after[i].crc, `${before[i].name} CRC changed`);
  }

  const manifest = JSON.parse(
    zip.contents(after.find((e) => e.name === 'manifest.json')).toString('utf8'),
  );
  assert.ok(!Object.hasOwn(manifest.background, 'scripts'));
  assert.equal(manifest.background.service_worker, 'background/background.js');
  assert.equal(manifest.version, '0.7.1');
});

test('an already-valid zip is passed through untouched', async () => {
  const { edgePackage } = await loadPackage();
  const already = { ...RELEASED, background: { service_worker: 'background/background.js' } };
  const { buffer } = await buildZip(already);

  const built = edgePackage(buffer);
  assert.equal(built.changed, false);
  assert.ok(built.buffer.equals(buffer), 'the bytes should be the ones handed in');
});

test('a zip with no manifest is refused', async () => {
  const { edgePackage, EdgePackageError } = await loadPackage();
  const zip = await loadZip();
  const buffer = zip.write([
    zip.replace({ name: 'LICENSE', time: 0, date: 0, attributes: 0 }, Buffer.from('MIT\n')),
  ]);
  assert.throws(() => edgePackage(buffer), EdgePackageError);
});

test('verification catches a package that changed more than the manifest', async () => {
  const zip = await loadZip();
  const { edgePackage, verifyEdgePackage, EdgePackageError } = await loadPackage();
  const { buffer: released } = await buildZip();
  const built = edgePackage(released);

  // A second file altered alongside the manifest.
  const entries = zip.read(built.buffer).map((entry) => (
    entry.name === 'LICENSE' ? zip.replace(entry, Buffer.from('tampered\n')) : entry
  ));
  assert.throws(
    () => verifyEdgePackage(released, zip.write(entries)),
    (error) => error instanceof EdgePackageError && /LICENSE changed/.test(error.message),
  );

  // A manifest changed in some further way.
  const sneaky = zip.read(built.buffer).map((entry) => {
    if (entry.name !== 'manifest.json') return entry;
    const manifest = JSON.parse(zip.contents(entry).toString('utf8'));
    manifest.permissions.push('tabs');
    return zip.replace(entry, Buffer.from(JSON.stringify(manifest, null, 2)));
  });
  assert.throws(
    () => verifyEdgePackage(released, zip.write(sneaky)),
    (error) => error instanceof EdgePackageError && /more than background\.scripts/.test(error.message),
  );

  // A file dropped.
  const short = zip.read(built.buffer).filter((entry) => entry.name !== 'LICENSE');
  assert.throws(
    () => verifyEdgePackage(released, zip.write(short)),
    (error) => error instanceof EdgePackageError && /same entries/.test(error.message),
  );
});

test('not-a-zip is refused rather than read as one', async () => {
  const { read, ZipError } = await loadZip();
  assert.throws(() => read(Buffer.from('this is not a zip at all')), ZipError);
});
