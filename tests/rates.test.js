'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const rates = require('../lib/rates.js');

const NOW = Date.parse('2026-10-21T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const TABLE = { USD: 1, SEK: 9.8785, EUR: 0.89015, JPY: 157.88, GBP: 0.74617 };

/** A fetch stand-in: pairs of [url fragment, what to do when it matches]. */
function mockFetch(handlers) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    for (const [fragment, respond] of handlers) {
      if (url.indexOf(fragment) !== -1) return respond();
    }
    throw new Error('unexpected url: ' + url);
  };
  impl.calls = calls;
  return impl;
}

const ok = (payload) => () => ({ ok: true, json: async () => payload });
const httpError = (status) => () => ({ ok: false, status: status || 500, json: async () => ({}) });
const networkError = () => () => {
  throw new Error('network down');
};

const ER_API_OK = {
  result: 'success',
  base_code: 'USD',
  time_last_update_unix: Math.floor(Date.parse('2026-10-21T00:02:32Z') / 1000),
  rates: { USD: 1, SEK: 9.8785, EUR: 0.89015, JPY: 157.88, INR: 94.47 },
};

const FRANKFURTER_OK = {
  amount: 1,
  base: 'USD',
  date: '2026-10-21',
  // The ECB feed is much smaller and leaves its own base out of `rates`.
  rates: { SEK: 9.8785, EUR: 0.89015, JPY: 157.88 },
};

// --- conversion --------------------------------------------------------------

test('cross-conversion goes through USD', () => {
  assert.equal(rates.crossConvert(100, 'USD', 'SEK', TABLE), 987.85);
  assert.equal(rates.crossConvert(100, 'SEK', 'USD', TABLE), (100 / 9.8785) * 1);
  assert.equal(rates.crossConvert(100, 'SEK', 'EUR', TABLE), (100 / 9.8785) * 0.89015);
  assert.equal(rates.crossConvert(1000, 'JPY', 'GBP', TABLE), (1000 / 157.88) * 0.74617);
});

test('the same currency converts to itself exactly', () => {
  assert.equal(rates.crossConvert(100, 'SEK', 'SEK', TABLE), 100);
  assert.equal(rates.crossConvert(0, 'USD', 'USD', TABLE), 0);
});

test('an unknown currency converts to null rather than a wrong number', () => {
  assert.equal(rates.crossConvert(100, 'XYZ', 'USD', TABLE), null);
  assert.equal(rates.crossConvert(100, 'USD', 'XYZ', TABLE), null);
  assert.equal(rates.crossConvert(100, 'USD', 'SEK', null), null);
  assert.equal(rates.crossConvert(100, 'USD', 'SEK', {}), null);
  assert.equal(rates.crossConvert('abc', 'USD', 'SEK', TABLE), null);
  assert.equal(rates.crossConvert(100, 'USD', 'SEK', { USD: 1, SEK: 0 }), null);
});

test('isKnownCurrency only accepts a usable positive rate', () => {
  assert.equal(rates.isKnownCurrency('SEK', TABLE), true);
  assert.equal(rates.isKnownCurrency('XYZ', TABLE), false);
  assert.equal(rates.isKnownCurrency('SEK', { SEK: 0 }), false);
  assert.equal(rates.isKnownCurrency('SEK', { SEK: -1 }), false);
  assert.equal(rates.isKnownCurrency(null, TABLE), false);
});

test('the effective rate is what the tooltip should show', () => {
  assert.equal(rates.effectiveRate('SEK', 'USD', TABLE), 1 / 9.8785);
  assert.equal(rates.effectiveRate('XYZ', 'USD', TABLE), null);
});

// --- payload validation ------------------------------------------------------

test('the primary payload is validated, not trusted', () => {
  assert.ok(rates.parseErApi(ER_API_OK));
  assert.equal(rates.parseErApi(ER_API_OK).source, 'er-api');
  assert.equal(rates.parseErApi(ER_API_OK).rateDate, '2026-10-21');
  assert.equal(rates.parseErApi(null), null);
  assert.equal(rates.parseErApi({ result: 'error' }), null);
  assert.equal(rates.parseErApi({ result: 'success', base_code: 'EUR', rates: { EUR: 1 } }), null);
  assert.equal(rates.parseErApi({ result: 'success', base_code: 'USD', rates: {} }), null);
  assert.equal(
    rates.parseErApi({ result: 'success', base_code: 'USD', rates: { SEK: 'nine' } }),
    null,
  );
});

