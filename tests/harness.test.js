'use strict';

// The mock shops in docs/amo/harness/, badged by the real content script.
//
// They are the pages the store screenshots are taken on, one per market, each
// writing prices the way that market does. A shop that silently stopped
// producing its badges would only show up as a wrong screenshot on a public
// listing, so each page is held to its count here, and every badge to the
// currency the page is in.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const SCRIPTS = [
  'lib/currencies.js',
  'lib/parser.js',
  'lib/calc.js',
  'lib/i18n.js',
  'lib/rates.js',
  'content/content.js',
].map(read);

const RATES = JSON.parse(read('lib/rates-snapshot.json')).rates;

// Each page, the currency all its prices are in, and a home currency other than
// that one, so every badge's tooltip names the rate it converted from.
const SHOPS = [
  { file: 'se-shop.html', currency: 'SEK', home: 'SEK' },
  { file: 'us-shop.html', currency: 'USD', home: 'SEK' },
  { file: 'de-shop.html', currency: 'EUR', home: 'USD' },
  { file: 'fr-shop.html', currency: 'EUR', home: 'USD' },
  { file: 'es-shop.html', currency: 'EUR', home: 'USD' },
  { file: 'br-shop.html', currency: 'BRL', home: 'USD' },
  { file: 'jp-shop.html', currency: 'JPY', home: 'USD' },
  { file: 'cn-shop.html', currency: 'CNY', home: 'USD' },
  { file: 'tw-shop.html', currency: 'TWD', home: 'USD' },
];

// docs/amo/README.md promises this many on every page.
const BADGES_PER_SHOP = 9;

/** Loads a shop the way the screenshots do: from localhost, so no country TLD helps. */
async function badgeShop(file, home) {
  const dom = new JSDOM(read(path.join('docs/amo/harness', file)), {
    url: `http://127.0.0.1:8000/docs/amo/harness/${file}`,
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const stored = {
    settings: {
      incomeMode: 'monthly',
      monthly: 25000,
      hourly: '',
      hoursPerWeek: 40,
      homeCurrency: home,
      overlayEnabled: true,
      language: 'en',
    },
    sites: {},
    ratesCache: {
      base: 'USD',
      rates: RATES,
      rateDate: '2026-11-05',
      source: 'er-api',
      fetchedAt: Date.now(),
    },
  };
  dom.window.browser = {
    storage: {
      local: {
        get: async (keys) => {
          const out = {};
          (Array.isArray(keys) ? keys : [keys]).forEach((key) => {
            if (stored[key] !== undefined) out[key] = stored[key];
          });
          return out;
        },
        set: async () => {},
      },
      onChanged: { addListener() {} },
    },
    runtime: { sendMessage: async () => null, onMessage: { addListener() {} } },
  };
  SCRIPTS.forEach((source) => dom.window.eval(source));
  await new Promise((resolve) => setTimeout(resolve, 150));
  return [...dom.window.document.querySelectorAll('[data-worthit-badge]')];
}

SHOPS.forEach(({ file, currency, home }) => {
  test(`${file} gets its ${BADGES_PER_SHOP} badges, all read as ${currency}`, async () => {
    const badges = await badgeShop(file, home);
    const prices = badges.map((badge) => badge.getAttribute('title').split('\n')[1]);
    assert.equal(badges.length, BADGES_PER_SHOP, `badged: ${prices.join(' | ')}`);

    badges.forEach((badge, index) => {
      const title = badge.getAttribute('title');
      if (currency === home) {
        assert.doesNotMatch(title, /^1 [A-Z]{3} = /m, `${prices[index]} was converted`);
      } else {
        assert.match(title, new RegExp(`^1 ${currency} = `, 'm'), `${prices[index]}: ${title}`);
      }
    });
  });
});

test('every page in the harness is tested', () => {
  const pages = fs
    .readdirSync(path.join(root, 'docs/amo/harness'))
    .filter((name) => name.endsWith('.html'))
    .sort();
  assert.deepEqual(pages, SHOPS.map((shop) => shop.file).sort());
});

test('nothing that only looks like a price is badged', async () => {
  // Every shop's footer carries a date, a phone number, an order number and a
  // model name in its own market's format. None of them may get a badge.
  for (const { file, home } of SHOPS) {
    const badges = await badgeShop(file, home);
    const inFooter = badges.filter((badge) => badge.closest('footer'));
    assert.deepEqual(
      inFooter.map((badge) => badge.parentElement.textContent),
      [],
      `${file}: a footer item was badged`
    );
  }
});
