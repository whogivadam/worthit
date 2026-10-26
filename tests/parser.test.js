'use strict';

// (input string, page context) -> (amount, currency).
//
// Cases are a flat table so one case is one line. `null` means the string must
// not be read as a price at all. The context object is what a page would hand the
// parser: a forced site currency, a product:price:currency meta, an <html lang> or
// og:locale, the hostname, and the user's own home currency.

const test = require('node:test');
const assert = require('node:assert/strict');

require('../lib/currencies.js');
const parser = require('../lib/parser.js');

const NBSP = ' ';
const NNBSP = ' ';

const SE = { tld: 'butik.example.se' };
const US = { homeCurrency: 'USD' };
const NONE = {};

/** [input, context, expectedAmount, expectedCurrency] or [input, context, null] */
const CASES = [
  // --- group separators -------------------------------------------------------
  ['$1,234.56', NONE, 1234.56, 'USD'],
  ['$1234.56', NONE, 1234.56, 'USD'],
  ['$1,234,567.89', NONE, 1234567.89, 'USD'],
  ['1.234,56 €', NONE, 1234.56, 'EUR'],
  ['1.234.567,89 €', NONE, 1234567.89, 'EUR'],
  ['1 234,56 €', NONE, 1234.56, 'EUR'],
  ['1' + NBSP + '234,56 €', NONE, 1234.56, 'EUR'],
  ['1' + NNBSP + '234,56 €', NONE, 1234.56, 'EUR'],
  ['1' + NBSP + '299 kr', SE, 1299, 'SEK'],
  ["1'234.56 CHF", NONE, 1234.56, 'CHF'],
  ["1'234'567.89 CHF", NONE, 1234567.89, 'CHF'],
  ['₹1,23,456', NONE, 123456, 'INR'],
  ['₹1,23,456.78', NONE, 123456.78, 'INR'],
  ['₹12,34,56,789', NONE, 123456789, 'INR'],
  ['€89,90', NONE, 89.9, 'EUR'],
  ['€0,99', NONE, 0.99, 'EUR'],
  ['$1.5', NONE, 1.5, 'USD'],
  ['1.234 €', NONE, 1234, 'EUR'],
  ['$1,234', NONE, 1234, 'USD'],

  // --- prefix symbols ---------------------------------------------------------
  ['$100', NONE, 100, 'USD'],
  ['US$100', NONE, 100, 'USD'],
  ['USD$100', NONE, 100, 'USD'],
  ['C$100', NONE, 100, 'CAD'],
  ['CA$100', NONE, 100, 'CAD'],
  ['A$100', NONE, 100, 'AUD'],
  ['AU$100', NONE, 100, 'AUD'],
  ['NZ$100', NONE, 100, 'NZD'],
  ['HK$100', NONE, 100, 'HKD'],
  ['S$100', NONE, 100, 'SGD'],
  ['NT$100', NONE, 100, 'TWD'],
  ['R$100', NONE, 100, 'BRL'],
  ['MX$100', NONE, 100, 'MXN'],
  ['€100', NONE, 100, 'EUR'],
  ['£100', NONE, 100, 'GBP'],
  ['₹100', NONE, 100, 'INR'],
  ['₺100', NONE, 100, 'TRY'],
  ['₱100', NONE, 100, 'PHP'],
  ['₦100', NONE, 100, 'NGN'],
  ['RM100', NONE, 100, 'MYR'],
  ['Rp15000', NONE, 15000, 'IDR'],

  // --- suffix symbols --------------------------------------------------------
  ['100 $', NONE, 100, 'USD'],
  ['100 €', NONE, 100, 'EUR'],
  ['100€', NONE, 100, 'EUR'],
  ['299 kr', SE, 299, 'SEK'],
  ['299kr', SE, 299, 'SEK'],
  ['299 KR', SE, 299, 'SEK'],
  ['299 Kr', SE, 299, 'SEK'],
  ['250 zł', NONE, 250, 'PLN'],
  ['250 Kč', NONE, 250, 'CZK'],
  ['2500 Ft', NONE, 2500, 'HUF'],
  ['250 lei', NONE, 250, 'RON'],
  ['250 лв', NONE, 250, 'BGN'],
  ['250 ₽', NONE, 250, 'RUB'],
  ['250 ₴', NONE, 250, 'UAH'],
  ['250 ₫', NONE, 250, 'VND'],
  ['250 ₪', NONE, 250, 'ILS'],

  // --- ISO codes on either side ----------------------------------------------
  ['SEK 400', NONE, 400, 'SEK'],
  ['400 SEK', NONE, 400, 'SEK'],
  ['SEK400', NONE, 400, 'SEK'],
  ['400SEK', NONE, 400, 'SEK'],
  ['EUR 99', NONE, 99, 'EUR'],
  ['99 EUR', NONE, 99, 'EUR'],
  ['JPY 1000', NONE, 1000, 'JPY'],
  ['1000 JPY', NONE, 1000, 'JPY'],

  // --- words and native scripts ----------------------------------------------
  ['400 kronor', NONE, 400, 'SEK'],
  ['400 kroner', { tld: 'x.no' }, 400, 'NOK'],
  ['400 kroner', { tld: 'x.dk' }, 400, 'DKK'],
  ['99 euros', NONE, 99, 'EUR'],
  ['99 euro', NONE, 99, 'EUR'],
  ['250 złotych', NONE, 250, 'PLN'],
  ['250 zlotych', NONE, 250, 'PLN'],
  ['250 Kc', NONE, 250, 'CZK'],
  ['250 forint', NONE, 250, 'HUF'],
  ['250 руб', NONE, 250, 'RUB'],
  ['250 руб.', NONE, 250, 'RUB'],
  ['250 грн', NONE, 250, 'UAH'],
  ['1000 円', NONE, 1000, 'JPY'],
  ['1000 元', NONE, 1000, 'CNY'],
  ['¥1000 CNY', NONE, 1000, 'CNY'],
  ['50000 원', NONE, 50000, 'KRW'],
  ['₩50000', NONE, 50000, 'KRW'],
  ['250 บาท', NONE, 250, 'THB'],
  ['฿250', NONE, 250, 'THB'],
  ['Rp 15000', NONE, 15000, 'IDR'],
  ['250 ש"ח', NONE, 250, 'ILS'],
  ['250 ج.م', NONE, 250, 'EGP'],
  ['250 Dhs', NONE, 250, 'AED'],
  ['250 Dhs.', NONE, 250, 'AED'],
  ['250 SR', NONE, 250, 'SAR'],
  ['25 KD', NONE, 25, 'KWD'],
  ['250 AED', NONE, 250, 'AED'],
  ['R 500', { tld: 'x.co.za' }, 500, 'ZAR'],
  ['R500', { homeCurrency: 'ZAR' }, 500, 'ZAR'],
  ['500 rand', NONE, 500, 'ZAR'],

  // --- regional quirks -------------------------------------------------------
  ['400:-', SE, 400, 'SEK'],
  ['499:99', SE, 499.99, 'SEK'],
  ['1 299:-', SE, 1299, 'SEK'],
  ['400,-', { tld: 'x.no' }, 400, 'NOK'],
  ['400,-', { tld: 'x.dk' }, 400, 'DKK'],
  ['1.234,-', { tld: 'x.de' }, 1234, 'EUR'],
  ['1.234,-', { pageLocale: 'nl-NL' }, 1234, 'EUR'],

  // --- zero-decimal currencies ----------------------------------------------
  ['¥1.234', NONE, 1234, 'JPY'],
  ['¥1,234', NONE, 1234, 'JPY'],
  ['1000 円', NONE, 1000, 'JPY'],
  ['₩1,234,567', NONE, 1234567, 'KRW'],
  ['250.000 ₫', NONE, 250000, 'VND'],
  ['Rp 1.500.000', NONE, 1500000, 'IDR'],
  ['CLP 15.000', NONE, 15000, 'CLP'],
  ['15.000 kr', { tld: 'x.is' }, 15000, 'ISK'],
  ['2.500 Ft', NONE, 2500, 'HUF'],

  // --- ambiguity step 1: the per-site forced currency ------------------------
  ['$100', { forcedCurrency: 'CAD' }, 100, 'CAD'],
  ['$100', { forcedCurrency: 'SEK' }, 100, 'SEK'],
  ['kr 100', { forcedCurrency: 'DKK' }, 100, 'DKK'],
  ['$100', { forcedCurrency: 'CAD', tld: 'x.au' }, 100, 'CAD'],

  // --- ambiguity step 2: an explicit qualifier ------------------------------
  ['$100 USD', { tld: 'x.ca' }, 100, 'USD'],
  ['$100 CAD', { homeCurrency: 'USD' }, 100, 'CAD'],
  ['¥1000 CNY', { tld: 'x.jp' }, 1000, 'CNY'],
  ['C$100', { tld: 'x.au' }, 100, 'CAD'],
  ['US$100', { forcedCurrency: 'CAD' }, 100, 'USD'],

  // --- ambiguity step 3: the page's own declaration -------------------------
  ['$100', { pageCurrency: 'AUD' }, 100, 'AUD'],
  ['$100', { pageLocale: 'en-CA' }, 100, 'CAD'],
  ['$100', { pageLocale: 'en_NZ' }, 100, 'NZD'],
  ['kr 100', { pageLocale: 'nb-NO' }, 100, 'NOK'],
  ['¥1000', { pageLocale: 'zh-CN' }, 1000, 'CNY'],
  ['$100', { pageCurrency: 'AUD', tld: 'x.ca' }, 100, 'AUD'],

  // --- ambiguity step 4: the top-level domain -------------------------------
  ['$100', { tld: 'shop.x.ca' }, 100, 'CAD'],
  ['$100', { tld: 'shop.x.au' }, 100, 'AUD'],
  ['$100', { tld: 'shop.x.hk' }, 100, 'HKD'],
  ['kr 100', { tld: 'x.dk' }, 100, 'DKK'],
  ['¥1000', { tld: 'x.cn' }, 1000, 'CNY'],
  ['¥1000', { tld: 'x.jp' }, 1000, 'JPY'],
  ['Rs 500', { tld: 'x.pk' }, 500, 'PKR'],
  ['Rs 500', { tld: 'x.lk' }, 500, 'LKR'],

  // --- ambiguity step 5: home currency, else the most common owner ----------
  ['$100', { homeCurrency: 'AUD' }, 100, 'AUD'],
  ['$100', { homeCurrency: 'SEK' }, 100, 'USD'],
  ['$100', NONE, 100, 'USD'],
  ['¥1000', NONE, 1000, 'JPY'],
  ['Rs 500', NONE, 500, 'INR'],
  ['kr 100', US, 100, 'SEK'],

  // --- ranges become two prices --------------------------------------------
  ['100-200 kr', SE, 100, 'SEK'],
  ['$10 - $20', NONE, 10, 'USD'],
  ['1 299-1 499 kr', SE, 1299, 'SEK'],
  ['€50–€80', NONE, 50, 'EUR'],

  // --- rejects --------------------------------------------------------------
  ['RTX 4090', NONE, null],
  ['RTX 4090 Ti', NONE, null],
  ['Audi R8', NONE, null],
  ['iPhone 15 Pro', NONE, null],
  ['2024-01-15', NONE, null],
  ['15/01/2024', NONE, null],
  ['15.01.2024', NONE, null],
  ['2024-01-15 kr', SE, null],
  ['+46 70 123 45 67', SE, null],
  ['070-123 45 67', SE, null],
  ['123-45-67 kr', SE, null],
  ['20%', NONE, null],
  ['Save 20 %', NONE, null],
  ['€20%', NONE, null],
  ['Model 500', NONE, null],
  ['Chapter 7', NONE, null],
  ['try 500', NONE, null],
  ['all 500', NONE, null],
  ['top 100', NONE, null],
  ['cars 500', NONE, null],
  ['$0', NONE, null],

  // --- clock times, not prices ----------------------------------------------
  // ':dd' is the Swedish 499:99 form and 'H:MM' is the same shape, so every
  // opening hour on a page read as a price. An hour of 0-23 against minutes of
  // 0-59 is a time; 499:99 survives because 99 is no minute.
  ['09:55', NONE, null],
  ['09:55', SE, null],
  ['9:55', SE, null],
  ['08:00', SE, null],
  ['10:00', SE, null],
  ['19:30', SE, null],
  ['23:59', SE, null],
  ['1:30', SE, null],
  ['0:30', SE, null],
  ['00:30', SE, null],
  ['kl. 09:55', SE, null],
  ['klockan 18:00', SE, null],
  ['Levereras 09:55', SE, null],
  // Decided deliberately: both a valid time and a valid 12 kronor 15 ore, and
  // the time wins. A badge on a delivery slot is wrong on every page that shows
  // one; a missed 12:15 costs one badge on shops still writing ore.
  ['12:15', SE, null],
  ['20:50', SE, null],
  // The minutes make these impossible as a clock, so they stay prices.
  ['23:99', SE, 23.99, 'SEK'],
  ['99:55', SE, 99.55, 'SEK'],
  ['24:00', SE, 24, 'SEK'],
  // A quirk has to end where the number ends, or '09:555' reads as '09:55'.
  ['09:555', SE, null],
  // The period form never matched and must not start: these are times too.
  ['09.55', NONE, null],
  ['09.55', SE, null],
  ['19.30', SE, null],
  ['9.55', SE, null],

  // ':dd' is written by SEK alone, which used to make it SEK on any page in the
  // world. It now needs one rung of the ladder to corroborate it.
  ['499:99', NONE, null],
  ['499:99', { homeCurrency: 'USD' }, null],
  ['499:99', { homeCurrency: 'SEK' }, 499.99, 'SEK'],
  ['499:99', { pageLocale: 'sv-SE' }, 499.99, 'SEK'],
  ['499:99', { forcedCurrency: 'SEK' }, 499.99, 'SEK'],
  ['2 499:99', SE, 2499.99, 'SEK'],
];