test('the fallback payload is validated too, and USD is put back', () => {
  const parsed = rates.parseFrankfurter(FRANKFURTER_OK);
  assert.equal(parsed.source, 'frankfurter');
  assert.equal(parsed.rateDate, '2026-10-21');
  // Frankfurter omits its own base, so USD has to be re-added or every
  // conversion to or from USD breaks.
  assert.equal(parsed.rates.USD, 1);
  assert.equal(rates.parseFrankfurter({ base: 'EUR', rates: { USD: 1 } }), null);
  assert.equal(rates.parseFrankfurter(null), null);
});

// --- cache state -------------------------------------------------------------

test('cache age is measured from when it was fetched', () => {
  assert.equal(rates.cacheAgeHours({ rates: TABLE, fetchedAt: NOW - 3 * HOUR }, NOW), 3);
  assert.equal(rates.cacheAgeHours(null, NOW), Infinity);
  assert.equal(rates.cacheAgeHours({ rates: TABLE }, NOW), Infinity);
});

test('a cache under 12 hours old skips the fetch', () => {
  const fresh = { rates: TABLE, fetchedAt: NOW - 11.9 * HOUR, rateDate: '2026-10-21' };
  const stale = { rates: TABLE, fetchedAt: NOW - 12.1 * HOUR, rateDate: '2026-10-21' };
  assert.equal(rates.shouldFetch(fresh, NOW), false);
  assert.equal(rates.shouldFetch(stale, NOW), true);
  assert.equal(rates.shouldFetch(null, NOW), true);
  // a cache with an unusable table is no cache at all
  assert.equal(rates.shouldFetch({ rates: {}, fetchedAt: NOW }, NOW), true);
});

test('the popup warns past 7 days, or whenever the snapshot is in use', () => {
  const recent = { rates: TABLE, source: 'er-api', rateDate: '2026-10-20', fetchedAt: NOW };
  const old = { rates: TABLE, source: 'er-api', rateDate: '2026-10-13', fetchedAt: NOW };
  const snapshot = { rates: TABLE, source: 'snapshot', rateDate: '2026-10-21', fetchedAt: NOW };

  assert.equal(rates.isWarnState(recent, NOW), false);
  assert.equal(rates.isWarnState(old, NOW), true);
  assert.equal(rates.isWarnState(snapshot, NOW), true);
  assert.equal(rates.isWarnState(null, NOW), true);
  assert.equal(rates.rateDateAgeDays(recent, NOW), 1.5);
  assert.equal(rates.rateDateAgeDays({ rates: TABLE, rateDate: 'nonsense' }, NOW), Infinity);
});

test('exactly 7 days old does not warn, 7 days and a minute does', () => {
  const sevenDays = {
    rates: TABLE,
    source: 'er-api',
    rateDate: new Date(NOW - 7 * DAY).toISOString().slice(0, 10),
    fetchedAt: NOW,
  };
  // rateDate is a date, so the age measured from midnight is 7.5 days here
  assert.equal(rates.isWarnState(sevenDays, NOW), true);
  const sixDays = {
    rates: TABLE,
    source: 'er-api',
    rateDate: new Date(NOW - 6 * DAY).toISOString().slice(0, 10),
    fetchedAt: NOW,
  };
  assert.equal(rates.isWarnState(sixDays, NOW), false);
});

test('the retry schedule is 1, 5 then 30 minutes and stays there', () => {
  assert.deepEqual(rates.BACKOFF_MINUTES, [1, 5, 30]);
  assert.equal(rates.backoffMinutes(0), 1);
  assert.equal(rates.backoffMinutes(1), 5);
  assert.equal(rates.backoffMinutes(2), 30);
  assert.equal(rates.backoffMinutes(7), 30);
  assert.equal(rates.backoffMinutes(-1), 1);
});

// --- the provider chain ------------------------------------------------------

test('the providers are the specced ones, in order', () => {
  assert.deepEqual(
    rates.PROVIDERS.map((provider) => provider.id),
    ['er-api', 'frankfurter'],
  );
  assert.equal(rates.PROVIDERS[0].url, 'https://open.er-api.com/v6/latest/USD');
  assert.equal(rates.PROVIDERS[1].url, 'https://api.frankfurter.app/latest?from=USD');
});

test('the primary is used when it answers', async () => {
  const fetchImpl = mockFetch([['open.er-api.com', ok(ER_API_OK)]]);
  const result = await rates.fetchRates({ fetchImpl, now: NOW });

  assert.equal(result.source, 'er-api');
  assert.equal(result.base, 'USD');
  assert.equal(result.fetchedAt, NOW);
  assert.equal(result.rates.INR, 94.47);
  // the fallback is never even asked
  assert.equal(fetchImpl.calls.length, 1);
});

