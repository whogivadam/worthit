'use strict';

// The string table, and the language switch.
//
// Two tables that must stay in step, a renderer that must never throw in a
// content script, and a popup that must come up in Swedish. The parity tests
// matter most: a key added to one language and forgotten in the other degrades
// silently to English, which is exactly the kind of bug nobody reports.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const i18n = require('../lib/i18n.js');
const calc = require('../lib/calc.js');

const PLACEHOLDER = /\{(\w+)\}/g;
const keysOf = (language) => Object.keys(i18n.MESSAGES[language]).sort();

test.afterEach(() => i18n.setLanguage(i18n.DEFAULT));

// --- the two tables --------------------------------------------------------

test('every language carries exactly the same keys', () => {
  const base = keysOf(i18n.DEFAULT);
  i18n.LANGUAGES.forEach((language) => {
    const keys = keysOf(language);
    const missing = base.filter((key) => !keys.includes(key));
    const extra = keys.filter((key) => !base.includes(key));
    assert.deepEqual(missing, [], `${language} is missing keys`);
    assert.deepEqual(extra, [], `${language} has keys no other language has`);
  });
});

test('a translation keeps the placeholders of the string it translates', () => {
  // '{days} dagar' is fine; 'dagar' alone would render a sentence with the
  // number silently dropped, and nothing else would catch it.
  const names = (template) => [...template.matchAll(PLACEHOLDER)].map((m) => m[1]).sort();
  keysOf(i18n.DEFAULT).forEach((key) => {
    const expected = names(i18n.MESSAGES[i18n.DEFAULT][key]);
    i18n.LANGUAGES.forEach((language) => {
      assert.deepEqual(names(i18n.MESSAGES[language][key]), expected, `${language} / ${key}`);
    });
  });
});

test('no string is left untranslated by accident', () => {
  // Product names, symbols and strings that are pure interpolation are
  // legitimately identical across languages -- 'rates.rateLine' is
  // '1 {from} = {rate} {to} (...)' and has no prose in it at all. A whole
  // English sentence sitting in the Swedish table is a different matter, so
  // only words that actually contain letters count towards the threshold.
  const en = i18n.MESSAGES.en;
  const sv = i18n.MESSAGES.sv;
  const sameButWordy = Object.keys(en).filter((key) => {
    if (en[key] !== sv[key]) return false;
    const words = en[key]
      .replace(PLACEHOLDER, ' ')
      .split(/\s+/)
      .filter((word) => /\p{Letter}/u.test(word));
    return words.length >= 3;
  });
  assert.deepEqual(sameButWordy, [], 'these read as English in the Swedish table');
});

test('every key lib/calc.js can return has a string in every language', () => {
  // calc returns keys and never prose, so a key it invents that the table does
  // not have would reach the user as a raw 'framing.wholeWorkday'.
  const source = read('lib/calc.js');
  const keys = [...source.matchAll(/key: '([\w.]+)'/g)].map((match) => match[1]);
  assert.ok(keys.length >= 10, `expected calc to return keys, found ${keys.length}`);
  keys.forEach((key) => {
    i18n.LANGUAGES.forEach((language) => {
      assert.ok(
        typeof i18n.MESSAGES[language][key] === 'string',
        `${language} has no string for ${key}, which lib/calc.js returns`
      );
    });
  });
});

test('lib/calc.js holds no user-facing prose of its own', () => {
  // Comments are allowed to discuss the wording; key names legitimately read
  // like it ('framing.coffeeBreak'). What must be gone is prose in a literal.
  const body = read('lib/calc.js')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/key: '[\w.]+'/g, '');
  ['of your life', 'work week', 'coffee break', 'Tuesday', "' min'", "' h '"].forEach((phrase) => {
    assert.ok(!body.includes(phrase), `lib/calc.js still contains ${JSON.stringify(phrase)}`);
  });
});

// --- resolving a language --------------------------------------------------

