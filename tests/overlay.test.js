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
  'lib/i18n.js',
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

  // Anything the page does to itself before the content script runs: a custom
  // element upgrading and attaching its shadow root, for instance.
  if (config.prepare) config.prepare(dom.window.document);

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

// Elgiganten carries the price twice: "2 190.-" on screen and "Pris 2 190 kr"
// for screen readers. Badging the second one puts the badge where nobody can
// see it, and badging both puts two badges on one price.
const SR_ONLY_HEAD =
  '<style>.sr{position:absolute;clip:rect(0 0 0 0);clip-path:inset(50%);' +
  'overflow:hidden;width:1px;height:1px;white-space:nowrap}</style>';

test('screen-reader-only text gets no badge', async () => {
  const page = await mount('<p><span class="sr">Pris 2 190 kr</span></p>', null, {
    head: SR_ONLY_HEAD,
  });
  assert.deepEqual(page.labels(), []);
});

test('the visible price beside it gets exactly one badge', async () => {
  const page = await mount(
    '<p><span class="sr">Pris 2 190 kr</span><span class="visible">2 190.-</span></p>',
    null,
    { head: SR_ONLY_HEAD },
  );
  // 2190 SEK is 12 h 39 min, past one workday, so the badge compacts to days.
  assert.deepEqual(page.labels(), ['1.6d']);
  assert.equal(page.badges()[0].parentElement.className, 'visible');
});

test('a clip-path of inset(50%) is enough on its own', async () => {
  const page = await mount('<p><span class="hid">1 299 kr</span></p>', null, {
    head: '<style>.hid{clip-path:inset(50%)}</style>',
  });
  assert.deepEqual(page.labels(), []);
});

// Collapsed tabs, accordions and menus become visible again with no DOM
// mutation, so the observer would never come back for them. Skipping them would
// lose those badges for good, which is worse than badging something unseen.
test('display:none and visibility:hidden content is still badged', async () => {
  const page = await mount(
    '<p class="gone">1 299 kr</p><p class="invisible">1 299 kr</p>',
    null,
    { head: '<style>.gone{display:none}.invisible{visibility:hidden}</style>' },
  );
  assert.deepEqual(page.labels(), ['7h30m', '7h30m']);
});

// A price split across elements reads off the container, so the container is
// what has to be tested -- the number's own parent carries no style of interest.
test('a split price inside screen-reader-only text gets no badge', async () => {
  const page = await mount(
    '<div class="sr"><span>1 299</span><span>kr</span></div>',
    null,
    { head: SR_ONLY_HEAD },
  );
  assert.deepEqual(page.labels(), []);
});

test('a split price in visible markup still gets its badge', async () => {
  const page = await mount('<div><span>1 299</span><span>kr</span></div>');
  assert.deepEqual(page.labels(), ['7h30m']);
});

// #114. bestbuy.com writes the price twice: the whole of it in an sr-only span,
// and the visible one as three aria-hidden siblings whose cents are told apart
// by font-size alone. Joined, those three read as '$59999'; the hidden copy is
// what says where the decimal point goes, and the badge has to land on the
// pieces the reader can see rather than in the copy.
const CLIPPED_HEAD =
  '<style>.sr-only,.a-offscreen{position:absolute;width:1px;height:1px;' +
  'overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap}</style>';

const BEST_BUY =
  '<div data-testid="price-block-customer-price" style="display: flex; ' +
  'flex-direction: row; align-items: flex-start;">' +
  '<span class="font-sans text-default text-style-body-md-400 sr-only">$599.99</span>' +
  '<span aria-hidden="true" style="font-size: 14px; line-height: 20px; font-weight: 500;" ' +
  'class="font-sans text-default text-style-body-md-400">$</span>' +
  '<span elementtiming="price_et" aria-hidden="true" style="font-size: 24px; ' +
  'line-height: 28px; font-weight: 500;" class="font-sans text-default ' +
  'text-style-body-md-400">599</span>' +
  '<span aria-hidden="true" style="font-size: 12px; line-height: 20px; font-weight: 500;" ' +
  'class="font-sans text-default text-style-body-md-400">99</span></div>';

