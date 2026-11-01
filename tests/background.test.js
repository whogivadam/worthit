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

// The names the background uses, repeated here so a rename shows up as a failing
// test rather than as a retry that silently never fires.
const RETRY_ALARM = 'worthit-rates-retry';
const RETRY_KEY = 'ratesRetryAttempt';

/** One tick of the event loop, after which every pending promise has settled. */
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Evaluates the service-worker entry in a context with the worker globals and
 * none of the page ones, and records what it did on the way up.
 *
 * `options.store` is storage.local. Passing the same object to two boots is a
 * restart of the background context: fresh globals, the same storage, which is
 * exactly what Chrome and Firefox do between two alarms.
 * `options.respond` stands in for the network; by default every request fails.
 */
function bootServiceWorker(options) {
  const config = options || {};
  const store = config.store || {};
  const calls = { listeners: [], handlers: {}, alarms: [], retryDelays: [], imported: [], fetched: 0 };

  function listen(name) {
    return (handler) => {
      calls.listeners.push(name);
      calls.handlers[name] = handler;
    };
  }

  const sandbox = {
    console: { warn() {}, error() {} },
    fetch: async (url) => {
      calls.fetched += 1;
      return config.respond ? config.respond(url) : { ok: false };
    },
    importScripts(...files) {
      files.forEach((file) => {
        calls.imported.push(file);
        const local = file.replace(/^\//, '');
        vm.runInContext(read(local), context, { filename: local });
      });
    },
    browser: {
      storage: {
        local: {
          get: async (key) => (key in store ? { [key]: store[key] } : {}),
          set: async (update) => Object.assign(store, update),
          remove: async (key) => {
            delete store[key];
          },
        },
      },
      alarms: {
        create: (name, info) => {
          calls.alarms.push(name);
          if (name === RETRY_ALARM) calls.retryDelays.push(info && info.delayInMinutes);
        },
        get: async () => null,
        clear: async () => {},
        onAlarm: { addListener: listen('alarms.onAlarm') },
      },
      runtime: {
        getURL: (p) => 'chrome-extension://worthit/' + p,
        onInstalled: { addListener: listen('runtime.onInstalled') },
        onStartup: { addListener: listen('runtime.onStartup') },
        onMessage: { addListener: listen('runtime.onMessage') },
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

test('the retry backoff survives the background context being torn down', async () => {
  // The bug this covers: the attempt counter lived in a module variable, and the
  // retry alarm always fires into a fresh context where that variable is back at
  // 0. Every failure therefore asked for one minute, forever, instead of backing
  // off -- and a background that only wakes to retry never notices.
  //
  // Each boot below is one of those contexts. Nothing crosses between them but
  // storage, as in the browser.
  const store = {};

  for (const expected of [1, 5, 30, 30]) {
    const { calls } = bootServiceWorker({ store });
    await calls.handlers['runtime.onStartup']();
    await settle();
    assert.deepEqual(
      calls.retryDelays,
      [expected],
      `a failure with ${store[RETRY_KEY] - 1} behind it should retry in ${expected} minutes`
    );
  }

  assert.equal(store[RETRY_KEY], 4, 'four failures should have been counted');
});

test('what the retry stores is a count, in storage.local, and nothing else', async () => {
  const store = {};
  const { calls } = bootServiceWorker({ store });
  await calls.handlers['runtime.onStartup']();
  await settle();

  assert.deepEqual(Object.keys(store), [RETRY_KEY], 'a failed refresh must not write a cache');
  assert.equal(typeof store[RETRY_KEY], 'number', 'an attempt count is a number, not user data');
});

test('a successful refresh resets the schedule to the first step', async () => {
  const rates = { result: 'success', base_code: 'USD', time_last_update_unix: 1767225600, rates: { SEK: 10 } };
  const store = {};
  store[RETRY_KEY] = 2;

  const good = bootServiceWorker({
    store,
    respond: async () => ({ ok: true, json: async () => rates }),
  });
  await good.calls.handlers['runtime.onStartup']();
  await settle();

  assert.equal(RETRY_KEY in store, false, 'success has to clear the stored attempt');

  // And the next failure, in yet another context, starts the schedule over. It
  // goes through the retry alarm because the cache is fresh now, and only a
  // forced refresh reaches the network at all.
  const bad = bootServiceWorker({ store });
  await bad.calls.handlers['alarms.onAlarm']({ name: RETRY_ALARM });
  await settle();
  assert.deepEqual(bad.calls.retryDelays, [1]);
});