test('the stored setting wins, then the browser, then English', () => {
  assert.equal(i18n.resolve('sv', 'en-US'), 'sv');
  assert.equal(i18n.resolve(null, 'sv-SE'), 'sv');
  assert.equal(i18n.resolve(undefined, 'sv'), 'sv');
  assert.equal(i18n.resolve(null, 'sv_SE'), 'sv', 'underscore tags are real in the wild');
  assert.equal(i18n.resolve(null, 'SV-se'), 'sv');
  // a language this build does not carry falls through rather than sticking
  assert.equal(i18n.resolve('de', 'sv-SE'), 'sv');
  assert.equal(i18n.resolve(null, 'de-DE'), 'en');
  assert.equal(i18n.resolve(null, null), 'en');
  assert.equal(i18n.resolve(undefined, undefined), 'en');
  assert.equal(i18n.resolve('', ''), 'en');
  assert.equal(i18n.resolve(42, {}), 'en');
});

test('setLanguage refuses anything it cannot render', () => {
  assert.equal(i18n.setLanguage('sv'), 'sv');
  assert.equal(i18n.language(), 'sv');
  assert.equal(i18n.setLanguage('de'), 'en', 'an unsupported language falls back');
  assert.equal(i18n.setLanguage(null), 'en');
  assert.equal(i18n.setLanguage('__proto__'), 'en', 'not an inherited property');
  assert.equal(i18n.setLanguage('constructor'), 'en');
});

// --- rendering -------------------------------------------------------------

test('placeholders are filled, and an unused one is left alone', () => {
  i18n.setLanguage('en');
  assert.equal(i18n.t('framing.daysOfLife', { days: 1.2 }), '1.2 days of your life');
  assert.equal(i18n.t('result.overflowDays', { days: 3 }), '+3 days');
  // a placeholder with nothing supplied stays visible rather than becoming
  // 'undefined', so the gap is obvious instead of looking like a real word
  assert.equal(i18n.t('framing.daysOfLife', {}), '{days} days of your life');
  assert.equal(i18n.t('framing.daysOfLife'), '{days} days of your life');
  assert.equal(i18n.t('framing.daysOfLife', { days: 0 }), '0 days of your life');
});

test('an unknown key degrades to English and then to the key itself', () => {
  i18n.setLanguage('sv');
  assert.equal(i18n.t('framing.halfWorkday'), 'Halva din arbetsdag');
  // nothing in any table: visible, named, and not an exception thrown inside a
  // content script running on someone else's shop
  assert.equal(i18n.t('no.such.key'), 'no.such.key');
  assert.equal(i18n.t(''), '');
  assert.doesNotThrow(() => i18n.t(undefined));
  assert.doesNotThrow(() => i18n.t(null, { a: 1 }));
});

test('render takes what calc returns, and nothing from calc breaks it', () => {
  i18n.setLanguage('en');
  assert.equal(i18n.render(calc.framing(2.8, 40)), 'Half your workday');
  assert.equal(i18n.render(calc.framing(9.6, 40)), '1.2 days of your life');
  // framing returns null when it cannot say anything; render draws nothing
  assert.equal(i18n.render(calc.framing(5, 0)), '');
  assert.equal(i18n.render(null), '');
  assert.equal(i18n.render(undefined), '');
  assert.equal(i18n.render({}), '');
});

test('a worked example renders end to end in both languages', () => {
  // 25000/month over a 40-hour week is 144.23/h, so 1299 kr is 9 h 0 min.
  const rate = calc.hourlyRate({ incomeMode: 'monthly', monthly: 25000, hoursPerWeek: 40 });
  const time = calc.priceToTime(1299, rate);

  assert.equal(time.hours, 9);
  assert.equal(time.minutes, 0, 'a round hour drops the minutes rather than saying 0 min');

  i18n.setLanguage('en');
  assert.equal(i18n.formatHoursMinutes(time.totalHours), '9 h');
  assert.equal(i18n.formatBadge(time.totalHours, 40), '1.1d');
  // 9.01 h is past one 8-hour workday for the badge, but still under the 9.6 h
  // the framing ladder uses, so the badge says 1.1d while the line does not.
  assert.equal(i18n.render(calc.framing(time.totalHours, 40)), 'Your whole Tuesday');

  i18n.setLanguage('sv');
  assert.equal(i18n.formatHoursMinutes(time.totalHours), '9 tim');
  assert.equal(i18n.formatBadge(time.totalHours, 40), '1.1d');
  assert.equal(i18n.render(calc.framing(time.totalHours, 40)), 'Hela din tisdag');
});

