// The popup: settings on first run, then a manual price check.
//
// It never fetches anything. Rates come from storage.local, written by the
// background event page; the Refresh button asks that page to go and look.
(function () {
  'use strict';

  const Currencies = globalThis.WorthItCurrencies;
  const Parser = globalThis.WorthItParser;
  const Calc = globalThis.WorthItCalc;
  const Rates = globalThis.WorthItRates;

  const SETTINGS_KEY = 'settings';
  const SITES_KEY = 'sites';
  const HISTORY_KEY = 'history';
  const HISTORY_LIMIT = 20;
  const DEBOUNCE_MS = 500;

  const SOURCE_LABELS = {
    'er-api': 'ExchangeRate-API',
    frankfurter: 'Frankfurter (ECB)',
    snapshot: 'bundled snapshot',
  };

  const $ = (id) => document.getElementById(id);

  const state = {
    settings: null,
    sites: {},
    history: [],
    cache: null,
    host: null,
    lastResult: null,
  };

  let debounceTimer = null;

  // --- storage ---------------------------------------------------------------

  function defaultSettings() {
    return {
      incomeMode: 'monthly',
      monthly: '',
      hourly: '',
      hoursPerWeek: 40,
      homeCurrency: Currencies.currencyForLocale(navigator.language) || 'USD',
      overlayEnabled: true,
    };
  }

  async function load() {
    const stored = await browser.storage.local.get([
      SETTINGS_KEY,
      SITES_KEY,
      HISTORY_KEY,
      Rates.STORAGE_KEY,
    ]);
    state.settings = Object.assign(defaultSettings(), stored[SETTINGS_KEY] || {});
    state.sites = stored[SITES_KEY] || {};
    state.history = Array.isArray(stored[HISTORY_KEY]) ? stored[HISTORY_KEY] : [];
    state.cache = stored[Rates.STORAGE_KEY] || null;
  }

  function save(key, value) {
    const update = {};
    update[key] = value;
    return browser.storage.local.set(update);
  }

  /** True once the user has given us enough to convert with. */
  function isConfigured(settings) {
    return Calc.hourlyRate(settings) > 0 && Boolean(settings.homeCurrency);
  }

  // --- formatting ------------------------------------------------------------

  function symbolFor(code) {
    const currency = Currencies.BY_CODE[code];
    if (currency && currency.symbols.length) return currency.symbols[currency.symbols.length - 1];
    return code || '?';
  }

  // Built as nodes rather than markup: no innerHTML anywhere in the popup, which
  // keeps AMO's reviewer lint quiet and makes escaping a non-issue.
  function option(value, label) {
    const element = document.createElement('option');
    element.value = value;
    element.textContent = label;
    return element;
  }

  // Each row reads '<flag> CODE <symbol>'. The flag is the fastest way to find your
  // own currency in 162 rows, and the only cue that works without knowing ISO 4217:
  // the symbol does not disambiguate, with 'kr' shared four ways and '$' a dozen.
  // The code stays in the label, so a row is still identifiable where the flag does
  // not draw -- see flagFor() on what Windows does. Rows without a flag start at the
  // code; nothing is padded in, since the fallback width differs per platform anyway.
  function fillCurrencySelect(select, selected, blankLabel) {
    select.replaceChildren();
    if (blankLabel) select.append(option('', blankLabel));
    Currencies.CURRENCIES.forEach((currency) => {
      const symbol = currency.symbols.length
        ? ' ' + currency.symbols[currency.symbols.length - 1]
        : '';
      const flag = Currencies.flagFor(currency.region);
      select.append(
        option(currency.code, (flag ? flag + ' ' : '') + currency.code + symbol)
      );
    });
    select.value = selected || '';
  }

  // --- the check -------------------------------------------------------------

  /**
   * Reads the typed price. A currency written into the field wins over the
   * dropdown, so typing "€50" does the obvious thing.
   */
  function readInput(text, fallbackCurrency) {
    const typed = String(text || '').trim();
    if (!typed) return null;

    const parsed = Parser.parseOne(typed, {
      homeCurrency: state.settings.homeCurrency,
      forcedCurrency: null,
    });
    if (parsed && parsed.currency) {
      return { amount: parsed.amount, currency: parsed.currency };
    }

    const amount = Parser.parseAmount(typed, Currencies.BY_CODE[fallbackCurrency]);
    if (!isFinite(amount) || isNaN(amount) || amount <= 0) return null;
    return { amount: amount, currency: fallbackCurrency };
  }

  function convert(amount, sourceCode) {
    const home = state.settings.homeCurrency;
    if (sourceCode === home) return amount;
    if (!state.cache || !state.cache.rates) return null;
    return Rates.crossConvert(amount, sourceCode, home, state.cache.rates);
  }

  function renderBlocks(totalHours) {
    const bar = Calc.workdayBlocks(totalHours, state.settings.hoursPerWeek);
    const blocks = $('blocks');
    blocks.replaceChildren();
    bar.filled.forEach((fill) => {
      const block = document.createElement('span');
      block.className = 'block';
      const inner = document.createElement('i');
      inner.style.width = Math.round(fill * 100) + '%';
      block.append(inner);
      blocks.append(block);
    });
    $('overflow').textContent = bar.overflowDays > 0 ? `+${bar.overflowDays} days` : '';
  }

  function runCheck() {
    const raw = $('price').value;
    const input = readInput(raw, $('source-currency').value);

    if (!input) {
      $('result').hidden = true;
      $('no-rate').hidden = true;
      state.lastResult = null;
      return;
    }

    const amountHome = convert(input.amount, input.currency);
    if (amountHome === null) {
      $('result').hidden = true;
      $('no-rate').hidden = false;
      $('no-rate').textContent =
        `No rate for ${input.currency} yet. Try Refresh, or pick another currency.`;
      state.lastResult = null;
      return;
    }
    $('no-rate').hidden = true;

    const rate = Calc.hourlyRate(state.settings);
    const time = Calc.priceToTime(amountHome, rate);
    if (!time) {
      $('result').hidden = true;
      return;
    }

    $('time').textContent = Calc.formatHoursMinutes(time.totalHours);
    $('framing').textContent = Calc.framing(time.totalHours, state.settings.hoursPerWeek);
    renderBlocks(time.totalHours);
    $('result').hidden = false;

    state.lastResult = {
      ts: Date.now(),
      rawInput: raw.trim(),
      amount: input.amount,
      srcCurrency: input.currency,
      amountHome: amountHome,
      totalHours: time.totalHours,
    };

    recordHistory(state.lastResult);
  }

  // --- history ---------------------------------------------------------------

  /**
   * Replaces the newest entry while the user is still editing the same check,
   * so typing 1, 12, 129, 1299 leaves one row rather than four.
   */
  function recordHistory(entry) {
    const newest = state.history[0];
    const sameCheck =
      newest &&
      newest.srcCurrency === entry.srcCurrency &&
      entry.ts - newest.ts < 60000 &&
      (String(newest.rawInput).startsWith(entry.rawInput) ||
        String(entry.rawInput).startsWith(newest.rawInput));

    if (sameCheck) state.history.shift();
    state.history.unshift(entry);
    state.history = state.history.slice(0, HISTORY_LIMIT);
    save(HISTORY_KEY, state.history);
    renderHistory();
  }

  function renderHistory() {
    const list = $('history-list');
    const totalHours = state.history.reduce((sum, entry) => sum + (entry.totalHours || 0), 0);

    $('history-empty').hidden = state.history.length > 0;
    $('total').textContent = state.history.length
      ? `${Calc.formatHoursMinutes(totalHours)} total`
      : '';

    list.replaceChildren();
    state.history.forEach((entry) => {
      const row = document.createElement('li');
      const price = document.createElement('span');
      price.textContent = entry.rawInput + ' ' + entry.srcCurrency;
      const time = document.createElement('span');
      time.textContent = Calc.formatBadge(entry.totalHours, state.settings.hoursPerWeek);
      row.append(price, time);
      list.append(row);
    });
  }

  // --- rate status -----------------------------------------------------------

  function renderRateStatus() {
    const line = $('rate-status');
    if (!state.cache || !state.cache.rates) {
      line.textContent = 'No rates yet';
      line.classList.add('warn');
      return;
    }
    const label = SOURCE_LABELS[state.cache.source] || state.cache.source;
    line.textContent = `Rates updated ${state.cache.rateDate || 'unknown'} · ${label}`;
    line.classList.toggle('warn', Rates.isWarnState(state.cache));
  }

  // --- per-site --------------------------------------------------------------

  async function readActiveHost() {
    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const url = tabs && tabs[0] ? tabs[0].url : null;
      if (!url) return null;
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      return parsed.hostname;
    } catch {
      return null;
    }
  }

  function siteSettings(host) {
    return state.sites[host] || { disabled: false, forceCurrency: null };
  }

  function renderSite() {
    if (!state.host) {
      $('site-panel').hidden = true;
      return;
    }
    const site = siteSettings(state.host);
    $('site-host').textContent = state.host;
    $('site-disabled').checked = Boolean(site.disabled);
    fillCurrencySelect($('site-currency'), site.forceCurrency || '', 'Auto-detect');
  }

  async function updateSite(changes) {
    if (!state.host) return;
    state.sites[state.host] = Object.assign(siteSettings(state.host), changes);
    await save(SITES_KEY, state.sites);
  }

  // --- views -----------------------------------------------------------------

  function showMain() {
    $('view-settings').hidden = true;
    $('view-main').hidden = false;
    $('currency-symbol').textContent = symbolFor(state.settings.homeCurrency);
    fillCurrencySelect($('source-currency'), state.settings.homeCurrency, null);
    renderHistory();
    renderRateStatus();
    renderSite();
    $('price').focus();
  }

  function showSettings(firstRun) {
    $('view-main').hidden = true;
    $('view-settings').hidden = false;
    $('first-run').hidden = !firstRun;
    $('cancel-settings').hidden = Boolean(firstRun);
    $('settings-error').hidden = true;

    const mode = state.settings.incomeMode === 'hourly' ? 'hourly' : 'monthly';
    document.querySelectorAll('input[name="income-mode"]').forEach((radio) => {
      radio.checked = radio.value === mode;
    });
    $('monthly').value = state.settings.monthly === '' ? '' : String(state.settings.monthly);
    $('hourly').value = state.settings.hourly === '' ? '' : String(state.settings.hourly);
    $('hours-per-week').value = String(state.settings.hoursPerWeek);
    $('overlay-enabled').checked = state.settings.overlayEnabled !== false;
    fillCurrencySelect($('home-currency'), state.settings.homeCurrency, null);
  }

  function readNumber(text) {
    const value = Parser.parseAmount(String(text || '').trim(), null);
    return isFinite(value) && !isNaN(value) ? value : 0;
  }

  async function saveSettings() {
    const mode =
      document.querySelector('input[name="income-mode"]:checked') &&
      document.querySelector('input[name="income-mode"]:checked').value === 'hourly'
        ? 'hourly'
        : 'monthly';

    const candidate = {
      incomeMode: mode,
      monthly: readNumber($('monthly').value),
      hourly: readNumber($('hourly').value),
      hoursPerWeek: readNumber($('hours-per-week').value) || 40,
      homeCurrency: $('home-currency').value || 'USD',
      overlayEnabled: $('overlay-enabled').checked,
    };

    if (Calc.hourlyRate(candidate) <= 0) {
      $('settings-error').hidden = false;
      $('settings-error').textContent =
        mode === 'hourly'
          ? 'Enter an hourly rate above zero.'
          : 'Enter a monthly income above zero, and hours per week.';
      return;
    }

    state.settings = candidate;
    await save(SETTINGS_KEY, candidate);
    showMain();
    runCheck();
  }

  // --- wiring ----------------------------------------------------------------

  function scheduleCheck() {
    window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(runCheck, DEBOUNCE_MS);
  }

  function wire() {
    // Never per keystroke: Enter runs it now, otherwise half a second of quiet.
    $('price').addEventListener('input', scheduleCheck);
    $('price').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        window.clearTimeout(debounceTimer);
        runCheck();
      }
    });
    $('source-currency').addEventListener('change', runCheck);

    $('share').addEventListener('click', async () => {
      if (!state.lastResult) return;
      const result = state.lastResult;
      const price = `${result.rawInput} ${result.srcCurrency}`;
      const time = Calc.formatHoursMinutes(result.totalHours);
      try {
        await navigator.clipboard.writeText(`${price} = ${time} of my life. Worth it?`);
        $('share').textContent = 'COPIED';
        window.setTimeout(() => {
          $('share').textContent = 'COPY';
        }, 1200);
      } catch {
        $('share').textContent = 'COPY FAILED';
      }
    });

    $('clear').addEventListener('click', async () => {
      state.history = [];
      await save(HISTORY_KEY, state.history);
      renderHistory();
    });

    $('site-disabled').addEventListener('change', (event) => {
      updateSite({ disabled: event.target.checked });
    });
    $('site-currency').addEventListener('change', (event) => {
      updateSite({ forceCurrency: event.target.value || null });
    });

    $('refresh').addEventListener('click', async () => {
      $('refresh').textContent = '...';
      try {
        const updated = await browser.runtime.sendMessage({ type: 'worthit:refresh-rates' });
        if (updated) state.cache = updated;
      } catch {
        // leave the old cache in place and let the status line say so
      }
      renderRateStatus();
      runCheck();
      $('refresh').textContent = 'REFRESH';
    });

    $('open-settings').addEventListener('click', () => showSettings(false));
    $('cancel-settings').addEventListener('click', () => showMain());
    $('save-settings').addEventListener('click', saveSettings);

    // The background page may write new rates while the popup is open.
    browser.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[Rates.STORAGE_KEY]) return;
      state.cache = changes[Rates.STORAGE_KEY].newValue;
      renderRateStatus();
      runCheck();
    });
  }

  async function start() {
    await load();
    state.host = await readActiveHost();
    wire();
    if (isConfigured(state.settings)) {
      showMain();
    } else {
      showSettings(true);
    }
  }

  start();
})();
