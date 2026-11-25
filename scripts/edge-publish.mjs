// Submits the release zip to Microsoft Edge Add-ons for review.
//
//   npm run publish:edge          uploads web-ext-artifacts/*.zip
//
// What it uploads is that zip with background.scripts removed, which Edge
// requires and the other stores do not -- see lib/edge-package.mjs. The zip
// attached to the GitHub Release, and the one AMO signs, are untouched.
//
// Uses v1.1 of the Edge Add-ons REST API, which authenticates with an API key
// and a client ID from Partner Center -> Microsoft Edge -> Publish API:
//
//   EDGE_PRODUCT_ID   the product ID (a GUID), from the extension's Overview
//                     page -- not the store ID in the public listing URL
//   EDGE_CLIENT_ID    the Publish API client ID
//   EDGE_API_KEY      the Publish API key, which expires; see docs/edge/README.md
//
// Four calls, two of them polled:
//
//   POST /v1/products/{product}/submissions/draft/package     upload the zip
//   GET  .../draft/package/operations/{operation}             until it settles
//   POST /v1/products/{product}/submissions                   submit for review
//   GET  .../submissions/operations/{operation}               until it settles
//
// Like the AMO and Chrome steps, this returns once the store has accepted the
// submission. Certification is asynchronous and arrives by email, so there is
// deliberately nothing to wait for after that.
//
// No dependency: one zip, four requests, Node's own fetch.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { EdgePackageError, edgePackage, verifyEdgePackage } from './lib/edge-package.mjs';

export const API = 'https://api.addons.microsoftedge.microsoft.com';
export const PARTNER_CENTER = 'https://partner.microsoft.com/dashboard/microsoftedge/';

const NOTES = 'Automated submission from the Worth It? release workflow. Source: '
  + 'https://github.com/whogivadam/worthit';

/** The publish-status error codes worth explaining in plain words. */
const EXPLAINED = {
  InProgressSubmission:
    'a previous version is still in review; the store will not publish over it. '
    + 'Submit again once it clears.',
  NoModulesUpdated:
    'the uploaded package is identical to the one already submitted.',
  UnpublishInProgress: 'the extension is being unpublished.',
  CreateNotAllowed:
    'the product does not exist yet -- the first submission has to be made by hand in Partner Center.',
};

export class EdgeError extends Error {}

/** Both EDGE_PRODUCT_ID and EDGE_CLIENT_ID are GUIDs from Partner Center. */
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads the three credentials, naming every missing one at once. */
export function readCredentials(env) {
  const names = ['EDGE_PRODUCT_ID', 'EDGE_CLIENT_ID', 'EDGE_API_KEY'];
  const missing = names.filter((name) => !env[name] || !env[name].trim());
  if (missing.length > 0) {
    throw new EdgeError(`missing ${missing.join(', ')} -- see docs/edge/README.md`);
  }
  const credentials = {
    productId: env.EDGE_PRODUCT_ID.trim(),
    clientId: env.EDGE_CLIENT_ID.trim(),
    apiKey: env.EDGE_API_KEY.trim(),
  };

  // Both IDs are GUIDs, and the API rejects a malformed one with a 400 that
  // names only the header it arrived in. Checking here costs nothing and says
  // which secret is wrong, instead of spending a release's upload to find out.
  const guids = [
    ['EDGE_PRODUCT_ID', credentials.productId, "the extension's Overview page"],
    ['EDGE_CLIENT_ID', credentials.clientId, 'Publish API'],
  ];
  for (const [name, value, where] of guids) {
    if (!GUID.test(value)) {
      throw new EdgeError(
        `${name} is not a GUID -- copy it again from ${where} at ${PARTNER_CENTER} `
        + 'and see docs/edge/README.md',
      );
    }
  }

  return credentials;
}

/**
 * The operation ID from a 202's Location header. The docs show a bare ID; take
 * the last path segment so a full URL works too.
 */
export function operationIdFrom(location) {
  const id = String(location || '').trim().replace(/\/+$/, '').split('/').pop();
  if (!id) throw new EdgeError('the store accepted the request but returned no operation ID');
  return id;
}

/** Turns an HTTP failure into a sentence that says what to do about it. */
function httpFailure(step, response, body) {
  const detail = body ? `\n${body.trim()}` : '';
  if (response.status === 401 || response.status === 403) {
    return new EdgeError(
      `${step}: ${response.status} -- the API key is missing, expired or invalid. `
      + `Create a new key under Publish API at ${PARTNER_CENTER} and run `
      + '`gh secret set EDGE_API_KEY --repo whogivadam/worthit`.' + detail,
    );
  }
  if (response.status === 400) {
    return new EdgeError(
      `${step}: 400 -- the store rejected the request itself, not the credentials. `
      + 'If it names X-ClientID, EDGE_CLIENT_ID is not a GUID; if it lists package '
      + 'validation errors, the zip is wrong for Edge -- see docs/edge/README.md.' + detail,
    );
  }
  if (response.status === 404) {
    return new EdgeError(
      `${step}: 404 -- EDGE_PRODUCT_ID is wrong, or does not belong to this client ID. `
      + 'It is the GUID on the extension\'s Overview page in Partner Center.' + detail,
    );
  }
  return new EdgeError(`${step}: HTTP ${response.status}${detail}`);
}

