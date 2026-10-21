'use strict';

// The overlay is the riskiest code in the extension: it mutates live pages,
// splits text nodes and listens to its own mutations. These tests run the real
// content script against a real DOM through jsdom, loading the same five files
// the manifest loads, in the same order.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const SCRIPTS = [
  'lib/currencies.js',
  'lib/parser.js',
  'lib/calc.js',
  'lib/rates.js',
  'content/content.js',
].map((file) => fs.readFileSync(path.join(root, file), 'utf8'));

const RATES = { USD: 1, SEK: 9.8785, EUR: 0.89015, JPY: 157.88, CAD: 1.4046, AUD: 1.4217 };

const DEFAULT_STORED = {
  settings: {
    incomeMode: 'monthly',
    monthly: 30000,
    hourly: '',
    hoursPerWeek: 40,
    homeCurrency: 'SEK',
    overlayEnabled: true,
  },
  sites: {},
  ratesCache: {
    base: 'USD',
    rates: RATES,
    rateDate: '2026-10-21',
    source: 'er-api',
    fetchedAt: Date.now(),
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Boots the content script over `body` with a stubbed `browser` API. */
async function mount(body, stored, options) {
  const settings = Object.assign({}, DEFAULT_STORED, stored || {});
  const config = options || {};
  const url = config.url || 'https://butik.example.se/produkt';
  const lang = config.lang === undefined ? 'sv' : config.lang;
  const head = config.head || '';

  const dom = new JSDOM(
    `<!doctype html><html${lang ? ` lang="${lang}"` : ''}><head>${head}</head><body>${body}</body></html>`,
    { url, runScripts: 'outside-only', pretendToBeVisual: true },
  );

  const listeners = [];
  dom.window.browser = {
    storage: {
      local: {
        get: async (keys) => {
          const out = {};
          (Array.isArray(keys) ? keys : [keys]).forEach((key) => {
            if (settings[key] !== undefined) out[key] = settings[key];
          });
          return out;
        },
        set: async () => {},
      },
      onChanged: {
        addListener: (fn) => listeners.push(fn),
      },
    },
  };

  SCRIPTS.forEach((source) => dom.window.eval(source));
  await sleep(120);

  return {
    dom,
    document: dom.window.document,
    badges: () => [...dom.window.document.querySelectorAll('[data-worthit-badge]')],
    labels: () =>
      [...dom.window.document.querySelectorAll('[data-worthit-badge]')].map((b) => b.textContent),
    /** Fires a storage change the way the popup would. */
    async change(changes) {
      Object.keys(changes).forEach((key) => {
        settings[key] = changes[key];
      });
      const payload = {};
      Object.keys(changes).forEach((key) => {
        payload[key] = { newValue: changes[key] };
      });
      await Promise.all(listeners.map((fn) => fn(payload, 'local')));
      await sleep(420);
    },
    async settle(ms) {
      await sleep(ms || 420);
    },
  };
}

// 30000/month at 40 h/week is 173.0769/h, and the home currency is SEK.
// 1299 SEK is therefore 7 h 30 min -> "7h30m".

test('a price in a text node gets one badge', async () => {
  const page = await mount('<p>Priset är 1 299 kr just nu.</p>');
  assert.deepEqual(page.labels(), ['7h30m']);
});

test('the badge lands immediately after the price, inside the same element', async () => {
  const page = await mount('<p>Priset är 1 299 kr just nu.</p>');
  const badge = page.badges()[0];
  assert.equal(badge.parentElement.tagName, 'P');
  assert.match(badge.previousSibling.nodeValue, /1 299 kr$/);
  assert.match(badge.nextSibling.nodeValue, /^ just nu\./);
});

test('several prices in one text node each get their own badge', async () => {
  const page = await mount('<p>Förr 1 299 kr, nu 649 kr.</p>');
  assert.deepEqual(page.labels(), ['7h30m', '3h45m']);

  // Badging the first price splits the text node, and the new tail still holds
  // the second price. Settle past the observer's debounce to be sure that does
  // not come back round as a duplicate.
  await page.settle();
  assert.deepEqual(page.labels(), ['7h30m', '3h45m']);
});

test('splitting a node for one price does not re-badge the next', async () => {
  const page = await mount('<p>$19 - $34</p>', { settings: Object.assign({}, DEFAULT_STORED.settings, { homeCurrency: 'USD' }) });
  await page.settle();
  assert.equal(page.badges().length, 2);
});

test('a price split across elements is badged once, on the parent', async () => {
  const page = await mount('<p class="price"><span>1 299</span><span>kr</span></p>');
  const badges = page.badges();
  assert.equal(badges.length, 1);
  assert.equal(badges[0].textContent, '7h30m');
  assert.equal(badges[0].parentElement.className, 'price');
  assert.equal(badges[0].parentElement.getAttribute('data-worthit'), '');
});

test('nothing is badged twice, even after repeated scans', async () => {
  const page = await mount('<p>1 299 kr</p>');
  assert.equal(page.badges().length, 1);
  // Any DOM change makes the observer run another scan over the page.
  page.document.body.appendChild(page.document.createElement('div'));
  await page.settle();
  page.document.body.appendChild(page.document.createElement('div'));
  await page.settle();
  assert.equal(page.badges().length, 1);
});

test('inserting a badge does not feed the observer back into itself', async () => {
  const page = await mount('<p>1 299 kr</p><p>649 kr</p>');
  const before = page.badges().length;
  await page.settle(900);
  assert.equal(page.badges().length, before);
  assert.equal(before, 2);
});

test('content added later is badged', async () => {
  const page = await mount('<div id="list"></div>');
  assert.equal(page.badges().length, 0);

  const added = page.document.createElement('p');
  added.textContent = 'Nytt pris 2 599 kr';
  page.document.getElementById('list').appendChild(added);
  await page.settle();

  assert.deepEqual(page.labels(), ['1.9d']);
});

test('editable and code content is left alone', async () => {
  const page = await mount(
    [
      '<input value="1 299 kr">',
      '<textarea>1 299 kr</textarea>',
      '<select><option>1 299 kr</option></select>',
      '<div contenteditable="true">1 299 kr</div>',
      '<code>1 299 kr</code>',
      '<pre>1 299 kr</pre>',
      '<script type="text/plain">1 299 kr</script>',
      '<style>/* 1 299 kr */</style>',
      '<noscript>1 299 kr</noscript>',
    ].join(''),
  );
  assert.deepEqual(page.labels(), []);
});

test('amounts outside 1 to 10,000,000 home currency are ignored', async () => {
  const page = await mount('<p>0,50 kr</p><p>50 000 000 kr</p><p>1 299 kr</p>');
  assert.deepEqual(page.labels(), ['7h30m']);
});

test('an unconvertible currency gets an honest question mark', async () => {
  // ZWL is in the currency table but not in this rate cache.
  const page = await mount('<p>Pris 500 ZWL</p>');
  const badges = page.badges();
  assert.equal(badges.length, 1);
  assert.equal(badges[0].textContent, '?');
  assert.match(badges[0].getAttribute('title'), /No exchange rate for ZWL/);
});

test('the tooltip carries the original, the conversion, the hours and the rate', async () => {
  const page = await mount('<p>Pris 100 USD</p>');
  const title = page.badges()[0].getAttribute('title');
  assert.match(title, /100 USD/);
  assert.match(title, /= 987\.85 SEK/);
  assert.match(title, /of your work/);
  assert.match(title, /1 USD = 9\.87850 SEK/);
  assert.match(title, /2026-10-21/);
  assert.match(title, /ExchangeRate-API/);
});

test('a home-currency price needs no conversion line', async () => {
  const page = await mount('<p>1 299 kr</p>');
  const title = page.badges()[0].getAttribute('title');
  assert.doesNotMatch(title, /= [\d.]+ SEK/);
  assert.match(title, /7 h 30 min of your work/);
});

test('the overlay stays off when it is switched off globally', async () => {
  const page = await mount('<p>1 299 kr</p>', {
    settings: Object.assign({}, DEFAULT_STORED.settings, { overlayEnabled: false }),
  });
  assert.deepEqual(page.labels(), []);
});

test('the overlay stays off on a site that is disabled', async () => {
  const page = await mount('<p>1 299 kr</p>', {
    sites: { 'butik.example.se': { disabled: true, forceCurrency: null } },
  });
  assert.deepEqual(page.labels(), []);
});

test('the overlay stays off until income is configured', async () => {
  const page = await mount('<p>1 299 kr</p>', {
    settings: { incomeMode: 'monthly', monthly: 0, hoursPerWeek: 40, homeCurrency: 'SEK' },
  });
  assert.deepEqual(page.labels(), []);
});

test('switching the overlay off removes the badges without a reload', async () => {
  const page = await mount('<p>1 299 kr</p>');
  assert.equal(page.badges().length, 1);

  await page.change({
    settings: Object.assign({}, DEFAULT_STORED.settings, { overlayEnabled: false }),
  });
  assert.equal(page.badges().length, 0);

  await page.change({ settings: DEFAULT_STORED.settings });
  assert.equal(page.badges().length, 1);
});

test('disabling this site removes the badges without a reload', async () => {
  const page = await mount('<p>1 299 kr</p>');
  assert.equal(page.badges().length, 1);

  await page.change({ sites: { 'butik.example.se': { disabled: true } } });
  assert.equal(page.badges().length, 0);

  await page.change({ sites: {} });
  assert.equal(page.badges().length, 1);
});

test('forcing a currency on this site re-prices what is already badged', async () => {
  // A bare '$' on a .se domain has no owner among the dollar currencies, so it
  // falls back to USD; forcing EUR must change the badge.
  const page = await mount('<p>$100</p>');
  const asUsd = page.labels()[0];

  await page.change({
    sites: { 'butik.example.se': { disabled: false, forceCurrency: 'EUR' } },
  });
  const asEur = page.labels()[0];

  assert.notEqual(asUsd, asEur);
  assert.equal(page.badges().length, 1);
});

test('new rates re-price the page', async () => {
  const page = await mount('<p>100 USD</p>');
  const before = page.labels()[0];

  await page.change({
    ratesCache: {
      base: 'USD',
      rates: Object.assign({}, RATES, { SEK: 20 }),
      rateDate: '2026-10-22',
      source: 'frankfurter',
      fetchedAt: Date.now(),
    },
  });

  assert.notEqual(page.labels()[0], before);
  assert.equal(page.badges().length, 1);
  assert.match(page.badges()[0].getAttribute('title'), /Frankfurter \(ECB\)/);
});

test('the page locale decides an ambiguous symbol', async () => {
  const page = await mount('<p>$100</p>', {}, { url: 'https://shop.example.com/x', lang: 'en-CA' });
  const title = page.badges()[0].getAttribute('title');
  assert.match(title, /1 CAD = /);
});

test('a product:price:currency meta beats the page locale', async () => {
  const page = await mount(
    '<p>$100</p>',
    {},
    {
      url: 'https://shop.example.com/x',
      lang: 'en-CA',
      head: '<meta property="product:price:currency" content="AUD">',
    },
  );
  assert.match(page.badges()[0].getAttribute('title'), /1 AUD = /);
});

test('dates, phone numbers and model names are not prices', async () => {
  const page = await mount(
    '<p>Giltigt 2024-01-15</p><p>Ring +46 70 123 45 67</p><p>RTX 4090 Ti</p><p>Spara 20%</p>',
  );
  assert.deepEqual(page.labels(), []);
});

test('the badge is marked so page scripts and rescans can recognise it', async () => {
  const page = await mount('<p>1 299 kr</p>');
  const badge = page.badges()[0];
  assert.equal(badge.tagName, 'SPAN');
  assert.ok(badge.hasAttribute('data-worthit-badge'));
  // No inline styles: everything comes from badge.css, which is isolated with
  // `all: initial`.
  assert.equal(badge.getAttribute('style'), null);
});
