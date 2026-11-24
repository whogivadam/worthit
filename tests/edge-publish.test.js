'use strict';

// Drives scripts/edge-publish.mjs against a fake Edge Add-ons API. No network:
// fetch, sleep and the file read all come in through the script's `io` argument.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const load = () => import('../scripts/edge-publish.mjs');

const credentials = { productId: 'prod-guid', clientId: 'client-id', apiKey: 'secret-key' };

/** A Response stand-in with only what the script reads. */
function reply(status, { json, text = '', location } = {}) {
  return {
    status,
    headers: { get: (name) => (name.toLowerCase() === 'location' ? location ?? null : null) },
    json: async () => json,
    text: async () => (json ? JSON.stringify(json) : text),
  };
}

/** A fake fetch that answers from a queue and records every call. */
function fakeApi(answers) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body });
    const next = answers.shift();
    assert.ok(next, `unexpected request: ${init.method || 'GET'} ${url}`);
    return next;
  };
  return { fetch, calls };
}

const io = (fetch) => ({
  fetch,
  sleep: async () => {},
  log: () => {},
  readFile: () => Buffer.from('zip-bytes'),
  attempts: 3,
  interval: 1,
});

const settled = (status, extra = {}) => reply(200, { json: { status, ...extra } });

test('uploads, waits, submits and waits, with the v1.1 headers on every call', async () => {
  const { publish, API } = await load();
  const { fetch, calls } = fakeApi([
    reply(202, { location: 'upload-op' }),
    settled('InProgress'),
    settled('Succeeded', { message: 'Successfully updated package' }),
    reply(202, { location: 'publish-op' }),
    settled('Succeeded', { message: 'Successfully created submission' }),
  ]);

  const result = await publish('web-ext-artifacts/worth_it-1.0.0.zip', credentials, io(fetch));
  assert.equal(result.status, 'Succeeded');

  const base = `${API}/v1/products/prod-guid/submissions`;
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.url}`),
    [
      `POST ${base}/draft/package`,
      `GET ${base}/draft/package/operations/upload-op`,
      `GET ${base}/draft/package/operations/upload-op`,
      `POST ${base}`,
      `GET ${base}/operations/publish-op`,
    ],
  );
  for (const call of calls) {
    assert.equal(call.headers.Authorization, 'ApiKey secret-key');
    assert.equal(call.headers['X-ClientID'], 'client-id');
  }
  assert.equal(calls[0].headers['Content-Type'], 'application/zip');
  assert.equal(String(calls[0].body), 'zip-bytes');
  assert.ok(JSON.parse(calls[3].body).notes, 'the submission carries certification notes');
});

test('takes the operation ID from a Location header that is a full URL', async () => {
  const { operationIdFrom } = await load();
  assert.equal(operationIdFrom('abc-123'), 'abc-123');
  assert.equal(
    operationIdFrom('https://api.addons.microsoftedge.microsoft.com/v1/products/p/submissions/operations/abc-123/'),
    'abc-123',
  );
  assert.throws(() => operationIdFrom(null), /no operation ID/);
});

test('an expired API key says how to renew it', async () => {
  const { publish } = await load();
  const { fetch } = fakeApi([reply(401, { text: 'Unauthorized' })]);
  await assert.rejects(
    publish('x.zip', credentials, io(fetch)),
    (error) => /expired/.test(error.message) && /gh secret set EDGE_API_KEY/.test(error.message),
  );
});

test('a wrong product ID is named as such', async () => {
  const { publish } = await load();
  const { fetch } = fakeApi([reply(404)]);
  await assert.rejects(publish('x.zip', credentials, io(fetch)), /EDGE_PRODUCT_ID is wrong/);
});

test('a version still in review is explained, and nothing is retried', async () => {
  const { publish } = await load();
  const { fetch, calls } = fakeApi([
    reply(202, { location: 'u' }),
    settled('Succeeded'),
    reply(202, { location: 'p' }),
    settled('Failed', { errorCode: 'InProgressSubmission', message: 'raw store text' }),
  ]);
  await assert.rejects(
    publish('x.zip', credentials, io(fetch)),
    /publish failed \(InProgressSubmission\): a previous version is still in review/,
  );
  assert.equal(calls.length, 4);
});

test('a failed upload stops before submitting and lists the store errors', async () => {
  const { publish } = await load();
  const { fetch, calls } = fakeApi([
    reply(202, { location: 'u' }),
    settled('Failed', { errorCode: 'BadPackage', message: 'Package invalid', errors: ['manifest.json: bad key'] }),
  ]);
  await assert.rejects(
    publish('x.zip', credentials, io(fetch)),
    (error) => /upload failed \(BadPackage\): Package invalid/.test(error.message)
      && /manifest\.json: bad key/.test(error.message),
  );
  assert.equal(calls.length, 2, 'no publish call after a failed upload');
});

test('polling gives up after the configured attempts', async () => {
  const { publish } = await load();
  const { fetch } = fakeApi([
    reply(202, { location: 'u' }),
    settled('InProgress'),
    settled('InProgress'),
    settled('InProgress'),
  ]);
  await assert.rejects(publish('x.zip', credentials, io(fetch)), /upload: still in progress/);
});

test('missing credentials are all named at once', async () => {
  const { readCredentials } = await load();
  assert.throws(
    () => readCredentials({ EDGE_PRODUCT_ID: 'p', EDGE_API_KEY: ' ' }),
    /missing EDGE_CLIENT_ID, EDGE_API_KEY/,
  );
  assert.deepEqual(
    readCredentials({ EDGE_PRODUCT_ID: ' p ', EDGE_CLIENT_ID: 'c', EDGE_API_KEY: 'k' }),
    { productId: 'p', clientId: 'c', apiKey: 'k' },
  );
});

test('exactly one zip is uploaded', async (t) => {
  const { pickZip } = await load();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-publish-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const one = path.join(dir, 'worth_it-1.0.0.zip');
  const two = path.join(dir, 'worth_it-1.0.1.zip');
  fs.writeFileSync(one, '');

  // An unmatched glob reaches the script as the literal pattern.
  assert.throws(() => pickZip([path.join(dir, '*.zip.none')]), /no zip to upload/);
  assert.equal(pickZip([one]), one);

  fs.writeFileSync(two, '');
  assert.throws(() => pickZip([one, two]), /expected one zip, found 2/);
});

test('both release paths submit to Edge with the three EDGE_* secrets, without blocking', () => {
  const workflow = fs.readFileSync(
    path.join(__dirname, '..', '.github/workflows/release-please.yml'),
    'utf8',
  );
  const steps = workflow.split('- name: Submit to Microsoft Edge Add-ons').slice(1);
  assert.equal(steps.length, 2, 'one Edge step in the release job, one in resubmit');
  for (const step of steps) {
    const body = step.split('- name:')[0];
    assert.match(body, /continue-on-error: true/);
    assert.match(body, /run: npm run publish:edge/);
    for (const name of ['EDGE_PRODUCT_ID', 'EDGE_CLIENT_ID', 'EDGE_API_KEY']) {
      assert.ok(body.includes(`${name}: \${{ secrets.${name} }}`), `${name} must come from its secret`);
    }
  }
});
