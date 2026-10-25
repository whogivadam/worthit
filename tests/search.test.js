'use strict';

// Finding a currency by typing, and the combobox that does it.
//
// Two halves: the ranked matcher in lib/search.js, and the picker in the popup
// driven through jsdom by the keys a person would actually press. The ranking
// tests are the ones that matter -- a matcher that merely finds SEK somewhere in
// 162 results is no better than the scrolling it replaced.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

require('../lib/currencies.js');
const Currencies = globalThis.WorthItCurrencies;
const search = require('../lib/search.js');

/** The codes a query finds, best first. */
const codes = (query, language) =>
  search.search(query, language || 'en').map((entry) => entry.code);
const first = (query, language) => codes(query, language)[0];

test.afterEach(() => search.clearCache());

// --- what the issue asked for ----------------------------------------------

test('every way of spelling the Swedish krona finds it first', () => {
  ['SEK', 'sek', 'Sek', ' sek ', 'SE', 'Sweden', 'sweden', 'SWEDEN'].forEach((query) => {
    assert.equal(first(query), 'SEK', JSON.stringify(query));
  });
  // its own name, in whole or in part
  assert.ok(codes('swedish krona').includes('SEK'));
  assert.ok(codes('krona').includes('SEK'));
  // and the symbol, which four currencies share
  assert.ok(codes('kr').includes('SEK'));
});

test('the same holds in Swedish, off the Swedish names', () => {
  ['SEK', 'Sverige', 'sverige', 'svensk krona'].forEach((query) => {
    assert.equal(first(query, 'sv'), 'SEK', JSON.stringify(query));
  });
});

test('short and long country names both work', () => {
  // Intl gives 'UK' for style short and 'United Kingdom' for long; both index.
  assert.equal(first('uk'), 'GBP');
  assert.equal(first('united kingdom'), 'GBP');
  assert.equal(first('us'), 'USD');
  assert.equal(first('united states'), 'USD');
  assert.equal(first('USA', 'sv'), 'USD');
});

// --- ranking ---------------------------------------------------------------

test('an exact code wins outright', () => {
  assert.equal(first('sek'), 'SEK');
  assert.equal(first('usd'), 'USD');
  assert.equal(first('all'), 'ALL', 'even when the code is an English word');
});

test('a code prefix beats a name buried in the middle', () => {
  // 'se' appears inside several country names; SEK must still come first.
  const result = codes('se');
  assert.equal(result[0], 'SEK');
  assert.ok(result.length > 1, 'the others should still be offered');
});

test('a whole symbol beats a code that merely starts the same', () => {
  // 'kr' starts KRW, but it *is* the symbol of four kronor. Typing it means
  // the symbol far more often than it means the Korean won.
  const result = codes('kr');
  assert.deepEqual(result.slice(0, 4), ['DKK', 'ISK', 'NOK', 'SEK']);
  assert.ok(result.includes('KRW'), 'KRW is still offered, just not first');
  assert.ok(result.indexOf('KRW') > result.indexOf('SEK'));
});

test('a single-letter symbol still resolves to its owner', () => {
  assert.equal(first('r'), 'ZAR', 'R is the rand');
});

test('a word inside a name ranks as a prefix, not as a substring', () => {
  assert.equal(first('emirates'), 'AED');
  assert.equal(first('kingdom'), 'GBP');
});

test('ties break on the code, so the order never wobbles', () => {
  assert.deepEqual(codes('kr'), codes('kr'), 'the same query twice');
  const ascending = codes('kr').slice(0, 4);
  assert.deepEqual(ascending, [...ascending].sort());
});

// --- folding ---------------------------------------------------------------

test('case and diacritics are folded away', () => {
  assert.equal(search.fold('Curaçao'), 'curacao');
  assert.equal(search.fold('Österrike'), 'osterrike');
  assert.equal(search.fold('Türkiye'), 'turkiye');
  assert.equal(search.fold('  SÃO TOMÉ  '), 'sao tome');
  assert.equal(search.fold(null), '');
  assert.equal(search.fold(undefined), '');
  assert.equal(search.fold(42), '42');
});

test('a keyboard without the accents still finds the country', () => {
  assert.equal(first('curacao'), 'ANG');
  assert.equal(first('curaçao'), 'ANG');
  assert.equal(first('turkiye'), 'TRY');
  assert.equal(first('osterrike', 'sv'), 'EUR', 'Austria spends euros');
});

// --- the currencies that need more than their own region --------------------