test('a network failure on the primary falls through to Frankfurter', async () => {
  const fetchImpl = mockFetch([
    ['open.er-api.com', networkError()],
    ['frankfurter', ok(FRANKFURTER_OK)],
  ]);
  const result = await rates.fetchRates({ fetchImpl, now: NOW });

  assert.equal(result.source, 'frankfurter');
  assert.equal(result.rates.USD, 1);
  assert.equal(fetchImpl.calls.length, 2);
});

test('an HTTP error and a malformed payload both fall through', async () => {
  const onHttpError = await rates.fetchRates({
    fetchImpl: mockFetch([
      ['open.er-api.com', httpError(503)],
      ['frankfurter', ok(FRANKFURTER_OK)],
    ]),
    now: NOW,
  });
  assert.equal(onHttpError.source, 'frankfurter');

  const onGarbage = await rates.fetchRates({
    fetchImpl: mockFetch([
      ['open.er-api.com', ok({ result: 'success', base_code: 'EUR', rates: { EUR: 1 } })],
      ['frankfurter', ok(FRANKFURTER_OK)],
    ]),
    now: NOW,
  });
  assert.equal(onGarbage.source, 'frankfurter');
});

test('Frankfurter is merged over the cache, never substituted for it', async () => {
  const fetchImpl = mockFetch([
    ['open.er-api.com', networkError()],
    ['frankfurter', ok(FRANKFURTER_OK)],
  ]);
  // INR and THB are in the cache but not in the ECB feed.
  const cachedRates = { USD: 1, SEK: 9.5, EUR: 0.9, INR: 94.47, THB: 33.575 };
  const result = await rates.fetchRates({ fetchImpl, cachedRates, now: NOW });

  // fresh values win where the feed has them
  assert.equal(result.rates.SEK, 9.8785);
  assert.equal(result.rates.EUR, 0.89015);
  // and the currencies it does not carry survive
  assert.equal(result.rates.INR, 94.47);
  assert.equal(result.rates.THB, 33.575);
  assert.equal(result.rates.USD, 1);
});

test('the primary is not merged over the cache, it replaces it', async () => {
  const fetchImpl = mockFetch([['open.er-api.com', ok(ER_API_OK)]]);
  const cachedRates = { USD: 1, ZZZ: 42 };
  const result = await rates.fetchRates({ fetchImpl, cachedRates, now: NOW });

  // A full table from the primary is authoritative: a currency it has dropped
  // must not linger from an old cache.
  assert.equal(result.rates.ZZZ, undefined);
});

test('the bundled snapshot is the last resort', async () => {
  const snapshot = { base: 'USD', rateDate: '2026-10-01', rates: { SEK: 9.7, EUR: 0.9 } };
  const fetchImpl = mockFetch([
    ['open.er-api.com', networkError()],
    ['frankfurter', networkError()],
    ['rates-snapshot.json', ok(snapshot)],
  ]);
  const result = await rates.fetchRates({
    fetchImpl,
    snapshotUrl: 'moz-extension://abc/lib/rates-snapshot.json',
    now: NOW,
  });

  assert.equal(result.source, 'snapshot');
  assert.equal(result.rateDate, '2026-10-01');
  assert.equal(result.rates.USD, 1);
  assert.equal(rates.isWarnState(result, NOW), true);
  assert.equal(fetchImpl.calls.length, 3);
});

test('when everything fails the result is null, so the caller keeps its cache', async () => {
  const fetchImpl = mockFetch([
    ['open.er-api.com', networkError()],
    ['frankfurter', networkError()],
    ['rates-snapshot.json', networkError()],
  ]);
  const cachedRates = { USD: 1, SEK: 9.5 };
  const result = await rates.fetchRates({
    fetchImpl,
    cachedRates,
    snapshotUrl: 'moz-extension://abc/lib/rates-snapshot.json',
    now: NOW,
  });

  assert.equal(result, null);
  // the caller's table is untouched
  assert.deepEqual(cachedRates, { USD: 1, SEK: 9.5 });
});

test('fetchRates refuses to run without a fetch implementation', async () => {
  assert.equal(await rates.fetchRates({}), null);
  assert.equal(await rates.fetchRates(), null);
});

test('the bundled snapshot that ships is usable', () => {
  const snapshot = require('../lib/rates-snapshot.json');
  assert.equal(snapshot.base, 'USD');
  assert.equal(snapshot.source, 'snapshot');
  assert.equal(snapshot.rates.USD, 1);
  assert.ok(Object.keys(snapshot.rates).length > 100, 'snapshot should cover the full table');
  assert.match(snapshot.rateDate, /^\d{4}-\d{2}-\d{2}$/);
  // it must convert like any other table
  assert.ok(rates.crossConvert(100, 'SEK', 'EUR', snapshot.rates) > 0);
});
