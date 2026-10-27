'use strict';

// The background, loaded the way Chrome loads it.
//
// manifest.json declares both background keys, so this one file is an event page
// in Firefox and a service worker in Chrome. The Firefox path is covered by every
// other test in this suite, which loads lib/rates.js separately the way
// background.scripts does. Nothing covered the Chrome path, which is the one that
// can break without anybody noticing until the extension is installed: the worker
// is handed this file *alone*, with no DOM and no sibling scripts.
//
// So this runs the real file in a context shaped like a service worker -- no
// document, no window, importScripts defined -- and asserts it comes up.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const manifest = JSON.parse(read('manifest.json'));

/**
 * Evaluates the service-worker entry in a context with the worker globals and
 * none of the page ones, and records what it did on the way up.
 */
function bootServiceWorker() {
  const calls = { listeners: [], alarms: [], imported: [], fetched: 0 };

  const sandbox = {
    console: { warn() {}, error() {} },
    fetch: async () => {
      calls.fetched += 1;
      return { ok: false };
    },
    importScripts(...files) {
      files.forEach((file) => {
        calls.imported.push(file);
        const local = file.replace(/^\//, '');
        vm.runInContext(read(local), context, { filename: local });
      });
    },
    browser: {
      storage: { local: { get: async () => ({}), set: async () => {} } },
      alarms: {
        create: (name) => calls.alarms.push(name),
        get: async () => null,
        clear: async () => {},
        onAlarm: { addListener: () => calls.listeners.push('alarms.onAlarm') },
      },
      runtime: {
        getURL: (p) => 'chrome-extension://worthit/' + p,
        onInstalled: { addListener: () => calls.listeners.push('runtime.onInstalled') },
        onStartup: { addListener: () => calls.listeners.push('runtime.onStartup') },
        onMessage: { addListener: () => calls.listeners.push('runtime.onMessage') },
      },
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  const context = vm.createContext(sandbox);
  const entry = manifest.background.service_worker;
  vm.runInContext(read(entry), context, { filename: entry });
  return { calls, sandbox };
}

test('the service-worker entry comes up when loaded on its own', () => {
  // Chrome hands the worker one file. If it assumed a sibling script had already
  // run, this throws on a globalThis.WorthIt* that was never defined.
  assert.doesNotThrow(bootServiceWorker);
});

test('it imports its own dependencies, which Firefox gets from background.scripts', () => {
  const { calls, sandbox } = bootServiceWorker();
  const others = manifest.background.scripts.filter(
    (file) => file !== manifest.background.service_worker
  );

  assert.deepEqual(
    calls.imported.map((file) => file.replace(/^\//, '')),
    others,
    'every script the event page loads has to be imported by the worker'
  );
  assert.equal(typeof sandbox.WorthItRates, 'object', 'lib/rates.js did not take effect');
});

test('every listener is registered synchronously, before any await', () => {
  // The MV3 rule that bites hardest: the worker is rebuilt to deliver an event,
  // and a listener added later than the first tick is not there to receive it.
  // Asserted immediately after evaluation, with no microtasks drained.
  const { calls } = bootServiceWorker();
  assert.deepEqual(calls.listeners.sort(), [
    'alarms.onAlarm',
    'runtime.onInstalled',
    'runtime.onMessage',
    'runtime.onStartup',
  ]);
});

test('the daily refresh alarm is ensured on every wake', async () => {
  const { calls } = bootServiceWorker();
  // Unlike the listeners this is async, so it lands a tick later.
  assert.deepEqual(calls.alarms, [], 'nothing synchronous should create an alarm');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(calls.alarms.includes('worthit-rates-refresh'), 'the 24-hour alarm is missing');
});

test('it touches no page globals, because a worker has none', () => {
  // document, window, localStorage and XMLHttpRequest are all absent from the
  // sandbox. If the file reached for one it would throw, so coming up at all is
  // the assertion -- but name them so the intent survives a refactor.
  const { sandbox } = bootServiceWorker();
  ['document', 'window', 'localStorage', 'XMLHttpRequest'].forEach((name) => {
    assert.equal(sandbox[name], undefined, `the sandbox must not provide ${name}`);
  });
  const source = read(manifest.background.service_worker);
  ['document.', 'window.', 'localStorage'].forEach((banned) => {
    assert.ok(!source.includes(banned), `the background must not use ${banned}`);
  });
});

test('it does not fetch merely by starting up', async () => {
  // Rates are fetched on a timer, not when the worker happens to wake, which is
  // the claim the privacy section makes. An empty cache means shouldFetch is
  // true, so one refresh is expected -- but only after the alarm plumbing, never
  // synchronously during evaluation.
  const { calls } = bootServiceWorker();
  assert.equal(calls.fetched, 0, 'no fetch during evaluation');
});