test('a currency is findable from every country that spends it', () => {
  // EUR is issued by no single country. Indexed only as "European Union" it
  // would be unreachable by the name anyone would actually type.
  ['Germany', 'germany', 'Austria', 'Italy', 'Ireland', 'Finland'].forEach((query) => {
    assert.ok(codes(query).includes('EUR'), `${query} should find EUR`);
  });
  ['Tyskland', 'Frankrike', 'Italien'].forEach((query) => {
    assert.ok(codes(query, 'sv').includes('EUR'), `${query} should find EUR`);
  });
  assert.equal(first('european union'), 'EUR');
});

test('the crown dependencies are findable by country, having no currency name', () => {
  // CLDR has no currency name for GGP, IMP or JEP, so the country is the only
  // name they have. Checked here because it is the one gap in Intl's coverage.
  assert.equal(first('guernsey'), 'GGP');
  assert.equal(first('isle of man'), 'IMP');
  assert.equal(first('jersey'), 'JEP');
});

test('a currency with no country falls back to its own name', () => {
  const index = search.indexFor('en');
  const byCode = (code) => index.find((entry) => entry.code === code);
  assert.equal(byCode('SEK').description, 'Sweden');
  assert.equal(byCode('EUR').description, 'European Union');
  // the supranational six have no flag and no country; the currency names them
  assert.match(byCode('XOF').description, /CFA/);
  assert.match(byCode('XDR').description, /Drawing Rights/);
  assert.equal(byCode('GGP').description, 'Guernsey');
});

// --- the edges -------------------------------------------------------------

test('an empty query is the whole list, in table order', () => {
  const all = codes('');
  assert.equal(all.length, Currencies.CURRENCIES.length);
  assert.deepEqual(
    all,
    Currencies.CURRENCIES.map((currency) => currency.code),
    'unfiltered means unsorted, as the picker showed before'
  );
  assert.deepEqual(codes('   '), all, 'whitespace is not a query');
  assert.deepEqual(codes(null), all);
  assert.deepEqual(codes(undefined), all);
});

test('a query that matches nothing returns nothing, not everything', () => {
  assert.deepEqual(codes('zzzzz'), []);
  assert.deepEqual(codes('qqq'), []);
  assert.deepEqual(codes('!!!'), []);
});

test('every currency is reachable by its own code', () => {
  Currencies.CURRENCIES.forEach((currency) => {
    assert.equal(first(currency.code), currency.code, currency.code);
  });
});

test('the index is language-scoped, and cleared on demand', () => {
  assert.equal(first('Sweden', 'en'), 'SEK');
  assert.equal(first('Sverige', 'sv'), 'SEK');
  assert.deepEqual(codes('Sverige', 'en'), [], 'English does not carry Swedish names');
  search.clearCache();
  assert.equal(first('Sverige', 'sv'), 'SEK', 'and rebuilds after a clear');
});

test('no country or currency names are shipped in the repo', () => {
  // The whole point of Intl.DisplayNames here: 162 currencies x 2 languages of
  // names, at no cost in the zip. A name hard-coded in the source would be the
  // beginning of a table nobody maintains.
  const source = read('lib/search.js');
  ['Sweden', 'Sverige', 'United Kingdom', 'Swedish Krona'].forEach((name) => {
    const body = source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!body.includes(name), `lib/search.js should not hard-code ${name}`);
  });
  assert.match(source, /Intl\.DisplayNames/);
});

// --- the picker in the popup -----------------------------------------------

const SCRIPTS = [
  'lib/currencies.js',
  'lib/parser.js',
  'lib/calc.js',
  'lib/i18n.js',
  'lib/search.js',
  'lib/rates.js',
  'popup/popup.js',
].map((file) => read(file));

const STORED = {
  settings: {
    incomeMode: 'monthly',
    monthly: 25000,
    hourly: '',
    hoursPerWeek: 40,
    homeCurrency: 'SEK',
    overlayEnabled: true,
    language: 'en',
  },
  sites: {},
  history: [],
  ratesCache: {
    base: 'USD',
    rates: { USD: 1, SEK: 9.8785, EUR: 0.89015 },
    rateDate: '2026-10-25',
    source: 'er-api',
    fetchedAt: Date.now(),
  },
};