test('every case parses to the expected amount and currency', () => {
  assert.ok(CASES.length >= 100, `expected at least 100 cases, got ${CASES.length}`);

  for (const [input, context, expectedAmount, expectedCurrency] of CASES) {
    const result = parser.parseOne(input, context);

    if (expectedAmount === null) {
      assert.equal(
        result,
        null,
        `${JSON.stringify(input)} must not parse, got ${JSON.stringify(result)}`,
      );
      continue;
    }

    assert.ok(result, `${JSON.stringify(input)} should parse, got null`);
    assert.equal(
      result.amount,
      expectedAmount,
      `${JSON.stringify(input)} amount: expected ${expectedAmount}, got ${result.amount}`,
    );
    assert.equal(
      result.currency,
      expectedCurrency,
      `${JSON.stringify(input)} currency: expected ${expectedCurrency}, got ${result.currency}`,
    );
  }
});

test('a range yields both ends with the same currency', () => {
  assert.deepEqual(
    parser.parsePrices('100-200 kr', SE).map((price) => [price.amount, price.currency]),
    [[100, 'SEK'], [200, 'SEK']],
  );
  assert.deepEqual(
    parser.parsePrices('$10 - $20', NONE).map((price) => price.amount),
    [10, 20],
  );
  assert.deepEqual(
    parser.parsePrices('1 299-1 499 kr', SE).map((price) => price.amount),
    [1299, 1499],
  );
});

