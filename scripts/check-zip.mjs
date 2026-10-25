// Verifies that the built zip contains only runtime code.
//
// web-ext's ignoreFiles decides what goes in; this asserts the result, so a new
// directory or a stray config file cannot reach AMO unnoticed. Reads the zip's
// central directory directly rather than shelling out to `unzip` or adding a
// dependency.

import fs from 'node:fs';
import path from 'node:path';

const ARTIFACTS = 'web-ext-artifacts';

const ALLOWED_FILES = new Set(['manifest.json', 'LICENSE']);
const ALLOWED_DIRECTORIES = [
  'icons/',
  'background/',
  'popup/',
  'content/',
  'lib/',
  '_locales/',
];
// Every locale the manifest's __MSG_*__ placeholders can resolve against. A
// missing default_locale file makes the extension fail to load outright, so it
// is required rather than merely allowed.
const REQUIRED = [
  'manifest.json',
  'LICENSE',
  'lib/rates-snapshot.json',
  '_locales/en/messages.json',
  '_locales/sv/messages.json',
];

/** Entry names from a zip's central directory. */
function readZipEntries(file) {
  const buffer = fs.readFileSync(file);

  // End of central directory record, scanned from the back.
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error(`${file} is not a zip archive`);

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const names = [];

  for (let i = 0; i < entryCount; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`${file}: corrupt central directory at entry ${i}`);
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    names.push(buffer.toString('utf8', offset + 46, offset + 46 + nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return names;
}

function newestZip() {
  if (!fs.existsSync(ARTIFACTS)) {
    throw new Error(`${ARTIFACTS}/ does not exist -- run \`npm run build\` first`);
  }
  const zips = fs
    .readdirSync(ARTIFACTS)
    .filter((name) => name.endsWith('.zip'))
    .map((name) => {
      const file = path.join(ARTIFACTS, name);
      return { file, mtime: fs.statSync(file).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);

  if (!zips.length) throw new Error(`no zip in ${ARTIFACTS}/ -- run \`npm run build\` first`);
  return zips[0].file;
}

function isAllowed(name) {
  if (name.endsWith('/')) {
    return ALLOWED_DIRECTORIES.some((dir) => name === dir || name.startsWith(dir));
  }
  if (ALLOWED_FILES.has(name)) return true;
  return ALLOWED_DIRECTORIES.some((dir) => name.startsWith(dir));
}

const zip = newestZip();
const entries = readZipEntries(zip);
const files = entries.filter((name) => !name.endsWith('/'));

const unexpected = entries.filter((name) => !isAllowed(name));
const missing = REQUIRED.filter((name) => !files.includes(name));

// Every shipped icon has to be one the manifest actually references. The 128px
// icon belongs to the AMO listing page, not to the extension, and an unused
// asset in the zip is dead weight a reviewer has to ask about.
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const referenced = new Set([
  ...Object.values(manifest.icons || {}),
  ...Object.values((manifest.action && manifest.action.default_icon) || {}),
]);
const strayIcons = files.filter((name) => name.startsWith('icons/') && !referenced.has(name));
strayIcons.forEach((name) => unexpected.push(name + ' (not referenced by manifest.json)'));

if (unexpected.length || missing.length) {
  console.error(`check-zip: ${zip} is not shippable\n`);
  if (unexpected.length) {
    console.error('  must not be in the zip:');
    unexpected.forEach((name) => console.error(`    ${name}`));
  }
  if (missing.length) {
    console.error('  missing from the zip:');
    missing.forEach((name) => console.error(`    ${name}`));
  }
  console.error('\n  allowed: manifest.json, LICENSE, and icons/ background/ popup/ content/ lib/');
  process.exit(1);
}

console.error(`check-zip: ${zip} holds ${files.length} runtime files and nothing else`);
files.sort().forEach((name) => console.error(`    ${name}`));