async function openPopup() {
  const dom = new JSDOM(read('popup/popup.html'), {
    runScripts: 'outside-only',
    url: 'moz-extension://worthit/popup/popup.html',
  });
  const { window } = dom;
  const saved = [];
  let stored = JSON.parse(JSON.stringify(STORED));
  window.browser = {
    storage: {
      local: {
        get: async () => JSON.parse(JSON.stringify(stored)),
        set: async (update) => {
          saved.push(update);
          stored = Object.assign(stored, update);
        },
      },
      onChanged: { addListener() {} },
    },
    tabs: { query: async () => [{ url: 'https://butik.example.se/p/1' }] },
    runtime: { sendMessage: async () => null },
  };
  SCRIPTS.forEach((source) => window.eval(source));
  await new Promise((resolve) => window.setTimeout(resolve, 0));

  const document = window.document;
  const api = {
    window,
    document,
    saved,
    settings: () => document.getElementById('open-settings').click(),
    input: (id) => document.getElementById(id),
    rows: (id) => [...document.querySelectorAll('#' + id + '-list [role="option"]')],
    labels: (id) => api.rows(id).map((row) => row.querySelector('.combo-label').textContent),
    type: (id, text) => {
      const input = api.input(id);
      input.value = text;
      input.dispatchEvent(new window.Event('input'));
    },
    key: (id, name) =>
      api
        .input(id)
        .dispatchEvent(new window.KeyboardEvent('keydown', { key: name, bubbles: true })),
    active: (id) => {
      const current = api.input(id).getAttribute('aria-activedescendant');
      return current ? document.getElementById(current) : null;
    },
  };
  return api;
}

test('the picker opens on focus with every currency, and says so to aria', async () => {
  const page = await openPopup();
  const input = page.input('source-currency');
  assert.equal(input.getAttribute('role'), 'combobox');
  assert.equal(input.getAttribute('aria-expanded'), 'false');
  assert.equal(page.rows('source-currency').length, 0, 'nothing is built until needed');

  input.focus();
  assert.equal(input.getAttribute('aria-expanded'), 'true');
  assert.equal(page.rows('source-currency').length, Currencies.CURRENCIES.length);
  assert.equal(input.getAttribute('aria-controls'), 'source-currency-list');
});

test('the open picker starts on the currency already chosen', async () => {
  const page = await openPopup();
  page.input('source-currency').focus();
  const active = page.active('source-currency');
  assert.equal(active.dataset.code, 'SEK');
  assert.equal(active.getAttribute('aria-selected'), 'true');
});

test('typing a country name filters the list down to it', async () => {
  const page = await openPopup();
  page.input('source-currency').focus();
  page.type('source-currency', 'sweden');
  assert.deepEqual(
    page.rows('source-currency').map((row) => row.dataset.code),
    ['SEK']
  );
  assert.equal(page.labels('source-currency')[0], '\u{1F1F8}\u{1F1EA} SEK kr');
});

test('a row shows the country beside the code', async () => {
  const page = await openPopup();
  page.input('source-currency').focus();
  page.type('source-currency', 'sek');
  const row = page.rows('source-currency')[0];
  assert.equal(row.querySelector('.combo-label').textContent, '\u{1F1F8}\u{1F1EA} SEK kr');
  assert.equal(row.querySelector('.combo-description').textContent, 'Sweden');
});

test('arrows move the active row, Enter takes it', async () => {
  const page = await openPopup();
  const input = page.input('source-currency');
  input.focus();
  page.type('source-currency', 'kr');
  const shown = page.rows('source-currency').map((row) => row.dataset.code);
  // the four kronor by symbol, then KRW by code prefix, then Ukraine by name
  assert.deepEqual(shown.slice(0, 5), ['DKK', 'ISK', 'NOK', 'SEK', 'KRW']);
  const last = shown[shown.length - 1];

  assert.equal(page.active('source-currency').dataset.code, 'DKK');
  page.key('source-currency', 'ArrowDown');
  assert.equal(page.active('source-currency').dataset.code, 'ISK');
  page.key('source-currency', 'ArrowUp');
  assert.equal(page.active('source-currency').dataset.code, 'DKK');
  // and it wraps rather than sticking at the end
  page.key('source-currency', 'ArrowUp');
  assert.equal(page.active('source-currency').dataset.code, last);

  const chosen = page.active('source-currency').querySelector('.combo-label').textContent;
  page.key('source-currency', 'Enter');
  assert.equal(input.getAttribute('aria-expanded'), 'false');
  assert.equal(input.value, chosen, 'the field shows the row that was active');
  assert.ok(input.value.includes(last), `expected ${last} in ${input.value}`);
  assert.equal(page.rows('source-currency').length, 0, 'and the list is gone');
});

test('Escape closes without changing the choice', async () => {
  const page = await openPopup();
  const input = page.input('source-currency');
  input.focus();
  page.type('source-currency', 'yen');
  assert.ok(page.rows('source-currency').length);

  page.key('source-currency', 'Escape');
  assert.equal(input.getAttribute('aria-expanded'), 'false');
  assert.equal(input.value, '\u{1F1F8}\u{1F1EA} SEK kr', 'the old choice is restored');
  assert.equal(input.getAttribute('aria-activedescendant'), '');
});

test('leaving the field abandons a half-typed query', async () => {
  const page = await openPopup();
  const input = page.input('source-currency');
  input.focus();
  page.type('source-currency', 'swed');
  input.blur();
  assert.equal(input.value, '\u{1F1F8}\u{1F1EA} SEK kr');
  assert.equal(input.getAttribute('aria-expanded'), 'false');
});