// Amazon's shape: .a-offscreen carries the whole price and the visible pieces
// spell it out in full, decimal point included, so the pieces alone already
// read as one price once the hidden copy is kept out of the reading.
const AMAZON =
  '<span class="a-price">' +
  '<span class="a-offscreen">$599.99</span>' +
  '<span aria-hidden="true">' +
  '<span class="a-price-symbol">$</span>' +
  '<span class="a-price-whole">599<span class="a-price-decimal">.</span></span>' +
  '<span class="a-price-fraction">99</span>' +
  '</span></span>';

const US = { url: 'https://www.example.com/p/1', lang: 'en-US', head: CLIPPED_HEAD };

// 599.99 USD is 5927.00 SEK at 9.8785, which is 34 h 15 min of a 173.08/h wage.
const USD_PRICE = /= 5927\.00 SEK/;

test('the Best Buy fixture gets one badge, for 599.99, after the cents', async () => {
  const page = await mount(BEST_BUY, null, US);
  const badges = page.badges();
  assert.equal(badges.length, 1);

  const title = badges[0].getAttribute('title');
  assert.match(title, /\$599\.99/, 'the price as the page writes it');
  assert.match(title, USD_PRICE, 'and the amount it really is, not 59999');

  assert.equal(badges[0].previousElementSibling.textContent, '99', 'after the cents span');
  assert.equal(
    badges[0].parentElement.getAttribute('data-testid'),
    'price-block-customer-price',
    'and inside the price block itself'
  );
});

test('the Amazon fixture gets one badge, for the right amount', async () => {
  const page = await mount(AMAZON, null, US);
  const badges = page.badges();
  assert.equal(badges.length, 1);
  assert.match(badges[0].getAttribute('title'), USD_PRICE);
});

test('no badge is ever put inside the hidden copy of a price', async () => {
  for (const fixture of [BEST_BUY, AMAZON]) {
    const page = await mount(fixture, null, US);
    assert.equal(page.badges().length, 1);
    assert.equal(
      page.document.querySelector('.sr-only [data-worthit-badge], .a-offscreen [data-worthit-badge]'),
      null,
      'the badge must be where it can be seen'
    );
    // and the copy itself is never badged a second time
    assert.equal(page.document.querySelectorAll('[data-worthit-badge]').length, 1);
  }
});

test('a hidden price that is not the visible one is not merged into it', async () => {
  // A copy only decides where the decimal point goes when it is the same
  // digits. These are not: the visible pieces are read on their own instead.
  const page = await mount(
    '<div><span class="sr-only">$1,299.00</span>' +
      '<span style="font-size: 14px">$</span>' +
      '<span style="font-size: 24px">599</span>' +
      '<span style="font-size: 12px">99</span></div>',
    null,
    US
  );
  assert.equal(page.badges().length, 1);
  const title = page.badges()[0].getAttribute('title');
  assert.match(title, /\$599\.99/);
  assert.doesNotMatch(title, /1,?299/, 'the hidden price is not what is badged');
});

test('smaller or raised digits beside a price are read as its minor units', async () => {
  // No hidden copy at all: the cents are told apart by being set smaller than
  // the integer, by being a <sup>, or by being raised.
  const fixtures = [
    '<p><span style="font-size: 24px">$599</span><span style="font-size: 12px">99</span></p>',
    '<p>$599<sup>99</sup></p>',
    '<p>$599<span style="vertical-align: super">99</span></p>',
  ];
  for (const fixture of fixtures) {
    const page = await mount(fixture, null, US);
    assert.equal(page.badges().length, 1, fixture);
    assert.match(page.badges()[0].getAttribute('title'), USD_PRICE, fixture);
  }
});