test('several prices in one string are all found, in order', () => {
  assert.deepEqual(
    parser.parsePrices('Was $199.99, now $149.99', NONE).map((price) => price.amount),
    [199.99, 149.99],
  );
  assert.deepEqual(
    parser.parsePrices('¥1000 and 1000元', NONE).map((price) => price.currency),
    ['JPY', 'CNY'],
  );
});

test('a price is still found in a sentence that also contains rejects', () => {
  assert.deepEqual(
    parser.parsePrices('RTX 4090, 20% off, now 18 999 kr', SE).map((price) => price.amount),
    [18999],
  );
  assert.deepEqual(
    parser.parsePrices('Call +46 70 123 45 67 or pay 299 kr', SE).map((price) => price.amount),
    [299],
  );
});

test('the longest token wins where two readings overlap', () => {
  assert.equal(parser.parseOne('US$100', NONE).currency, 'USD');
  assert.equal(parser.parseOne('C$100', NONE).currency, 'CAD');
  assert.equal(parser.parseOne('NT$100', NONE).currency, 'TWD');
  assert.equal(parser.parsePrices('US$100', NONE).length, 1);
});

test('resolveCurrency applies the ladder in order', () => {
  // 1 forced beats everything below it
  assert.equal(
    parser.resolveCurrency('$', { forcedCurrency: 'CAD', pageCurrency: 'AUD', tld: 'x.nz' }).currency,
    'CAD',
  );
  // 2 an unambiguous token needs no resolution at all
  assert.equal(parser.resolveCurrency('US$', { forcedCurrency: 'CAD' }).via, 'token');
  // 2 an adjacent ISO code
  assert.equal(parser.resolveCurrency('$', { tld: 'x.ca' }, 'pay $100 USD').currency, 'USD');
  // 3 the page's declared currency, then its locale
  assert.equal(parser.resolveCurrency('$', { pageCurrency: 'AUD', tld: 'x.ca' }).currency, 'AUD');
  assert.equal(parser.resolveCurrency('$', { pageLocale: 'en-CA', tld: 'x.au' }).currency, 'CAD');
  // 4 the TLD
  assert.equal(parser.resolveCurrency('$', { tld: 'x.sg', homeCurrency: 'USD' }).currency, 'SGD');
  // 5 home if it shares the symbol, else the most common owner
  assert.equal(parser.resolveCurrency('$', { homeCurrency: 'NZD' }).currency, 'NZD');
  assert.equal(parser.resolveCurrency('$', { homeCurrency: 'SEK' }).currency, 'USD');
  assert.equal(parser.resolveCurrency('¥', {}).currency, 'JPY');
});

