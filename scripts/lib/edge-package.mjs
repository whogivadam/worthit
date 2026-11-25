// Turns the release zip into the one Microsoft Edge Add-ons will accept.
//
// manifest.json carries both background keys so a single manifest serves every
// store:
//
//   "background": {
//     "scripts": ["lib/rates.js", "background/background.js"],
//     "service_worker": "background/background.js"
//   }
//
// Firefox MV3 runs the background as an event page and needs `scripts`; Chrome
// runs a service worker, reads `service_worker` and ignores `scripts`. Edge
// runs the same service worker as Chrome but its package validator refuses the
// pair outright:
//
//   The background.scripts field cannot be used with manifest version 3.
//   Use the background.service_worker field instead.
//
// So Edge gets the released zip with `background.scripts` removed and nothing
// else touched. That is safe because background/background.js loads its own
// dependency when it runs as a worker:
//
//   if (typeof importScripts === 'function') importScripts('/lib/rates.js');
//
// `scripts` exists for AMO alone. Do not "tidy" it out of manifest.json: the
// Firefox build needs it, and only the Edge upload may differ.

import * as zip from './zip.mjs';

export const STRIPPED = 'background.scripts';

export class EdgePackageError extends Error {}

/**
 * The manifest Edge accepts, as text. Returns null when there is nothing to
 * strip, so a caller can tell "already valid" from "changed".
 */
export function edgeManifest(text) {
  const manifest = JSON.parse(text);
  const background = manifest.background;

  if (!background || !Object.hasOwn(background, 'scripts')) return null;

  // Removing the only background key would ship an extension with no
  // background at all, which the validator accepts and the product breaks on.
  if (!background.service_worker) {
    throw new EdgePackageError(
      `refusing to remove ${STRIPPED}: the manifest has no background.service_worker, `
      + 'so it would be left with no background entry point at all',
    );
  }

  delete background.scripts;
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * The Edge package, from the bytes of a release zip. Every entry but
 * manifest.json is re-emitted with its compressed bytes untouched.
 */
export function edgePackage(buffer) {
  const entries = zip.read(buffer);
  const manifest = entries.find((entry) => entry.name === 'manifest.json');
  if (!manifest) throw new EdgePackageError('the zip holds no manifest.json');

  const text = zip.contents(manifest).toString('utf8');
  const stripped = edgeManifest(text);
  if (stripped === null) {
    return { buffer, changed: false, manifest: text };
  }

  const rewritten = entries.map(
    (entry) => (entry === manifest ? zip.replace(entry, Buffer.from(stripped, 'utf8')) : entry),
  );
  return { buffer: zip.write(rewritten), changed: true, manifest: stripped };
}

/**
 * Checks an Edge package against the zip it came from: same entries, same
 * contents everywhere but the manifest, and the manifest changed in exactly
 * one way. Cheap enough to run every time, and it is the only thing standing
 * between a bug here and a rejected or broken submission.
 */
export function verifyEdgePackage(source, built) {
  const before = zip.read(source);
  const after = zip.read(built);

  const names = (entries) => entries.map((entry) => entry.name).join('\n');
  if (names(before) !== names(after)) {
    throw new EdgePackageError('the Edge package does not hold the same entries as the release zip');
  }

  for (let i = 0; i < before.length; i += 1) {
    if (before[i].name === 'manifest.json') continue;
    if (!zip.contents(before[i]).equals(zip.contents(after[i]))) {
      throw new EdgePackageError(`${before[i].name} changed; only manifest.json may differ`);
    }
  }

  const original = JSON.parse(zip.contents(before.find((e) => e.name === 'manifest.json')).toString('utf8'));
  const result = JSON.parse(zip.contents(after.find((e) => e.name === 'manifest.json')).toString('utf8'));

  if (Object.hasOwn(result.background || {}, 'scripts')) {
    throw new EdgePackageError(`${STRIPPED} is still present`);
  }
  if (!result.background?.service_worker) {
    throw new EdgePackageError('the Edge package has no background.service_worker');
  }

  delete original.background.scripts;
  if (JSON.stringify(original) !== JSON.stringify(result)) {
    throw new EdgePackageError(`the manifest changed by more than ${STRIPPED}`);
  }
}
