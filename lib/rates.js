// Exchange rates. Everything is stored USD-based and every conversion goes
// through USD, so one table of ~160 rates covers every pair.
//
// This module holds the logic and the provider chain but never reaches the
// network by itself: the caller injects `fetchImpl`. In the extension only the
// background event page calls in here with a real fetch; the popup and the
// content script read the cached result out of storage.local.
(function (root) {
  'use strict';

  const STORAGE_KEY = 'ratesCache';
  const BASE = 'USD';

  // Skip the network entirely while the cache is younger than this.
  const FRESH_HOURS = 12;
  // Normal refresh cadence.
  const REFRESH_HOURS = 24;
  // Warn in the popup past this age, or whenever the bundled snapshot is in use.
  const STALE_DAYS = 7;
  // Retry schedule after a network failure.
  const BACKOFF_MINUTES = [1, 5, 30];

  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;

  /** 'YYYY-MM-DD' for a unix-seconds timestamp. */
  function isoDate(unixSeconds) {
    const date = new Date(unixSeconds * 1000);
    if (isNaN(date.getTime())) return null;
    return date.toISOString().slice(0, 10);
  }

  function isPlainRates(rates) {
    if (!rates || typeof rates !== 'object') return false;
    const codes = Object.keys(rates);
    if (!codes.length) return false;
    return codes.every(function (code) {
      const value = rates[code];
      return typeof value === 'number' && isFinite(value) && value > 0;
    });
  }

  // --- providers -------------------------------------------------------------

  /** open.er-api.com: { result, base_code, time_last_update_unix, rates }. */
  function parseErApi(payload) {
    if (!payload || payload.result !== 'success') return null;
    if (payload.base_code !== BASE) return null;
    if (!isPlainRates(payload.rates)) return null;
    return {
      rates: Object.assign({}, payload.rates, { USD: 1 }),
      rateDate: isoDate(payload.time_last_update_unix) || null,
      source: 'er-api',
    };
  }

  /**
   * api.frankfurter.app: { amount, base, date, rates }. Carries ~30 ECB
   * currencies and leaves its own base out of `rates`, so USD is put back.
   */
  function parseFrankfurter(payload) {
    if (!payload || payload.base !== BASE) return null;
    if (!isPlainRates(payload.rates)) return null;
    return {
      rates: Object.assign({}, payload.rates, { USD: 1 }),
      rateDate: typeof payload.date === 'string' ? payload.date : null,
      source: 'frankfurter',
    };
  }

  // Tried in order. The secondary is merged over whatever is already cached so
  // that the currencies it does not carry are kept rather than lost.
  const PROVIDERS = [
    {
      id: 'er-api',
      url: 'https://open.er-api.com/v6/latest/USD',
      parse: parseErApi,
      mergeOverCache: false,
    },
    {
      id: 'frankfurter',
      // This host 301-redirects to api.frankfurter.dev, which is why both hosts
      // are declared in the manifest.
      url: 'https://api.frankfurter.app/latest?from=USD',
      parse: parseFrankfurter,
      mergeOverCache: true,
    },
  ];

  // --- conversion ------------------------------------------------------------

  function isKnownCurrency(code, rates) {
    return Boolean(code && rates && typeof rates[code] === 'number' && rates[code] > 0);
  }

  /**
   * amount_home = amount / rate[src] * rate[home]. Returns null when either
   * currency is missing from the table, so the caller can show '?' rather than a
   * number that is quietly wrong.
   */
  function crossConvert(amount, sourceCode, homeCode, rates) {
    const value = Number(amount);
    if (!isFinite(value)) return null;
    if (!isKnownCurrency(sourceCode, rates)) return null;
    if (!isKnownCurrency(homeCode, rates)) return null;
    if (sourceCode === homeCode) return value;
    return (value / rates[sourceCode]) * rates[homeCode];
  }

  /** The rate actually applied, for the overlay tooltip. */
  function effectiveRate(sourceCode, homeCode, rates) {
    const converted = crossConvert(1, sourceCode, homeCode, rates);
    return converted === null ? null : converted;
  }

  // --- cache state -----------------------------------------------------------

  function cacheAgeHours(cache, now) {
    if (!cache || typeof cache.fetchedAt !== 'number') return Infinity;
    const at = typeof now === 'number' ? now : Date.now();
    return (at - cache.fetchedAt) / HOUR_MS;
  }

  function rateDateAgeDays(cache, now) {
    if (!cache || !cache.rateDate) return Infinity;
    const published = Date.parse(cache.rateDate + 'T00:00:00Z');
    if (isNaN(published)) return Infinity;
    const at = typeof now === 'number' ? now : Date.now();
    return (at - published) / DAY_MS;
  }

  /** True when the cache is missing, unusable or older than the fresh window. */
  function shouldFetch(cache, now) {
    if (!cache || !isPlainRates(cache.rates)) return true;
    return cacheAgeHours(cache, now) >= FRESH_HOURS;
  }

  /** True when the popup should show the rate line in the accent colour. */
  function isWarnState(cache, now) {
    if (!cache || !isPlainRates(cache.rates)) return true;
    if (cache.source === 'snapshot') return true;
    return rateDateAgeDays(cache, now) > STALE_DAYS;
  }

  function backoffMinutes(attempt) {
    const index = Math.max(0, Number(attempt) || 0);
    return BACKOFF_MINUTES[Math.min(index, BACKOFF_MINUTES.length - 1)];
  }

  // --- fetching --------------------------------------------------------------

  async function readJson(fetchImpl, url) {
    const response = await fetchImpl(url);
    if (!response || !response.ok) return null;
    return response.json();
  }

  /**
   * Walks the provider chain, then falls back to the bundled snapshot.
   *
   * options = { fetchImpl, cachedRates, snapshotUrl, now }
   * Resolves to { rates, rateDate, source, fetchedAt } or null when every step
   * fails and there is nothing bundled either.
   */
  async function fetchRates(options) {
    const config = options || {};
    const fetchImpl = config.fetchImpl;
    const cachedRates = isPlainRates(config.cachedRates) ? config.cachedRates : null;
    const stampedAt = typeof config.now === 'number' ? config.now : Date.now();

    if (typeof fetchImpl !== 'function') return null;

    for (let i = 0; i < PROVIDERS.length; i += 1) {
      const provider = PROVIDERS[i];
      let parsed;
      try {
        const payload = await readJson(fetchImpl, provider.url);
        parsed = provider.parse(payload);
      } catch {
        parsed = null;
      }
      if (!parsed) continue;

      const rates =
        provider.mergeOverCache && cachedRates
          ? Object.assign({}, cachedRates, parsed.rates)
          : parsed.rates;

      return {
        base: BASE,
        rates: rates,
        rateDate: parsed.rateDate,
        source: parsed.source,
        fetchedAt: stampedAt,
      };
    }

    // Last resort: the snapshot generated at build time. It is a file inside the
    // extension, not a network request.
    if (config.snapshotUrl) {
      try {
        const payload = await readJson(fetchImpl, config.snapshotUrl);
        if (payload && isPlainRates(payload.rates)) {
          return {
            base: BASE,
            rates: Object.assign({}, payload.rates, { USD: 1 }),
            rateDate: payload.rateDate || null,
            source: 'snapshot',
            fetchedAt: stampedAt,
          };
        }
      } catch {
        // fall through
      }
    }

    return null;
  }

  root.WorthItRates = {
    STORAGE_KEY: STORAGE_KEY,
    BASE: BASE,
    FRESH_HOURS: FRESH_HOURS,
    REFRESH_HOURS: REFRESH_HOURS,
    STALE_DAYS: STALE_DAYS,
    BACKOFF_MINUTES: BACKOFF_MINUTES,
    PROVIDERS: PROVIDERS,
    parseErApi: parseErApi,
    parseFrankfurter: parseFrankfurter,
    crossConvert: crossConvert,
    effectiveRate: effectiveRate,
    isKnownCurrency: isKnownCurrency,
    cacheAgeHours: cacheAgeHours,
    rateDateAgeDays: rateDateAgeDays,
    shouldFetch: shouldFetch,
    isWarnState: isWarnState,
    backoffMinutes: backoffMinutes,
    fetchRates: fetchRates,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.WorthItRates;
}