test('clicking a row takes it', async () => {
  const page = await openPopup();
  const input = page.input('source-currency');
  input.focus();
  page.type('source-currency', 'japan');
  const row = page.rows('source-currency')[0];
  assert.equal(row.dataset.code, 'JPY');
  row.dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
  // the label carries the last symbol in the table, the fullwidth yen sign
  assert.equal(input.value, '\u{1F1EF}\u{1F1F5} JPY \uFFE5');
});

test('a query matching nothing leaves an empty list rather than every currency', async () => {
  const page = await openPopup();
  page.input('source-currency').focus();
  page.type('source-currency', 'zzzzz');
  assert.deepEqual(page.rows('source-currency'), []);
  assert.equal(page.active('source-currency'), null);
  // and Enter on nothing does not throw or choose something at random
  assert.doesNotThrow(() => page.key('source-currency', 'Enter'));
  assert.equal(page.input('source-currency').value, 'zzzzz');
});

test('the site picker keeps its blank row, and only while nothing is typed', async () => {
  const page = await openPopup();
  page.input('site-currency').focus();
  const rows = page.rows('site-currency');
  assert.equal(rows.length, Currencies.CURRENCIES.length + 1);
  assert.equal(rows[0].dataset.code, '');
  assert.equal(rows[0].querySelector('.combo-label').textContent, 'Auto-detect');

  page.type('site-currency', 'sek');
  assert.deepEqual(
    page.rows('site-currency').map((row) => row.dataset.code),
    ['SEK'],
    'the blank row is not a search result'
  );
});

test('what reaches storage is still a bare ISO code', async () => {
  const page = await openPopup();
  page.settings();
  const input = page.input('home-currency');
  input.focus();
  page.type('home-currency', 'japan');
  page.key('home-currency', 'Enter');

  page.document.getElementById('save-settings').click();
  await new Promise((resolve) => page.window.setTimeout(resolve, 0));

  const settings = page.saved.filter((update) => update.settings).pop().settings;
  assert.equal(settings.homeCurrency, 'JPY');
  assert.match(settings.homeCurrency, /^[A-Z]{3}$/);
});

test('picking a currency for the site stores the code, and blank clears it', async () => {
  const page = await openPopup();
  page.input('site-currency').focus();
  page.type('site-currency', 'norway');
  page.key('site-currency', 'Enter');
  await new Promise((resolve) => page.window.setTimeout(resolve, 0));
  let sites = page.saved.filter((update) => update.sites).pop().sites;
  assert.equal(sites['butik.example.se'].forceCurrency, 'NOK');

  page.input('site-currency').focus();
  page.key('site-currency', 'ArrowUp');
  page.key('site-currency', 'ArrowDown');
  const rows = page.rows('site-currency');
  rows[0].dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
  await new Promise((resolve) => page.window.setTimeout(resolve, 0));
  sites = page.saved.filter((update) => update.sites).pop().sites;
  assert.equal(sites['butik.example.se'].forceCurrency, null, 'the blank row clears it');
});

test('the picker searches in the language the popup is in', async () => {
  const page = await openPopup();
  page.settings();
  page.document.getElementById('language').value = 'sv';
  page.document
    .getElementById('language')
    .dispatchEvent(new page.window.Event('change', { bubbles: true }));
  await new Promise((resolve) => page.window.setTimeout(resolve, 0));

  const input = page.input('home-currency');
  input.focus();
  page.type('home-currency', 'Tyskland');
  assert.deepEqual(
    page.rows('home-currency').map((row) => row.dataset.code),
    ['EUR'],
    'a Swedish country name should find the euro'
  );
  page.type('home-currency', 'sek');
  assert.equal(page.rows('home-currency')[0].querySelector('.combo-description').textContent, 'Sverige');
});

test('nothing in the picker is built from markup', async () => {
  const source = read('popup/popup.js');
  assert.deepEqual(source.match(/\.innerHTML\s*=/g) || [], []);
  assert.match(source, /createElement\('li'\)/);
});

test('the list opens upwards when there is no room below', async () => {
  // jsdom reports a zero-sized box, so this drives placeList() through a stubbed
  // rect: the real check is that the decision is made at all, and which way.
  const page = await openPopup();
  const input = page.input('home-currency');
  page.settings();

  const low = { top: 700, bottom: 720 };
  input.getBoundingClientRect = () => low;
  input.focus();
  const list = page.document.getElementById('home-currency-list');
  assert.ok(list.classList.contains('up'), 'a field near the bottom should flip');

  input.blur();
  input.getBoundingClientRect = () => ({ top: 40, bottom: 60 });
  input.focus();
  assert.ok(!list.classList.contains('up'), 'and a field near the top should not');
});
