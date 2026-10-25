// The popup: settings on first run, then a manual price check.
//
// It never fetches anything. Rates come from storage.local, written by the
// background event page; the Refresh button asks that page to go and look.
(function () {
  'use strict';

  const Currencies = globalThis.WorthItCurrencies;
  const Parser = globalThis.WorthItParser;
  const Calc = globalThis.WorthItCalc;
  const I18n = globalThis.WorthItI18n;
  const Search = globalThis.WorthItSearch;
  const Rates = globalThis.WorthItRates;

  const SETTINGS_KEY = 'settings';
  const SITES_KEY = 'sites';
  const HISTORY_KEY = 'history';
  const HISTORY_LIMIT = 20;
  const DEBOUNCE_MS = 500;

  // ExchangeRate-API and Frankfurter are proper names and stay as they are; the
  // bundled snapshot is a description and gets translated.
  const SOURCE_NAMES = {
    'er-api': 'ExchangeRate-API',
    frankfurter: 'Frankfurter (ECB)',
  };

  function sourceLabel(source) {
    if (source === 'snapshot') return I18n.t('rates.sourceSnapshot');
    return SOURCE_NAMES[source] || source;
  }

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
      language: I18n.resolve(null, navigator.language),
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
    I18n.setLanguage(state.settings.language);
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

  /**
   * Applies the string table to the markup: data-i18n sets text, the two
   * data-i18n-* attributes set theirs. Runs on open and again on every language
   * change, so nothing has to be re-created to switch language.
   */
  function applyTranslations() {
    document.documentElement.lang = I18n.language();
    document.querySelectorAll('[data-i18n]').forEach((element) => {
      element.textContent = I18n.t(element.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-title]').forEach((element) => {
      element.setAttribute('title', I18n.t(element.dataset.i18nTitle));
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
      element.setAttribute('aria-label', I18n.t(element.dataset.i18nAriaLabel));
    });
  }

  function fillLanguageSelect() {
    const select = $('language');
    select.replaceChildren();
    I18n.LANGUAGES.forEach((code) => {
      select.append(option(code, I18n.nameOf(code)));
    });
    select.value = I18n.language();
  }

  // Each row reads '<flag> CODE <symbol>'. The flag is the fastest way to find your
  // own currency in 162 rows, and the only cue that works without knowing ISO 4217:
  // the symbol does not disambiguate, with 'kr' shared four ways and '$' a dozen.
  // The code stays in the label, so a row is still identifiable where the flag does
  // not draw -- see flagFor() on what Windows does. Rows without a flag start at the
  // code; nothing is padded in, since the fallback width differs per platform anyway.
  function currencyLabel(code) {
    const currency = Currencies.BY_CODE[code];
    if (!currency) return code || '';
    const symbol = currency.symbols.length
      ? ' ' + currency.symbols[currency.symbols.length - 1]
      : '';
    const flag = Currencies.flagFor(currency.region);
    return (flag ? flag + ' ' : '') + code + symbol;
  }

  // --- the currency picker ---------------------------------------------------

  const pickers = Object.create(null);

  // Kept in step with .combo-list in popup.css: used only to decide whether the
  // list has room to open downwards.
  const LIST_MAX_HEIGHT = 232;
  const ROW_HEIGHT = 28;

  /**
   * A searchable currency picker: an input over a listbox, filtered through
   * lib/search.js on code, country or the currency's own name.
   *
   * It is a combobox rather than a <select> because a <select> cannot be typed
   * into -- browsers give only first-letter type-ahead, so 's' walks SAR, SBD,
   * SCR, SDG, SEK one keystroke at a time. Everything the <select> gave for
   * free is therefore re-implemented here: expanded state, an active option,
   * arrow keys, Enter, Escape, and the aria wiring that tells a screen reader
   * what is active.
   *
   * value() is always the bare ISO code. The text in the input is for reading
   * and typing only, and is restored from the code whenever the picker closes,
   * so a half-typed query can never become the setting.
   */
  function createPicker(id, config) {
    const input = $(id);
    const list = $(id + '-list');
    const settings = config || {};
    const picker = {
      code: '',
      open: false,
      active: -1,
      rows: [],
      // The input shows the selected label until the user actually types. Until
      // then the query is empty, so opening shows the whole list rather than
      // filtering by the label that is already sitting in the field.
      typed: false,
    };

    function blankLabelText() {
      const label = settings.blankLabel ? settings.blankLabel() : null;
      return label || '';
    }

    function rowsFor(query) {
      const matches = Search.search(query, I18n.language()).map((entry) => ({
        code: entry.code,
        label: currencyLabel(entry.code),
        description: entry.description,
      }));
      // The blank row is an escape hatch, not a search result: it sits at the
      // top while nothing is typed and drops away once something is.
      const blank = blankLabelText();
      const head = !query && blank ? [{ code: '', label: blank, description: '' }] : [];
      return head.concat(matches);
    }

    function renderList() {
      list.replaceChildren();
      picker.rows.forEach((row, index) => {
        const item = document.createElement('li');
        item.id = id + '-opt-' + index;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(row.code === picker.code));
        item.dataset.code = row.code;
        if (index === picker.active) item.classList.add('active');

        const label = document.createElement('span');
        label.className = 'combo-label';
        label.textContent = row.label;
        item.append(label);

        if (row.description) {
          const description = document.createElement('span');
          description.className = 'combo-description';
          description.textContent = row.description;
          item.append(description);
        }
        list.append(item);
      });

      const active = picker.active >= 0 ? list.children[picker.active] : null;
      input.setAttribute('aria-activedescendant', active ? active.id : '');
      if (active && typeof active.scrollIntoView === 'function') {
        active.scrollIntoView({ block: 'nearest' });
      }
    }

    /**
     * Opens upwards when there is no room below. The list is absolutely
     * positioned, so it cannot make the popup taller the way a <select> made
     * the browser find space -- without this, the site and home pickers sit far
     * enough down the panel that their list would be cut off by the window edge.
     */
    function placeList() {
      if (typeof input.getBoundingClientRect !== 'function') return;
      const view = input.ownerDocument.defaultView;
      const viewport = view && view.innerHeight;
      if (!viewport) return;
      const rect = input.getBoundingClientRect();
      const below = viewport - rect.bottom;
      const needed = Math.min(LIST_MAX_HEIGHT, picker.rows.length * ROW_HEIGHT);
      list.classList.toggle('up', below < needed && rect.top > below);
    }

    function show(query) {
      picker.rows = rowsFor(query);
      // Opening lands on what is already chosen, so arrows start from there.
      // Once something is typed the top row wins instead: it is the best match
      // by ranking, and Enter should take the obvious thing rather than whatever
      // happened to be selected before.
      const current = picker.typed
        ? -1
        : picker.rows.findIndex((row) => row.code === picker.code);
      picker.active = current >= 0 ? current : picker.rows.length ? 0 : -1;
      picker.open = true;
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      renderList();
      placeList();
    }

    function close() {
      picker.open = false;
      picker.typed = false;
      list.hidden = true;
      list.replaceChildren();
      input.setAttribute('aria-expanded', 'false');
      input.setAttribute('aria-activedescendant', '');
      input.value = picker.code ? currencyLabel(picker.code) : blankLabelText();
    }

    function choose(index) {
      const row = picker.rows[index];
      if (!row) return;
      const changed = row.code !== picker.code;
      picker.code = row.code;
      close();
      if (changed && settings.onChange) settings.onChange(picker.code);
    }

    function move(step) {
      if (!picker.open) {
        show(picker.typed ? input.value : '');
        return;
      }
      if (!picker.rows.length) return;
      const count = picker.rows.length;
      picker.active = (picker.active + step + count) % count;
      renderList();
    }

    input.addEventListener('focus', () => show(''));
    input.addEventListener('click', () => {
      if (!picker.open) show(picker.typed ? input.value : '');
    });
    input.addEventListener('input', () => {
      picker.typed = true;
      show(input.value);
    });

    input.addEventListener('keydown', (event) => {
      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          move(1);
          break;
        case 'ArrowUp':
          event.preventDefault();
          move(-1);
          break;
        case 'Enter':
          if (picker.open) {
            event.preventDefault();
            choose(picker.active);
          }
          break;
        case 'Escape':
          if (picker.open) {
            event.preventDefault();
            close();
          }
          break;
        case 'Tab':
          if (picker.open) close();
          break;
        default:
          break;
      }
    });

    // A half-typed query must not survive leaving the field. mousedown on the
    // list is swallowed so the click lands before the blur empties it.
    input.addEventListener('blur', () => {
      if (picker.open) close();
    });
    list.addEventListener('mousedown', (event) => event.preventDefault());
    list.addEventListener('click', (event) => {
      const item = event.target.closest('[role="option"]');
      if (item) choose([...list.children].indexOf(item));
    });

    const controller = {
      value: () => picker.code,
      setValue: (code) => {
        picker.code = code || '';
        if (picker.open) show(picker.typed ? input.value : '');
        else close();
      },
      // Labels and the search index are both language-dependent, so a language
      // change re-reads them rather than leaving English rows behind.
      refresh: () => {
        picker.code = picker.code || '';
        close();
      },
    };
    pickers[id] = controller;
    return controller;
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
    $('overflow').textContent =
      bar.overflowDays > 0 ? I18n.t('result.overflowDays', { days: bar.overflowDays }) : '';
  }

  function runCheck() {
    const raw = $('price').value;
    const input = readInput(raw, pickers['source-currency'].value());

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
      $('no-rate').textContent = I18n.t('rates.noRateFor', { code: input.currency });
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

    $('time').textContent = I18n.formatHoursMinutes(time.totalHours);
    $('framing').textContent = I18n.render(
      Calc.framing(time.totalHours, state.settings.hoursPerWeek)
    );
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
      ? I18n.t('history.total', { time: I18n.formatHoursMinutes(totalHours) })
      : '';

    list.replaceChildren();
    state.history.forEach((entry) => {
      const row = document.createElement('li');
      const price = document.createElement('span');
      price.textContent = entry.rawInput + ' ' + entry.srcCurrency;
      const time = document.createElement('span');
      time.textContent = I18n.formatBadge(entry.totalHours, state.settings.hoursPerWeek);
      row.append(price, time);
      list.append(row);
    });
  }

  // --- rate status -----------------------------------------------------------

  function renderRateStatus() {
    const line = $('rate-status');
    if (!state.cache || !state.cache.rates) {
      line.textContent = I18n.t('rates.none');
      line.classList.add('warn');
      return;
    }
    line.textContent = I18n.t('rates.updated', {
      date: state.cache.rateDate || I18n.t('rates.unknownDate'),
      source: sourceLabel(state.cache.source),
    });
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
    pickers['site-currency'].setValue(site.forceCurrency || '');
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
    pickers['source-currency'].setValue(state.settings.homeCurrency);
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
    pickers['home-currency'].setValue(state.settings.homeCurrency);
    fillLanguageSelect();
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
      homeCurrency: pickers['home-currency'].value() || 'USD',
      overlayEnabled: $('overlay-enabled').checked,
      language: state.settings.language,
    };

    if (Calc.hourlyRate(candidate) <= 0) {
      $('settings-error').hidden = false;
      $('settings-error').textContent =
        mode === 'hourly' ? I18n.t('settings.errorHourly') : I18n.t('settings.errorMonthly');
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

  function buildPickers() {
    createPicker('source-currency', { onChange: runCheck });
    createPicker('home-currency', {});
    createPicker('site-currency', {
      // Read through a function rather than captured once, so the row follows a
      // language change like every other string does.
      blankLabel: () => I18n.t('site.autoDetect'),
      onChange: (code) => updateSite({ forceCurrency: code || null }),
    });
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

    $('share').addEventListener('click', async () => {
      if (!state.lastResult) return;
      const result = state.lastResult;
      const price = `${result.rawInput} ${result.srcCurrency}`;
      const time = I18n.formatHoursMinutes(result.totalHours);
      try {
        await navigator.clipboard.writeText(I18n.t('share.clipboard', { price, time }));
        $('share').textContent = I18n.t('result.copied');
        window.setTimeout(() => {
          $('share').textContent = I18n.t('result.copy');
        }, 1200);
      } catch {
        $('share').textContent = I18n.t('result.copyFailed');
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
      $('refresh').textContent = I18n.t('rates.refresh');
    });

    // Saved on change rather than on SAVE. It is a display preference, not part
    // of the income the SAVE button validates, and switching it has to show the
    // result at once -- leaving it unsaved would mean BACK silently reverting a
    // language the user is already reading.
    $('language').addEventListener('change', async (event) => {
      const language = I18n.setLanguage(event.target.value);
      state.settings = Object.assign({}, state.settings, { language: language });
      await save(SETTINGS_KEY, state.settings);
      applyTranslations();
      fillLanguageSelect();
      Search.clearCache();
      Object.keys(pickers).forEach((id) => pickers[id].refresh());
      renderHistory();
      renderRateStatus();
      renderSite();
      runCheck();
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
    applyTranslations();
    buildPickers();
    wire();
    if (isConfigured(state.settings)) {
      showMain();
    } else {
      showSettings(true);
    }
  }

  start();
})();