/** Explains a settled operation that did not succeed. */
function operationFailure(step, operation) {
  const code = operation.errorCode || '';
  const reason = EXPLAINED[code] || operation.message || 'no reason given';
  const errors = Array.isArray(operation.errors) && operation.errors.length > 0
    ? `\n${operation.errors.map((e) => `  - ${typeof e === 'string' ? e : e.message || JSON.stringify(e)}`).join('\n')}`
    : '';
  return new EdgeError(`${step} failed${code ? ` (${code})` : ''}: ${reason}${errors}`);
}

/**
 * Uploads and submits one zip. Everything with a side effect comes in through
 * `io`, so the tests drive it without a network.
 */
export async function publish(zipPath, credentials, io = {}) {
  const {
    fetch: request = globalThis.fetch,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log = (line) => console.error(line),
    readFile = (file) => fs.readFileSync(file),
    interval = 5000,
    attempts = 60,
  } = io;
  const { productId, clientId, apiKey } = credentials;
  const base = `${API}/v1/products/${encodeURIComponent(productId)}/submissions`;
  const auth = { Authorization: `ApiKey ${apiKey}`, 'X-ClientID': clientId };

  async function start(step, url, init) {
    const response = await request(url, { method: 'POST', ...init, headers: { ...auth, ...init.headers } });
    if (response.status !== 202) throw httpFailure(step, response, await response.text());
    return operationIdFrom(response.headers.get('location'));
  }

  async function settle(step, url) {
    for (let i = 0; i < attempts; i += 1) {
      const response = await request(url, { headers: auth });
      if (response.status !== 200 && response.status !== 202) {
        throw httpFailure(step, response, await response.text());
      }
      const operation = await response.json();
      if (operation.status === 'Succeeded') return operation;
      if (operation.status === 'Failed') throw operationFailure(step, operation);
      await sleep(interval);
    }
    throw new EdgeError(
      `${step}: still in progress after ${(attempts * interval) / 1000}s. `
      + `Check the extension in Partner Center at ${PARTNER_CENTER}.`,
    );
  }

  // Edge will not take the zip the other stores get: its validator refuses a
  // manifest carrying both background keys. lib/edge-package.mjs removes the
  // one it objects to, and nothing else, then checks its own work. The same
  // module backs `npm run edge:zip`, so the by-hand route cannot drift from
  // this one.
  const released = readFile(zipPath);
  const built = edgePackage(released);
  if (built.changed) {
    verifyEdgePackage(released, built.buffer);
    log(`edge-publish: removed background.scripts for Edge (${built.buffer.length} bytes)`);
  } else {
    log('edge-publish: the manifest has no background.scripts; uploading as released');
  }

  log(`edge-publish: uploading ${path.basename(zipPath)}`);
  const upload = await start('upload', `${base}/draft/package`, {
    headers: { 'Content-Type': 'application/zip' },
    body: built.buffer,
  });
  const uploaded = await settle('upload', `${base}/draft/package/operations/${upload}`);
  log(`edge-publish: ${uploaded.message || 'package uploaded'}`);

  log('edge-publish: submitting for review');
  const submission = await start('publish', base, {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ notes: NOTES }),
  });
  const published = await settle('publish', `${base}/operations/${submission}`);
  log(`edge-publish: ${published.message || 'submitted'}`);
  log('edge-publish: certification is asynchronous; the result arrives by email');
  return published;
}

/** The one zip to upload, from the arguments the npm script's glob expanded to. */
export function pickZip(args) {
  const zips = args.filter((arg) => arg.endsWith('.zip') && fs.existsSync(arg));
  if (zips.length !== 1) {
    throw new EdgeError(
      zips.length === 0
        ? 'no zip to upload -- run `npm run build` first'
        : `expected one zip, found ${zips.length}: ${zips.join(', ')}`,
    );
  }
  return zips[0];
}

async function main() {
  try {
    const zip = pickZip(process.argv.slice(2));
    await publish(zip, readCredentials(process.env));
  } catch (error) {
    // EdgePackageError says what is wrong with the zip; EdgeError what is wrong
    // with the store or the secrets. Either is a diagnosis, not a crash.
    const diagnosed = error instanceof EdgeError || error instanceof EdgePackageError;
    console.error(`edge-publish: ${diagnosed ? error.message : error.stack}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