test('a footnote is not a run of cents', async () => {
  const page = await mount('<p>$599<sup>1</sup></p>', null, US);
  assert.equal(page.badges().length, 1);
  const title = page.badges()[0].getAttribute('title');
  // 599 USD is 5917.22 SEK; 599.01 would be 5917.32 and 5991 would be 59 171.
  assert.match(title, /= 5917\.22 SEK/, '599 USD, with the footnote left out of it');
});

test('a gap between the digits is a footnote too, not cents', async () => {
  const page = await mount('<p>$599 <sup>99</sup></p>', null, US);
  assert.equal(page.badges().length, 1);
  assert.match(page.badges()[0].getAttribute('title'), /= 5917\.22 SEK/);
});

test('a currency with no minor units never merges the digits beside it', async () => {
  // The yen is written without cents, so a small '99' beside it is something
  // else -- a footnote, a rating, a unit -- and never part of the price.
  const page = await mount('<p>\u00a5599<sup>99</sup></p>', null, {
    url: 'https://shop.example.jp/p/1',
    lang: 'ja',
    head: CLIPPED_HEAD,
  });
  assert.equal(page.badges().length, 1);
  const title = page.badges()[0].getAttribute('title');
  assert.match(title, /\u00a5599/);
  assert.doesNotMatch(title, /599\.99|59999/, 'the yen has no cents to merge');
});

test('a grouped price is marked, so rescans add no second badge', async () => {
  const page = await mount(BEST_BUY, null, US);
  const container = page.document.querySelector('[data-testid="price-block-customer-price"]');
  assert.equal(container.getAttribute('data-worthit'), '');

  // Any mutation makes the observer scan again, twice over.
  page.document.body.appendChild(page.document.createElement('div'));
  await page.settle();
  page.document.body.appendChild(page.document.createElement('div'));
  await page.settle();
  assert.equal(page.badges().length, 1);
});

test('switching the overlay off clears a grouped badge and its mark', async () => {
  const page = await mount(BEST_BUY, null, US);
  assert.equal(page.badges().length, 1);

  await page.change({
    settings: Object.assign({}, DEFAULT_STORED.settings, { overlayEnabled: false }),
  });
  assert.equal(page.badges().length, 0);
  assert.equal(
    page.document.querySelector('[data-testid="price-block-customer-price"]')
      .hasAttribute('data-worthit'),
    false
  );

  await page.change({ settings: DEFAULT_STORED.settings });
  assert.equal(page.badges().length, 1, 'and it comes back exactly once');
});

// 50 000 000 kr at 173.08 kr/h is 288 889 h, 36 111 workdays.
test('amounts under 1 home unit are ignored, and there is no ceiling', async () => {
  const page = await mount('<p>0,50 kr</p><p>50 000 000 kr</p><p>1 299 kr</p>');
  assert.deepEqual(page.labels(), ['138y231d', '7h30m']);
});

// booli.se: 23 450 000 kr is 135 490 h, 16 936 workdays. A fixed 10 000 000
// ceiling used to hide it, and every other home on the site.
test('a home priced over ten million still gets its badge', async () => {
  const page = await mount('<p>Utropspris</p><p>23 450 000 kr</p>');
  assert.deepEqual(page.labels(), ['65y36d']);
});

test('large amounts are badged in a high-denomination home currency too', async () => {
  const yen = Object.assign({}, DEFAULT_STORED.settings, { homeCurrency: 'JPY', monthly: 400000 });
  const page = await mount('<p>35 000 000 円</p>', { settings: yen });
  assert.equal(page.labels().length, 1);
});

// booli.se's fact list: the fee is badged in its own text node, and the bare
// year then climbed to the list, read the fee and its badge together as
// '10 236 kr5.2d', and badged 'kr5.2' -- five kronor -- as '1m'.
test('a bare number does not pick up a neighbour price, or a badge, as its own', async () => {
  const page = await mount(
    '<div class="facts">' +
      '<div><span>Boarea</span><span>142 m²</span></div>' +
      '<div><span>Avgift</span><span>10 236 kr/mån</span></div>' +
      '<div><span>Byggår</span><span>1929</span></div>' +
      '</div>',
  );
  await page.settle();
  assert.deepEqual(page.labels(), ['7.4d']);
  assert.equal(page.badges()[0].parentElement.tagName, 'SPAN');
});