test('the units differ between languages, in both the long and badge forms', () => {
  i18n.setLanguage('en');
  assert.equal(i18n.formatHoursMinutes(3.75), '3 h 45 min');
  assert.equal(i18n.formatBadge(3.75, 40), '3h45m');
  i18n.setLanguage('sv');
  assert.equal(i18n.formatHoursMinutes(3.75), '3 tim 45 min');
  assert.equal(i18n.formatBadge(3.75, 40), '3t45m');
  // a price that cannot be converted is a symbol, the same either way
  assert.equal(i18n.formatBadge(NaN, 40), '?');
});

test('language names are written in their own language', () => {
  assert.equal(i18n.nameOf('en'), 'English');
  assert.equal(i18n.nameOf('sv'), 'Svenska');
  assert.equal(i18n.nameOf('zz'), 'zz');
});

// --- _locales, for the strings Firefox renders -----------------------------

test('every __MSG_ placeholder in the manifest exists in every locale', () => {
  // These three are the only strings an extension cannot repaint at runtime, so
  // they go through _locales. A placeholder with no entry stops the extension
  // loading at all, which no other test here would catch.
  const manifest = read('manifest.json');
  const used = [...manifest.matchAll(/__MSG_(\w+)__/g)].map((match) => match[1]);
  assert.ok(used.length >= 3, 'expected the manifest to use _locales');

  const locales = fs
    .readdirSync(path.join(root, '_locales'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  assert.deepEqual(locales.sort(), [...i18n.LANGUAGES].sort(), '_locales must match LANGUAGES');

  locales.forEach((locale) => {
    const messages = JSON.parse(read(path.join('_locales', locale, 'messages.json')));
    used.forEach((name) => {
      assert.ok(messages[name], `_locales/${locale} is missing ${name}`);
      assert.ok(messages[name].message, `_locales/${locale}/${name} has no message`);
    });
  });
});

test('the manifest declares the default locale it falls back to', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.default_locale, i18n.DEFAULT);
  assert.ok(
    fs.existsSync(path.join(root, '_locales', manifest.default_locale, 'messages.json')),
    'default_locale must have a messages.json'
  );
});

test('the content script loads the string table before it uses it', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const scripts = manifest.content_scripts[0].js;
  assert.ok(scripts.includes('lib/i18n.js'), 'content scripts must load lib/i18n.js');
  assert.ok(
    scripts.indexOf('lib/calc.js') < scripts.indexOf('lib/i18n.js'),
    'i18n formats what calc returns, so calc loads first'
  );
  assert.ok(
    scripts.indexOf('lib/i18n.js') < scripts.indexOf('content/content.js'),
    'content.js uses the table'
  );
});

// --- the popup, in Swedish -------------------------------------------------

const SCRIPTS = [
  'lib/currencies.js',
  'lib/parser.js',
  'lib/calc.js',
  'lib/i18n.js',
  'lib/search.js',
  'lib/rates.js',
  'popup/popup.js',
].map((file) => read(file));

const RATES = { USD: 1, SEK: 9.8785 };

function storedWith(language) {
  return {
    settings: {
      incomeMode: 'monthly',
      monthly: 25000,
      hourly: '',
      hoursPerWeek: 40,
      homeCurrency: 'SEK',
      overlayEnabled: true,
      language: language,
    },
    sites: {},
    history: [],
    ratesCache: {
      base: 'USD',
      rates: RATES,
      rateDate: '2026-10-25',
      source: 'er-api',
      fetchedAt: Date.now(),
    },
  };
}

/** Boots the real popup over its real HTML. Returns the window and what it saved. */
async function openPopup(language, browserLanguage) {
  const dom = new JSDOM(read('popup/popup.html'), {
    runScripts: 'outside-only',
    url: 'moz-extension://worthit/popup/popup.html',
  });
  const { window } = dom;
  const saved = [];
  let stored = storedWith(language);
  Object.defineProperty(window.navigator, 'language', {
    value: browserLanguage || 'en-US',
    configurable: true,
  });
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
  return { window, document: window.document, saved };
}

test('the popup comes up in the stored language', async () => {
  const { document } = await openPopup('sv');
  assert.equal(document.documentElement.lang, 'sv');
  assert.equal(document.getElementById('open-settings').textContent, 'INSTÄLLNINGAR');
  assert.equal(document.getElementById('open-settings').getAttribute('title'), 'Inställningar');
  assert.equal(document.querySelector('.of-your-life').textContent, 'av ditt liv');
  assert.equal(document.getElementById('share').textContent, 'KOPIERA');
  assert.equal(document.getElementById('history-empty').textContent, 'Inget kontrollerat än.');
  assert.equal(document.getElementById('clear').textContent, 'RENSA HISTORIK');
  assert.equal(
    document.getElementById('price').getAttribute('aria-label'),
    'Pris',
    'aria-labels are translated too, not just visible text'
  );
});

