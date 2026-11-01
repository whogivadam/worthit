// Fetches the zip to upload to the Chrome Web Store by hand.
//
// The Chrome step of the Release workflow succeeds only inside the 7-day life
// of the refresh token, and fails outright while the previous version is still
// in review, so a hand upload is a routine part of releasing rather than an
// exception. This makes the artifact for it one command.
//
//   npm run chrome:zip          the latest release
//   npm run chrome:zip v0.4.0   a named tag
//
// It downloads rather than builds, deliberately. The zip to upload is the one
// attached to the tag's GitHub release -- the exact bytes CI built and sent to
// both stores. A local `npm run build` is a different artifact, and while a
// release pull request is held it is a misleading one: `main` runs ahead of the
// tag but manifest.json still carries the released version, so the zip comes
// out named for the old version carrying the next one's code.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ARTIFACTS = 'web-ext-artifacts';
const CONSOLE_URL = 'https://chrome.google.com/webstore/devconsole/';

function fail(message, detail) {
  console.error(`chrome-zip: ${message}`);
  if (detail) console.error(`\n${String(detail).trim()}`);
  process.exit(1);
}

/** Runs gh, turning its two usual failures into something readable. */
function gh(args) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    if (error.code === 'ENOENT') {
      fail('the GitHub CLI is not installed -- see https://cli.github.com');
    }
    const stderr = String(error.stderr || '');
    if (/gh auth login|authentication/i.test(stderr)) {
      fail('the GitHub CLI is not logged in -- run `gh auth login`', stderr);
    }
    fail(`gh ${args.join(' ')} failed`, stderr || error.message);
    return '';
  }
}

/** One file's contents out of a zip, read through the central directory. */
function readFromZip(file, wanted) {
  const buffer = fs.readFileSync(file);

  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end -= 1;
  if (end < 0) fail(`${file} is not a zip`);

  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);

  for (let i = 0; i < count; i += 1) {
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    if (name === wanted) {
      const local = buffer.readUInt32LE(offset + 42);
      const method = buffer.readUInt16LE(local + 8);
      const compressedSize = buffer.readUInt32LE(offset + 20);
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      const data = buffer.subarray(start, start + compressedSize);
      return method === 0 ? data.toString('utf8') : zlib.inflateRawSync(data).toString('utf8');
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return fail(`${file} holds no ${wanted}`);
}

const requested = process.argv[2];

const release = JSON.parse(
  gh(['release', 'view', ...(requested ? [requested] : []), '--json', 'tagName,assets']),
);
const tag = release.tagName;
const asset = (release.assets || []).find((one) => one.name.endsWith('.zip'));
if (!asset) fail(`the ${tag} release has no zip attached`);

fs.mkdirSync(ARTIFACTS, { recursive: true });
gh(['release', 'download', tag, '--pattern', asset.name, '--dir', ARTIFACTS, '--clobber']);

const file = path.join(ARTIFACTS, asset.name);
const version = JSON.parse(readFromZip(file, 'manifest.json')).version;
if (tag !== `v${version}`) {
  fail(`${asset.name} carries version ${version}, which is not ${tag}`);
}

// The same guard the release runs, so a zip is never uploaded unexamined.
execFileSync(process.execPath, ['scripts/check-zip.mjs', file], { stdio: 'inherit' });

const size = fs.statSync(file).size;
console.error(
  [
    '',
    `chrome-zip: ${file} (${size} bytes), built by CI from ${tag}`,
    `            upload it at ${CONSOLE_URL}`,
  ].join('\n'),
);