// filmstaden.se's ticket list: the seat number sits in its own cell beside the
// price, and the bare '39' climbed to the row and read '39 159.00 kr' as one
// price of 39 159 kronor.
test('a bare number is not glued onto the whole price beside it', async () => {
  const row = (seat, price) =>
    '<div class="row"><div><span>Rad</span> <span>Plats</span></div>' +
    `<div><span>Standard</span> <span>3</span> <span>${seat}</span></div>` +
    ` <span>${price}</span></div>`;
  const page = await mount(row('39', '159.00 kr') + row('40', '143.10 kr'));
  await page.settle();
  const titles = page.badges().map((badge) => badge.getAttribute('title'));
  assert.equal(titles.length, 2);
  assert.ok(titles.every((title) => !/\d \d{3}\.\d{2}/.test(title)), titles.join(' | '));
});

// The split price it is there for still works when the number is the cell.
test('a bare number still joins a lone currency beside it', async () => {
  const page = await mount('<div><span>Pris</span> <span>1 299</span> <span>kr</span></div>');
  await page.settle();
  assert.deepEqual(page.labels(), ['7h30m']);
});

// hemnet.se's listing cards: the price and the living area are neighbouring
// elements, '123 500 000 kr' beside '530 + 130 m²', and the dot between
// them is drawn by CSS. Joining the card's text left the currency touching the
// area, so '123 500 000 kr' was rejected for the digit now following 'kr' and
// 'kr530' -- 530 kronor -- was badged on the card. A written-out code glues
// the same way: 'SEK530'.
test('a bare number does not borrow the currency token beside it', async () => {
  const card = (price) =>
    '<article class="card"><a href="/bostad/1"><h2>Roslättsvägen 182-28</h2>' +
    `<span>Svedala</span><div class="price"><span>${price}</span></div>` +
    '<div class="area"><span>530</span> + <span>130</span> m²</div></a></article>';

  for (const price of ['123 500 000 kr', '123 500 000 SEK']) {
    const page = await mount(card(price), null, {
      url: 'https://www.hemnet.se/bostader?by=price&order=desc',
    });
    await page.settle();
    const badges = page.badges();
    assert.equal(badges.length, 1, `${price}: ${page.labels().join(' ')}`);
    assert.match(badges[0].getAttribute('title'), new RegExp(price));
    assert.equal(badges[0].previousSibling.nodeValue, price);
  }
});

// Two bare numbers in neighbouring elements, the currency in a third: the
// card's text reads '5303 000SEK', of which '303 000SEK' parses -- 303 000
// kronor, a figure the page never wrote (#128). Neither '530' nor '3 000' is a
// price on its own, so nothing in the guards against #122 and #127 applies.
test('two adjacent bare numbers do not join into one glued price', async () => {
  const page = await mount('<div class="box"><span>530</span><span>3 000</span><span>SEK</span></div>');
  await page.settle();
  const titles = page.badges().map((badge) => badge.getAttribute('title'));
  assert.deepEqual(titles, [], titles.join(' | '));
  assert.equal(page.document.querySelector('.box').hasAttribute('data-worthit'), false);
});