test('no English is left on screen when the popup is Swedish', async () => {
  const { document } = await openPopup('sv');
  ['SETTINGS', 'of your life', 'CLEAR HISTORY', 'THIS SITE', 'Nothing checked yet.'].forEach(
    (phrase) => {
      assert.ok(
        !document.body.textContent.includes(phrase),
        `${JSON.stringify(phrase)} is still on screen`
      );
    }
  );
});

test('with nothing stored, the browser language decides', async () => {
  const swedish = await openPopup(undefined, 'sv-SE');
  assert.equal(swedish.document.documentElement.lang, 'sv');

  const german = await openPopup(undefined, 'de-DE');
  assert.equal(german.document.documentElement.lang, 'en', 'an unsupported language gets English');
  assert.equal(german.document.getElementById('open-settings').textContent, 'SETTINGS');
});

test('the language picker lists every language in its own language', async () => {
  const { document } = await openPopup('en');
  document.getElementById('open-settings').click();
  const options = [...document.getElementById('language').options];
  assert.deepEqual(
    options.map((option) => option.value),
    [...i18n.LANGUAGES]
  );
  assert.deepEqual(
    options.map((option) => option.textContent),
    ['English', 'Svenska']
  );
  assert.equal(document.getElementById('language').value, 'en');
});

test('switching the language repaints the popup and saves the choice', async () => {
  const { window, document, saved } = await openPopup('en');
  document.getElementById('open-settings').click();
  assert.equal(document.querySelector('[data-i18n="settings.save"]').textContent, 'SAVE');

  const select = document.getElementById('language');
  select.value = 'sv';
  select.dispatchEvent(new window.Event('change'));
  await new Promise((resolve) => window.setTimeout(resolve, 0));

  assert.equal(document.querySelector('[data-i18n="settings.save"]').textContent, 'SPARA');
  assert.equal(document.getElementById('open-settings').textContent, 'INSTÄLLNINGAR');
  assert.equal(document.documentElement.lang, 'sv');
  assert.equal(select.value, 'sv', 'the picker keeps the new language selected');

  // Saved at once rather than on SAVE, so BACK cannot revert a language the
  // user is already reading.
  const languages = saved.filter((update) => update.settings).map((u) => u.settings.language);
  assert.ok(languages.includes('sv'), 'the language should be persisted on change');
});

test('switching the language leaves the income settings alone', async () => {
  const { window, document, saved } = await openPopup('en');
  document.getElementById('open-settings').click();
  const select = document.getElementById('language');
  select.value = 'sv';
  select.dispatchEvent(new window.Event('change'));
  await new Promise((resolve) => window.setTimeout(resolve, 0));

  const update = saved.filter((u) => u.settings).pop().settings;
  assert.equal(update.monthly, 25000);
  assert.equal(update.hoursPerWeek, 40);
  assert.equal(update.homeCurrency, 'SEK');
  assert.equal(update.incomeMode, 'monthly');
  assert.equal(update.overlayEnabled, true);
});

test('the Swedish popup still shows flags, codes and symbols in the picker', async () => {
  const { document } = await openPopup('sv');
  document.getElementById('source-currency').focus();
  const rows = [...document.querySelectorAll('#source-currency-list [role="option"]')];
  const sek = rows.find((row) => row.dataset.code === 'SEK');
  assert.equal(
    sek.querySelector('.combo-label').textContent,
    '\u{1F1F8}\u{1F1EA} SEK kr',
    'the flag, code and symbol are language-neutral'
  );
  assert.equal(
    sek.querySelector('.combo-description').textContent,
    'Sverige',
    'but the country name beside it follows the UI language'
  );

  document.getElementById('site-currency').focus();
  const blank = document.querySelector('#site-currency-list [role="option"]');
  assert.equal(blank.dataset.code, '');
  assert.equal(
    blank.querySelector('.combo-label').textContent,
    'Identifiera automatiskt',
    'and the blank row is translated'
  );
});
