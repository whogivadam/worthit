// Fetching the zip a tag's GitHub Release carries.
//
// Shared by chrome-zip.mjs and edge-zip.mjs, which both exist because a store
// submission routinely has to be finished by hand.
//
// It downloads rather than builds, deliberately. The zip to upload is the one
// attached to the tag's GitHub Release -- the exact bytes CI built and sent to
// the stores. A local `npm run build` is a different artifact, and while a
// release pull request is held it is a misleading one: `main` runs ahead of the
// tag but manifest.json still carries the released version, so the zip comes
// out named for the old version carrying the next one's code.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import * as zip from './zip.mjs';

export const ARTIFACTS = 'web-ext-artifacts';

/** Prints a message the way these scripts do, and stops. */
export function fail(tool, message, detail) {
  console.error(`${tool}: ${message}`);
  if (detail) console.error(`\n${String(detail).trim()}`);
  process.exit(1);
}

/** Runs gh, turning its two usual failures into something readable. */
export function gh(tool, args) {
  try {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    if (error.code === 'ENOENT') {
      fail(tool, 'the GitHub CLI is not installed -- see https://cli.github.com');
    }
    const stderr = String(error.stderr || '');
    if (/gh auth login|authentication/i.test(stderr)) {
      fail(tool, 'the GitHub CLI is not logged in -- run `gh auth login`', stderr);
    }
    fail(tool, `gh ${args.join(' ')} failed`, stderr || error.message);
    return '';
  }
}

/** One file's contents out of a zip on disk. */
export function readFromZip(tool, file, wanted) {
  const entries = zip.read(fs.readFileSync(file));
  const entry = entries.find((one) => one.name === wanted);
  if (!entry) return fail(tool, `${file} holds no ${wanted}`);
  return zip.contents(entry).toString('utf8');
}

/**
 * Downloads the zip attached to a release and checks it carries the version its
 * tag names. `requested` is a tag, or undefined for the latest release.
 */
export function fetchReleaseZip(tool, requested) {
  const release = JSON.parse(
    gh(tool, ['release', 'view', ...(requested ? [requested] : []), '--json', 'tagName,assets']),
  );
  const tag = release.tagName;
  // An Edge package built earlier and uploaded to the release would also end in
  // .zip, so take the one web-ext produced rather than the first match.
  const assets = (release.assets || []).filter((one) => one.name.endsWith('.zip'));
  const asset = assets.find((one) => !one.name.includes('-edge')) || assets[0];
  if (!asset) fail(tool, `the ${tag} release has no zip attached`);

  fs.mkdirSync(ARTIFACTS, { recursive: true });
  gh(tool, ['release', 'download', tag, '--pattern', asset.name, '--dir', ARTIFACTS, '--clobber']);

  const file = path.join(ARTIFACTS, asset.name);
  const { version } = JSON.parse(readFromZip(tool, file, 'manifest.json'));
  if (tag !== `v${version}`) {
    fail(tool, `${asset.name} carries version ${version}, which is not ${tag}`);
  }

  return { tag, file, version };
}

/** The same guard the release runs, so a zip is never uploaded unexamined. */
export function checkZip(file) {
  execFileSync(process.execPath, ['scripts/check-zip.mjs', file], { stdio: 'inherit' });
}