// The split price the bare-number rule is there for keeps working, and so does
// a price whose thousands groups are themselves split across elements: there
// every digit of every piece goes into the one reading.
test('a split price whose pieces are read whole still gets its badge', async () => {
  const whole = await mount('<div class="box"><span>1 299</span><span>kr</span></div>');
  assert.deepEqual(whole.labels(), ['7h30m']);

  const grouped = await mount('<div class="box"><span>3</span><span>000</span><span>SEK</span></div>');
  await grouped.settle();
  assert.equal(grouped.badges().length, 1);
  assert.match(grouped.badges()[0].getAttribute('title'), /3000/);
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

test('the badge tells a screen reader what it means, not what it says', async () => {
  // #77: the badge's own text is a glance-value. role="img" is what gets the
  // name exposed at all and makes '7h30m' presentational, so a reader hears the
  // sentence once rather than the sentence and then the compact form.
  const page = await mount('<p>1 299 kr</p>');
  const badge = page.badges()[0];
  assert.equal(badge.getAttribute('role'), 'img');
  assert.equal(badge.getAttribute('aria-label'), 'Worth It? 7 h 30 min of your work');
  assert.equal(badge.textContent, '7h30m', 'and the sighted form is untouched');
});

test('the spoken form is the precise duration, not the rounded badge', async () => {
  // 9 490 kr is 54 h 50 min, which the badge compresses to '6.9d'. Read out
  // loud, '6.9d' resolves to nothing.
  const page = await mount('<p>9 490 kr</p>');
  const badge = page.badges()[0];
  assert.equal(badge.textContent, '6.9d');
  assert.equal(badge.getAttribute('aria-label'), 'Worth It? 54 h 50 min of your work');
});

test('the spoken form is translated, and matches the tooltip', async () => {
  const page = await mount('<p>1 299 kr</p>', {
    settings: Object.assign({}, DEFAULT_STORED.settings, { language: 'sv' }),
  });
  const badge = page.badges()[0];
  assert.equal(badge.getAttribute('aria-label'), 'Worth It? 7 tim 30 min av ditt arbete');
  assert.match(
    badge.getAttribute('title'),
    /7 tim 30 min av ditt arbete/,
    'the label says what the tooltip says',
  );
});

test('a Swedish page writes its decimals with a comma, badge and tooltip alike', async () => {
  const swedish = { settings: Object.assign({}, DEFAULT_STORED.settings, { language: 'sv' }) };
  const local = await mount('<p>9 490 kr</p>', swedish);
  assert.equal(local.badges()[0].textContent, '6,9d');

  // a foreign price shows the converted amount and the rate in the tooltip
  const foreign = await mount('<p>$100.00</p>', swedish);
  const title = foreign.badges()[0].getAttribute('title');
  assert.match(title, /\d+,\d{2} SEK/, 'the converted amount');
  assert.match(title, /1 USD = \d+,\d+ SEK/, 'the rate');
  // the page's own price is quoted as the page wrote it; everything after is ours
  const ours = title.split('\n').filter((line) => line.trim() !== '$100.00').join('\n');
  assert.doesNotMatch(ours, /\d\.\d/, 'no decimal point left in what Worth It? wrote');
});

test('an unconvertible badge says why to a screen reader, in both languages', async () => {
  const english = await mount('<p>Pris 500 ZWL</p>');
  assert.equal(
    english.badges()[0].getAttribute('aria-label'),
    'Worth It? No exchange rate for ZWL, so this is not converted.',
  );

  const swedish = await mount('<p>Pris 500 ZWL</p>', {
    settings: Object.assign({}, DEFAULT_STORED.settings, { language: 'sv' }),
  });
  assert.equal(
    swedish.badges()[0].getAttribute('aria-label'),
    'Worth It? Ingen växelkurs för ZWL, så detta är inte omräknat.',
  );
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

test('switching the language re-badges the page without a reload', async () => {
  // Language lives inside settings, so it takes the same path a currency change
  // does: every badge is removed and the page rescanned. Nothing is patched in
  // place, which is what keeps the units and the tooltip consistent.
  const page = await mount('<p>1 299 kr</p>');
  assert.deepEqual(page.labels(), ['7h30m']);
  assert.match(page.badges()[0].getAttribute('title'), /of your work/);

  await page.change({
    settings: Object.assign({}, DEFAULT_STORED.settings, { language: 'sv' }),
  });
  assert.deepEqual(page.labels(), ['7t30m'], 'the badge unit is Swedish');
  const title = page.badges()[0].getAttribute('title');
  assert.match(title, /7 tim 30 min av ditt arbete/);
  assert.doesNotMatch(title, /of your work/);

  await page.change({ settings: DEFAULT_STORED.settings });
  assert.deepEqual(page.labels(), ['7h30m'], 'and back again');
});

test('an unconvertible price says so in the reader language', async () => {
  // ZWL is in the currency table but not in this rate cache, as above.
  const page = await mount('<p>Pris 500 ZWL</p>', {
    settings: Object.assign({}, DEFAULT_STORED.settings, { language: 'sv' }),
  });
  const badges = page.badges();
  assert.equal(badges.length, 1);
  assert.equal(badges[0].textContent, '?', 'the symbol is language-neutral');
  assert.match(badges[0].getAttribute('title'), /Ingen växelkurs för ZWL/);
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

test('opening hours and delivery times are not prices', async () => {
  // The bug this covers: ':dd' is the Swedish 499:99 form, 'H:MM' is the same
  // shape, and SEK is the only currency that writes ':dd' -- so every clock on
  // every page was badged, in SEK, whatever the reader's own currency.
  const page = await mount(
    [
      '<p>Öppet 10:00-18:00</p>',
      '<p>Lördag 09:55 - 15:00</p>',
      '<p>Levereras kl. 12:15</p>',
      '<p>Senast 23:59</p>',
      '<p>Avgår 1:30</p>',
    ].join('')
  );
  assert.deepEqual(page.labels(), []);
});

test('a video timestamp is not a price', async () => {
  // The bug this covers: a clock stops at 23:59, so an hour test alone let every
  // 'mm:ss' past 24 minutes through -- and youtube.com badged its own player time
  // display and every thumbnail duration, in SEK, because the reader's home
  // currency is all it takes to corroborate ':dd'.
  const page = await mount(
    [
      // The player's time display, as YouTube builds it: three spans, one text
      // node each, so the duration is read entirely on its own.
      '<div class="ytp-time-display">',
      '<span class="ytp-time-current">12:45</span>',
      '<span class="ytp-time-separator"> / </span>',
      '<span class="ytp-time-duration">45:30</span>',
      '</div>',
      // A thumbnail duration badge, and a chapter list.
      '<div class="badge-shape">25:30</div>',
      '<p>1:04:20</p>',
      '<ol><li>0:00 Intro</li><li>59:59 Outro</li></ol>',
    ].join(''),
    {},
    { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', lang: 'en' },
  );
  assert.deepEqual(page.labels(), []);
});

test('a Swedish price in ore still gets a badge beside the times', async () => {
  // The other half: the fix must not cost the form it was protecting.
  const page = await mount('<p>Öppet 10:00-18:00</p><p>499:99</p><p>1 299:-</p>');
  // 30000/month over a 40-hour week is 173.08/h, so 499:99 is 2h53m.
  assert.deepEqual(page.labels(), ['2h53m', '7h30m']);
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

// --- shadow DOM ------------------------------------------------------------
// komplett.se builds its product cards as custom elements and nests four open
// shadow roots: komplett-search-results > komplett-product-card-container >
// komplett-product-card > komplett-product-card-price. Neither a TreeWalker nor
// a MutationObserver crosses a shadow boundary, so the whole page read as
// having no prices on it at all.

/** Builds the host chain the shop uses, with `html` inside the innermost root. */
function nestShadow(document, tags, html) {
  let parent = document.body;
  let root = null;
  tags.forEach((tag) => {
    const host = document.createElement(tag);
    parent.appendChild(host);
    root = host.attachShadow({ mode: 'open' });
    parent = root;
  });
  root.innerHTML = html;
  return root;
}

test('a price inside an open shadow root is badged', async () => {
  // Upgraded before the content script runs, which is the ordinary case for a
  // custom element that is already in the served markup.
  let root = null;
  const page = await mount('<div id="host"></div>', null, {
    prepare(document) {
      root = document.querySelector('#host').attachShadow({ mode: 'open' });
      root.innerHTML = '<section class="primary">1 299 kr</section>';
    },
  });
  await page.settle();

  assert.deepEqual(
    [...root.querySelectorAll('[data-worthit-badge]')].map((b) => b.textContent),
    ['7h30m'],
  );
});

test('nested shadow roots are reached, as the reported shop nests them', async () => {
  const page = await mount('<div></div>');
  const root = nestShadow(
    page.document,
    ['komplett-search-results', 'komplett-product-card-container', 'komplett-product-card', 'komplett-product-card-price'],
    '<section class="primary">17 990:-</section><div class="regular-price">Tidigare pris 39 990:-</div>',
  );
  await page.settle();

  assert.deepEqual(
    [...root.querySelectorAll('[data-worthit-badge]')].map((b) => b.textContent),
    ['13d', '29d'],
  );
});

test('a badge in a shadow root takes the badge stylesheet with it', async () => {
  // The root sees none of the document's styles, so without this the badge is
  // styled by whatever the component says about a span -- on the reported page,
  // the 46px of the price beside it.
  let root = null;
  const page = await mount('<div id="host"></div>', null, {
    prepare(document) {
      root = document.querySelector('#host').attachShadow({ mode: 'open' });
      root.innerHTML = '<span>1 299 kr</span>';
    },
  });
  await page.settle();

  const adopted = root.adoptedStyleSheets ? root.adoptedStyleSheets.length : 0;
  const element = root.querySelector('style');
  assert.ok(adopted === 1 || element, 'the badge sheet never reached the shadow root');
  if (element) assert.match(element.textContent, /data-worthit-badge/);
});

test('the shadow copy of the badge stylesheet is content/badge.css', async () => {
  // It is a copy because there is nothing to read it from: the content script
  // fetches nothing and the file is not web-accessible. This is what keeps the
  // two from drifting.
  const source = fs.readFileSync(path.join(root, 'content/content.js'), 'utf8');
  const copy = source.match(/const BADGE_CSS = `([\s\S]*?)`;/);
  assert.ok(copy, 'BADGE_CSS is gone from the content script');
  const normalise = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
  assert.equal(
    normalise(copy[1]),
    normalise(fs.readFileSync(path.join(root, 'content/badge.css'), 'utf8')),
  );
});

test('a price added to a shadow root later is badged too', async () => {
  // A card that arrives after the first scan: the host lands in the page, the
  // observer sees it, and the walk has to go into its root rather than past it.
  let shadow = null;
  const page = await mount('<div id="list"></div>', null, {
    prepare(document) {
      const host = document.createElement('komplett-product-card');
      shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<div class="card">Inget pris än</div>';
      document.body.appendChild(document.createComment('card arrives below'));
      document.defaultView.__card = host;
    },
  });
  await page.settle();
  assert.equal(shadow.querySelectorAll('[data-worthit-badge]').length, 0);

  page.document.querySelector('#list').appendChild(page.dom.window.__card);
  shadow.querySelector('.card').innerHTML = '<span>1 299 kr</span>';
  await page.settle();

  assert.deepEqual(
    [...shadow.querySelectorAll('[data-worthit-badge]')].map((b) => b.textContent),
    ['7h30m'],
  );
});

test('badges inside a shadow root are removed when the site is switched off', async () => {
  let shadow = null;
  const page = await mount('<div id="host"></div>', null, {
    prepare(document) {
      shadow = document.querySelector('#host').attachShadow({ mode: 'open' });
      shadow.innerHTML = '<span>1 299 kr</span>';
    },
  });
  await page.settle();
  assert.equal(shadow.querySelectorAll('[data-worthit-badge]').length, 1);

  await page.change({ sites: { 'butik.example.se': { disabled: true, forceCurrency: null } } });
  assert.equal(
    shadow.querySelectorAll('[data-worthit-badge]').length,
    0,
    'a badge in a shadow root is invisible to document.querySelectorAll',
  );
});
