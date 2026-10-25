'use strict';

// The flag shown beside each currency in the popup, and the table it comes from.
//
// Flags are derived, not stored: a region's alpha-2 code maps arithmetically onto
// the two Unicode regional indicator symbols that compose a flag, so nothing new
// ships in the extension. These tests pin the table's completeness, the arithmetic,
// and what the popup actually renders -- the last one through jsdom, against the
// same five scripts popup.html loads.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');

require('../lib/currencies.js');
const Currencies = globalThis.WorthItCurrencies;

const INDICATOR_A = 0x1f1e6;

// --- the table -------------------------------------------------------------

test('every currency either has a region or opts out by name', () => {
  // A missing region is indistinguishable from a deliberate one at render time --
  // both draw nothing -- so the opt-out is explicit and this test is the only
  // thing standing between a typo in the table and a silently flagless row.
  const unflagged = Currencies.CURRENCIES.filter((currency) => !currency.region).map(
    (currency) => currency.code
  );
  assert.deepEqual(unflagged.sort(), [...Currencies.NO_FLAG].sort());
});

test('NO_FLAG names only codes that exist', () => {
  Currencies.NO_FLAG.forEach((code) => {
    assert.ok(Currencies.BY_CODE[code], `${code} is not a currency`);
  });
});

test('every region is a well-formed alpha-2 code', () => {
  Currencies.CURRENCIES.forEach((currency) => {
    if (!currency.region) return;
    assert.match(
      currency.region,
      /^[A-Z]{2}$/,
      `${currency.code} has region ${JSON.stringify(currency.region)}`
    );
  });
});

test('the region table does not reach for currencies that do not exist', () => {
  // The table is written by hand as 'CODE:REGION' pairs; a code typo would
  // otherwise sit there inert, with the real currency left flagless.
  const codes = new Set(Currencies.CURRENCIES.map((currency) => currency.code));
  const source = fs.readFileSync(path.join(root, 'lib/currencies.js'), 'utf8');
  const table = source.slice(source.indexOf('const CODE_REGION'), source.indexOf('.split('));
  [...table.matchAll(/([A-Z]{3}):([A-Z]{2})/g)].forEach((match) => {
    assert.ok(codes.has(match[1]), `${match[1]} is in CODE_REGION but not a currency`);
  });
});

test('region is a label and takes no part in parsing', () => {
  // currencyForLocale answers the opposite question off a different, smaller map.
  // The two must not quietly become one: REGION_CURRENCY is many-to-one onto EUR
  // and covers 71 regions, while every currency needs a region of its own.
  assert.equal(Currencies.BY_CODE.SEK.region, 'SE');
  assert.equal(Currencies.currencyForLocale('sv-SE'), 'SEK');
  assert.equal(Currencies.BY_CODE.DE, undefined);
  assert.ok(
    Object.keys(Currencies.REGION_CURRENCY).length < Currencies.CURRENCIES.length,
    'REGION_CURRENCY is not a substitute for the per-currency region'
  );
});

// --- flagFor ---------------------------------------------------------------

test('a flag is the two regional indicators for its region', () => {
  const cases = [
    ['SE', '\u{1F1F8}\u{1F1EA}'],
    ['US', '\u{1F1FA}\u{1F1F8}'],
    ['EU', '\u{1F1EA}\u{1F1FA}'],
    ['JP', '\u{1F1EF}\u{1F1F5}'],
    ['GB', '\u{1F1EC}\u{1F1E7}'],
    ['AE', '\u{1F1E6}\u{1F1EA}'],
  ];
  cases.forEach(([region, expected]) => {
    assert.equal(Currencies.flagFor(region), expected, region);
  });
});

test('every flag is exactly two regional indicator codepoints', () => {
  Currencies.CURRENCIES.forEach((currency) => {
    const flag = Currencies.flagFor(currency.region);
    if (!currency.region) {
      assert.equal(flag, '', `${currency.code} should have no flag`);
      return;
    }
    const points = [...flag].map((char) => char.codePointAt(0));
    assert.equal(points.length, 2, `${currency.code} drew ${points.length} codepoints`);
    points.forEach((point) => {
      assert.ok(
        point >= INDICATOR_A && point <= INDICATOR_A + 25,
        `${currency.code} drew U+${point.toString(16)}, not a regional indicator`
      );
    });
  });
});

test('a region is lower-case tolerant, since locale tags are not uppercase', () => {
  assert.equal(Currencies.flagFor('se'), Currencies.flagFor('SE'));
});

test('bad input yields no flag rather than a mojibake pair', () => {
  // Every one of these would otherwise compose some codepoint and render as
  // garbage: the arithmetic is unbounded without the guard.
  [null, undefined, '', 'S', 'SWE', 'S1', '12', 'é!', 0, 42, {}, [], ['S', 'E'], NaN].forEach(
    (input) => {
      assert.equal(Currencies.flagFor(input), '', JSON.stringify(input));
    }
  );
});

test('flagForCurrency resolves through the code, and tolerates an unknown one', () => {
  assert.equal(Currencies.flagForCurrency('SEK'), '\u{1F1F8}\u{1F1EA}');
  assert.equal(Currencies.flagForCurrency('EUR'), '\u{1F1EA}\u{1F1FA}');
  assert.equal(Currencies.flagForCurrency('XDR'), '');
  assert.equal(Currencies.flagForCurrency('ZZZ'), '');
  assert.equal(Currencies.flagForCurrency(''), '');
  assert.equal(Currencies.flagForCurrency(null), '');
});

