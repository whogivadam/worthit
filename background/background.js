// The only place in the extension that touches the network.
//
// This file is the background in both browsers, from the two keys in
// manifest.json: Chrome runs it as a service worker, Firefox as an event page.
// Neither is persistent, which is why every listener below is registered
// synchronously at the top level and why nothing here touches the DOM -- the
// context can be torn down and rebuilt between any two events.
//
// It keeps one USD-based rate table in storage.local; the popup and the content
// script read that table and never fetch. Refreshes run on install, on browser
// startup, on a 24-hour alarm and when the user presses Refresh rates -- never
// because a price was detected or checked, so the timing of these requests says
// nothing about what the user browses.

// Chrome hands a service worker one file and expects it to pull in its own
// dependencies; Firefox has already loaded this one from background.scripts, and
// importScripts does not exist on an event page. Hence the guard rather than a
// second entry file.
if (typeof importScripts === 'function') importScripts('/lib/rates.js');

(function () {
  'use strict';

  const Rates = globalThis.WorthItRates;

  const REFRESH_ALARM = 'worthit-rates-refresh';
  const RETRY_ALARM = 'worthit-rates-retry';
  const REFRESH_MESSAGE = 'worthit:refresh-rates';

  let retryAttempt = 0;

  /**
   * The request carries nothing but the URL: no cookies, no referrer and no
   * cached-response identity. It is identical for every user of the extension.
   */
  function request(url) {
    return fetch(url, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'follow',
    });
  }

  async function readCache() {
    const stored = await browser.storage.local.get(Rates.STORAGE_KEY);
    return stored ? stored[Rates.STORAGE_KEY] : null;
  }

  function writeCache(cache) {
    const update = {};
    update[Rates.STORAGE_KEY] = cache;
    return browser.storage.local.set(update);
  }

  function clearRetry() {
    retryAttempt = 0;
    return browser.alarms.clear(RETRY_ALARM);
  }

  function scheduleRetry() {
    const minutes = Rates.backoffMinutes(retryAttempt);
    retryAttempt += 1;
    browser.alarms.create(RETRY_ALARM, { delayInMinutes: minutes });
  }

  /**
   * Refreshes the cache. A failed attempt leaves the previous table untouched
   * and schedules a backoff retry, so a flaky network never costs the user the
   * rates they already had.
   */
  async function refresh(force) {
    const cache = await readCache();
    if (!force && !Rates.shouldFetch(cache)) return cache;

    const result = await Rates.fetchRates({
      fetchImpl: request,
      cachedRates: cache ? cache.rates : null,
      snapshotUrl: browser.runtime.getURL('lib/rates-snapshot.json'),
    });

    if (!result) {
      scheduleRetry();
      return cache;
    }

    await clearRetry();
    await writeCache(result);
    return result;
  }

  async function ensureRefreshAlarm() {
    const existing = await browser.alarms.get(REFRESH_ALARM);
    if (existing) return;
    browser.alarms.create(REFRESH_ALARM, {
      periodInMinutes: Rates.REFRESH_HOURS * 60,
    });
  }

  function onWake(force) {
    ensureRefreshAlarm().catch(function () {});
    refresh(force).catch(function () {});
  }

  browser.runtime.onInstalled.addListener(function () {
    onWake(false);
  });

  browser.runtime.onStartup.addListener(function () {
    onWake(false);
  });

  browser.alarms.onAlarm.addListener(function (alarm) {
    if (alarm.name === REFRESH_ALARM) {
      refresh(false).catch(function () {});
    } else if (alarm.name === RETRY_ALARM) {
      refresh(true).catch(function () {});
    }
  });

  // The popup's manual "Refresh rates" button. Returning the promise replies
  // with the new cache, so the popup can redraw its rate line.
  browser.runtime.onMessage.addListener(function (message) {
    if (message && message.type === REFRESH_MESSAGE) {
      return refresh(true);
    }
    return undefined;
  });

  // The event page can be respawned at any time; make sure the daily alarm
  // exists without resetting its period on every wake.
  ensureRefreshAlarm().catch(function () {});
})();
