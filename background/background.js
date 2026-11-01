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

  // How many refreshes have failed in a row, beside the rate cache in
  // storage.local. It cannot be a variable here: this context is torn down
  // whenever it goes idle -- Chrome kills the worker after about 30 seconds --
  // and the retry alarm fires into a fresh one, where a counter would be back
  // at 0 and the backoff would ask for one minute forever. storage.session is
  // the wrong home for the same reason in the large: a retry alarm can outlive
  // the browser session that scheduled it.
  const RETRY_KEY = 'ratesRetryAttempt';

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

  async function readRetryAttempt() {
    const stored = await browser.storage.local.get(RETRY_KEY);
    const attempt = stored ? stored[RETRY_KEY] : 0;
    return typeof attempt === 'number' && isFinite(attempt) && attempt > 0 ? attempt : 0;
  }

  async function clearRetry() {
    await browser.storage.local.remove(RETRY_KEY);
    return browser.alarms.clear(RETRY_ALARM);
  }

  /**
   * The step is taken from the stored attempt and the next one is stored before
   * the alarm is created, so the schedule advances even when nothing of this
   * context survives to see the alarm it just asked for.
   */
  async function scheduleRetry() {
    const attempt = await readRetryAttempt();
    const update = {};
    update[RETRY_KEY] = attempt + 1;
    await browser.storage.local.set(update);
    browser.alarms.create(RETRY_ALARM, { delayInMinutes: Rates.backoffMinutes(attempt) });
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
      await scheduleRetry();
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