test('an unknown token resolves to nothing rather than a guess', () => {
  const resolved = parser.resolveCurrency('QQQ', { homeCurrency: 'USD' });
  assert.equal(resolved.currency, null);
  assert.equal(resolved.ambiguous, true);
});

test('a single-letter token needs the page or the user to back it up', () => {
  assert.equal(parser.parseOne('R500', NONE), null);
  assert.equal(parser.parseOne('R500', { homeCurrency: 'ZAR' }).currency, 'ZAR');
  assert.equal(parser.parseOne('R500', { tld: 'x.co.za' }).currency, 'ZAR');
  assert.equal(parser.parseOne('R500', { homeCurrency: 'USD' }), null);
});

test('zero-decimal currencies never read a trailing group as minor units', () => {
  assert.equal(parser.parseOne('¥1.234', NONE).amount, 1234);
  assert.equal(parser.parseOne('$1.234', NONE).amount, 1234);
  assert.equal(parser.parseOne('€1.234', NONE).amount, 1234);
  assert.equal(parser.parseOne('¥1,234', NONE).amount, 1234);
});

test('parseAmount rejects inconsistent grouping', () => {
  assert.ok(Number.isNaN(parser.parseAmount('1,234.567,89', null)));
});

test('parsePrices tolerates junk input', () => {
  assert.deepEqual(parser.parsePrices('', NONE), []);
  assert.deepEqual(parser.parsePrices(null, NONE), []);
  assert.deepEqual(parser.parsePrices(undefined, NONE), []);
  assert.deepEqual(parser.parsePrices('no prices here at all', NONE), []);
});
