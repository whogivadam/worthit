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
// It downloads rather than builds; lib/release-zip.mjs says why. Chrome takes
// the released zip as it is -- unlike Edge, which rejects it over a manifest
// key and so has its own script. See edge-zip.mjs.

import fs from 'node:fs';
import { checkZip, fetchReleaseZip } from './lib/release-zip.mjs';

const TOOL = 'chrome-zip';
const CONSOLE_URL = 'https://chrome.google.com/webstore/devconsole/';

const { tag, file } = fetchReleaseZip(TOOL, process.argv[2]);

checkZip(file);

const size = fs.statSync(file).size;
console.error(
  [
    '',
    `${TOOL}: ${file} (${size} bytes), built by CI from ${tag}`,
    `            upload it at ${CONSOLE_URL}`,
  ].join('\n'),
);