test('the cases the issue called out are the ones they were meant to be', () => {
  assert.equal(Currencies.BY_CODE.EUR.region, 'EU', 'the euro is a union, not a country');
  assert.equal(Currencies.BY_CODE.USD.region, 'US', 'the issuer, not the largest user');
  // Both leones are Sierra Leone's; many-to-one is correct in this direction.
  assert.equal(Currencies.BY_CODE.SLE.region, 'SL');
  assert.equal(Currencies.BY_CODE.SLL.region, 'SL');
  // Crown dependencies have their own codes and their own flags.
  assert.equal(Currencies.BY_CODE.GGP.region, 'GG');
  assert.equal(Currencies.BY_CODE.IMP.region, 'IM');
  assert.equal(Currencies.BY_CODE.JEP.region, 'JE');
  // The Netherlands Antilles were dissolved; AN is not a region code any more.
  assert.equal(Currencies.BY_CODE.ANG.region, 'CW');
  // Supranational, so no flag at any level.
  ['XAF', 'XOF', 'XPF', 'XCD', 'XCG', 'XDR'].forEach((code) => {
    assert.equal(Currencies.BY_CODE[code].region, null, code);
  });
});

// --- what the popup renders ------------------------------------------------

const SCRIPTS = [
  'lib/currencies.js',
  'lib/parser.js',
  'lib/calc.js',
  'lib/i18n.js',
  'lib/search.js',
  'lib/rates.js',
  'popup/popup.js',
].map((file) => fs.readFileSync(path.join(root, file), 'utf8'));

const STORED = {
  settings: {
    incomeMode: 'monthly',
    monthly: 25000,
    hourly: '',
    hoursPerWeek: 40,
    homeCurrency: 'SEK',
    overlayEnabled: true,
  },
  sites: {},
  history: [],
};

/** Boots the real popup over its real HTML, and hands back the document. */
async function openPopup() {
  const dom = new JSDOM(fs.readFileSync(path.join(root, 'popup/popup.html'), 'utf8'), {
    runScripts: 'outside-only',
    url: 'moz-extension://worthit/popup/popup.html',
  });
  const { window } = dom;
  window.browser = {
    storage: {
      local: {
        get: async () => JSON.parse(JSON.stringify(STORED)),
        set: async () => {},
      },
      onChanged: { addListener() {} },
    },
    tabs: { query: async () => [{ url: 'https://butik.example.se/p/1' }] },
    runtime: { sendMessage: async () => null },
  };
  SCRIPTS.forEach((source) => window.eval(source));
  // start() is async, so let its microtasks drain before reading the DOM.
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  return window.document;
}

/**
 * Opens a picker and returns its rows. The pickers build their list on focus,
 * and jsdom will not focus anything inside a hidden subtree, so the pane that
 * holds the picker has to be the visible one first: home-currency is on the
 * settings pane and the other two are on the main pane.
 */
function rowsOf(document, id) {
  const wantSettings = id === 'home-currency';
  const onSettings = !document.getElementById('view-settings').hidden;
  if (wantSettings && !onSettings) document.getElementById('open-settings').click();
  if (!wantSettings && onSettings) document.getElementById('cancel-settings').click();
  document.getElementById(id).focus();
  return [...document.querySelectorAll('#' + id + '-list [role="option"]')].map((item) => ({
    code: item.dataset.code,
    label: item.querySelector('.combo-label').textContent,
    description: item.querySelector('.combo-description')
      ? item.querySelector('.combo-description').textContent
      : '',
  }));
}

test('every currency picker shows a flag, the code and the symbol', async () => {
  const document = await openPopup();
  ['source-currency', 'site-currency', 'home-currency'].forEach((id) => {
    const rows = rowsOf(document, id).filter((row) => row.code);
    assert.equal(rows.length, Currencies.CURRENCIES.length, `${id} is short of rows`);

    const byCode = (code) => rows.find((row) => row.code === code);
    assert.equal(byCode('SEK').label, '\u{1F1F8}\u{1F1EA} SEK kr', id);
    assert.equal(byCode('EUR').label, '\u{1F1EA}\u{1F1FA} EUR €', id);
    assert.equal(byCode('USD').label, '\u{1F1FA}\u{1F1F8} USD $', id);
  });
});

test('a currency with no flag starts at its code, with nothing padded in', async () => {
  const document = await openPopup();
  const xdr = rowsOf(document, 'home-currency').find((row) => row.code === 'XDR');
  assert.equal(xdr.label, 'XDR');
});

test('the picker value stays the bare code, so stored settings are unaffected', async () => {
  // The flag and the country name are presentation only. If either leaked into
  // the value, every homeCurrency written to storage would stop resolving.
  const document = await openPopup();
  rowsOf(document, 'home-currency').forEach((row) => {
    if (!row.code) return;
    assert.match(row.code, /^[A-Z]{3}$/);
  });
  const input = document.getElementById('home-currency');
  assert.equal(input.value, '\u{1F1F8}\u{1F1EA} SEK kr', 'the field reads as a label');
  input.blur();
  assert.equal(input.value, '\u{1F1F8}\u{1F1EA} SEK kr');
});

test('the blank "Auto-detect" row is still there and still blank', async () => {
  const document = await openPopup();
  const first = rowsOf(document, 'site-currency')[0];
  assert.equal(first.code, '');
  assert.equal(first.label, 'Auto-detect');
});
