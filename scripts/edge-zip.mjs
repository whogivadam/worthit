// Builds the zip to upload to Microsoft Edge Add-ons by hand.
//
//   npm run edge:zip          the latest release
//   npm run edge:zip v0.7.1   a named tag
//
// The Chrome counterpart just downloads; Edge needs one key removed from the
// manifest first, because its package validator refuses a manifest that has
// both background.scripts and background.service_worker. lib/edge-package.mjs
// explains why the repo's manifest carries both.
//
// The automated submission does the same thing through the same module, so this
// is the by-hand route to the same artifact, for when that submission fails --
// an expired API key, or a previous version still in review.
//
// It downloads rather than builds; lib/release-zip.mjs says why.

import fs from 'node:fs';
import path from 'node:path';
import { edgePackage, verifyEdgePackage } from './lib/edge-package.mjs';
import {
  ARTIFACTS, checkZip, fail, fetchReleaseZip,
} from './lib/release-zip.mjs';

const TOOL = 'edge-zip';
const PARTNER_CENTER = 'https://partner.microsoft.com/dashboard/microsoftedge/';

const { tag, file, version } = fetchReleaseZip(TOOL, process.argv[2]);

checkZip(file);

const source = fs.readFileSync(file);
let built;
try {
  built = edgePackage(source);
} catch (error) {
  fail(TOOL, error.message);
}

const target = path.join(ARTIFACTS, `worth_it_-${version}-edge.zip`);

if (!built.changed) {
  // Nothing to do means the released manifest no longer carries the key, which
  // is a change worth noticing rather than a success worth reporting quietly.
  fail(
    TOOL,
    `${path.basename(file)} has no background.scripts to remove -- the released manifest `
    + 'has changed, so check whether Edge still needs a package of its own',
  );
}

verifyEdgePackage(source, built.buffer);
fs.writeFileSync(target, built.buffer);
checkZip(target);

console.error(
  [
    '',
    `${TOOL}: ${target} (${fs.statSync(target).size} bytes), from the ${tag} release zip`,
    '          with background.scripts removed and nothing else changed',
    `          upload it at ${PARTNER_CENTER}`,
  ].join('\n'),
);
