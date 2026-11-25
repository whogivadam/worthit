'use strict';

// Drives scripts/edge-publish.mjs against a fake Edge Add-ons API. No network:
// fetch, sleep and the file read all come in through the script's `io` argument.

const test = require('node:test');
const { before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const load = () => import('../scripts/edge-publish.mjs');

// `publish` derives the Edge package from the zip it is given, so the fake
// readFile has to hand back a real one. Shaped like the released zip: both
// background keys, which Edge refuses and the module strips.
const RELEASED_MANIFEST = {
  manifest_version: 3,
  version: '0.7.1',
  background: {
    scripts: ['lib/rates.js', 'background/background.js'],
    service_worker: 'background/background.js',
  },
};

let released;

before(async () => {
  const zip = await import('../scripts/lib/zip.mjs');
  const files = {
    'manifest.json': `${JSON.stringify(RELEASED_MANIFEST, null, 2)}\n`,
    'background/background.js': 'self.x = 1;\n',
    LICENSE: 'MIT\n',
  };
  released = zip.write(Object.entries(files).map(([name, text]) => zip.replace(
    { name, time: 0x6000, date: 0x5900, attributes: 0x81a40000 },
    Buffer.from(text, 'utf8'),
  )));
});

const product = '8f3b2c1a-0000-4000-8000-000000000001';
const client = '8f3b2c1a-0000-4000-8000-000000000002';

const credentials = { productId: product, clientId: client, apiKey: 'secret-key' };

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
  readFile: () => released,
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

  const base = `${API}/v1/products/${product}/submissions`;
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
    assert.equal(call.headers['X-ClientID'], client);
  }
  assert.equal(calls[0].headers['Content-Type'], 'application/zip');
  assert.ok(JSON.parse(calls[3].body).notes, 'the submission carries certification notes');
});

test('what reaches the store is the package Edge accepts, not the released zip', async () => {
  // The v0.7.1 failure behind this: the upload body used to be the release zip
  // verbatim, which Edge's validator refuses over background.scripts. Asserting
  // the bytes were sent is not enough -- this reads the manifest back out.
  const zip = await import('../scripts/lib/zip.mjs');
  const { publish } = await load();
  const { fetch, calls } = fakeApi([
    reply(202, { location: 'upload-op' }),
    settled('Succeeded'),
    reply(202, { location: 'publish-op' }),
    settled('Succeeded'),
  ]);
  await publish('x.zip', credentials, io(fetch));

  const uploaded = Buffer.from(calls[0].body);
  assert.notEqual(uploaded.length, released.length, 'the uploaded package should differ');

  const entries = zip.read(uploaded);
  const manifest = JSON.parse(
    zip.contents(entries.find((e) => e.name === 'manifest.json')).toString('utf8'),
  );
  assert.ok(!Object.hasOwn(manifest.background, 'scripts'), 'background.scripts must be gone');
  assert.equal(manifest.background.service_worker, 'background/background.js');
  assert.equal(manifest.version, '0.7.1');

  // And the rest of the package is the release, untouched.
  assert.deepEqual(
    entries.map((e) => e.name),
    zip.read(released).map((e) => e.name),
  );
  assert.equal(
    zip.contents(entries.find((e) => e.name === 'LICENSE')).toString('utf8'),
    'MIT\n',
  );
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
    readCredentials({
      EDGE_PRODUCT_ID: `  ${product}  `,
      EDGE_CLIENT_ID: client,
      EDGE_API_KEY: '  k  ',
    }),
    { productId: product, clientId: client, apiKey: 'k' },
  );
});

test('a client ID or product ID that is not a GUID is refused before any request', async () => {
  // The v0.7.1 release failed here: EDGE_CLIENT_ID was not a GUID, and the
  // store said so with a 400 naming only the header. Catching it locally names
  // the secret instead, and costs no upload to find out.
  const { readCredentials } = await load();
  assert.throws(
    () => readCredentials({ EDGE_PRODUCT_ID: product, EDGE_CLIENT_ID: 'not-a-guid', EDGE_API_KEY: 'k' }),
    /EDGE_CLIENT_ID is not a GUID.*Publish API/s,
  );
  assert.throws(
    () => readCredentials({ EDGE_PRODUCT_ID: 'mmjliacc', EDGE_CLIENT_ID: client, EDGE_API_KEY: 'k' }),
    /EDGE_PRODUCT_ID is not a GUID.*Overview/s,
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
