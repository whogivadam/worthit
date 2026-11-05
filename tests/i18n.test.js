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
  // English sentence sitting in another table is a different matter, so only
  // words that actually contain letters count towards the threshold.
  const en = i18n.MESSAGES.en;
  i18n.LANGUAGES.filter((language) => language !== 'en').forEach((language) => {
    const table = i18n.MESSAGES[language];
    const sameButWordy = Object.keys(en).filter((key) => {
      if (en[key] !== table[key]) return false;
      const words = en[key]
        .replace(PLACEHOLDER, ' ')
        .split(/\s+/)
        .filter((word) => /\p{Letter}/u.test(word));
      return words.length >= 3;
    });
    assert.deepEqual(sameButWordy, [], `these read as English in the ${language} table`);
  });
});

test('the Chinese and Japanese tables are written in their own scripts', () => {
  // Machine translation can hand back the wrong script, and the two Chinese
  // tables are easy to swap by hand. A few characters that exist only in one
  // form are enough to tell them apart.
  const all = (language) => Object.values(i18n.MESSAGES[language]).join('');
  assert.match(all('ja'), /[\u3040-\u30ff]/, 'Japanese uses kana');
  assert.doesNotMatch(all('zh-CN'), /[設價貨幣歷錄網聯匯時鐘週儲]/, 'no Traditional in zh-CN');
  assert.doesNotMatch(all('zh-TW'), /[设价货币历录网联汇时钟周储]/, 'no Simplified in zh-TW');
  assert.doesNotMatch(all('zh-CN') + all('zh-TW'), /[\u3040-\u30ff]/, 'no kana in Chinese');
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
  assert.equal(i18n.resolve('fr', 'sv-SE'), 'sv');
  assert.equal(i18n.resolve(null, 'fr-FR'), 'en');
  assert.equal(i18n.resolve(null, null), 'en');
  assert.equal(i18n.resolve(undefined, undefined), 'en');
  assert.equal(i18n.resolve('', ''), 'en');
  assert.equal(i18n.resolve(42, {}), 'en');
});

test('a region or script picks the right table for Portuguese and Chinese', () => {
  assert.equal(i18n.resolve(null, 'de-AT'), 'de');
  assert.equal(i18n.resolve(null, 'es-MX'), 'es');
  assert.equal(i18n.resolve(null, 'ja-JP'), 'ja');
  assert.equal(i18n.resolve(null, 'ja'), 'ja');
  // one Portuguese table, Brazilian, and the European reader gets it too
  assert.equal(i18n.resolve(null, 'pt-BR'), 'pt-BR');
  assert.equal(i18n.resolve(null, 'pt_br'), 'pt-BR');
  assert.equal(i18n.resolve(null, 'pt-PT'), 'pt-BR');
  assert.equal(i18n.resolve(null, 'pt'), 'pt-BR');
  // Chinese goes by script: Taiwan, Hong Kong, Macau and Hant read Traditional
  assert.equal(i18n.resolve(null, 'zh-TW'), 'zh-TW');
  assert.equal(i18n.resolve(null, 'zh_TW'), 'zh-TW');
  assert.equal(i18n.resolve(null, 'zh-HK'), 'zh-TW');
  assert.equal(i18n.resolve(null, 'zh-MO'), 'zh-TW');
  assert.equal(i18n.resolve(null, 'zh-Hant'), 'zh-TW');
  assert.equal(i18n.resolve(null, 'zh-Hant-HK'), 'zh-TW');
  assert.equal(i18n.resolve(null, 'zh-CN'), 'zh-CN');
  assert.equal(i18n.resolve(null, 'zh-SG'), 'zh-CN');
  assert.equal(i18n.resolve(null, 'zh-Hans'), 'zh-CN');
  assert.equal(i18n.resolve(null, 'zh-Hans-HK'), 'zh-CN', 'the script outranks the region');
  assert.equal(i18n.resolve(null, 'zh'), 'zh-CN');
  // a stored setting has to be the exact code; it was written by the picker
  assert.equal(i18n.resolve('zh-TW', 'en-US'), 'zh-TW');
  assert.equal(i18n.resolve('zh_TW', 'en-US'), 'en');
  assert.equal(i18n.resolve('pt', 'en-US'), 'en');
});

test('setLanguage refuses anything it cannot render', () => {
  assert.equal(i18n.setLanguage('sv'), 'sv');
  assert.equal(i18n.language(), 'sv');
  assert.equal(i18n.setLanguage('fr'), 'en', 'an unsupported language falls back');
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
  i18n.setLanguage('de');
  assert.equal(i18n.formatHoursMinutes(3.75), '3 Std. 45 Min.');
  i18n.setLanguage('ja');
  assert.equal(i18n.formatHoursMinutes(3.75), '3時間45分');
  i18n.setLanguage('zh-TW');
  assert.equal(i18n.formatHoursMinutes(3.75), '3小時45分鐘');
  assert.equal(i18n.formatBadge(3.75, 40), '3h45m', 'the badge keeps the compact Latin form');
  // a price that cannot be converted is a symbol, the same either way
  assert.equal(i18n.formatBadge(NaN, 40), '?');
});

test('language names are written in their own language', () => {
  assert.equal(i18n.nameOf('en'), 'English');
  assert.equal(i18n.nameOf('sv'), 'Svenska');
  assert.equal(i18n.nameOf('de'), 'Deutsch');
  assert.equal(i18n.nameOf('zh-TW'), '繁體中文');
  assert.equal(i18n.nameOf('zz'), 'zz');
  i18n.LANGUAGES.forEach((code) => {
    assert.notEqual(i18n.nameOf(code), code, `${code} has no name in NAMES`);
  });
});

test('every language code is a tag the browser and Intl accept', () => {
  // The code goes into <html lang> and Intl.DisplayNames, which throws on an
  // underscore. Intl canonicalises a valid tag to itself.
  i18n.LANGUAGES.forEach((code) => {
    assert.deepEqual(Intl.getCanonicalLocales(code), [code], code);
  });
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
  // Browsers spell a region with an underscore there: 'zh-TW' lives in _locales/zh_TW/.
  const expected = i18n.LANGUAGES.map((code) => code.replace('-', '_'));
  assert.deepEqual(locales.sort(), expected.sort(), '_locales must match LANGUAGES');

  locales.forEach((locale) => {
    const messages = JSON.parse(read(path.join('_locales', locale, 'messages.json')));
    used.forEach((name) => {
      assert.ok(messages[name], `_locales/${locale} is missing ${name}`);
      assert.ok(messages[name].message, `_locales/${locale}/${name} has no message`);
    });
    // Chrome uses this as the store's short description and rejects the
    // package if it runs over 132 characters.
    const description = messages.extensionDescription.message;
    assert.ok(description.length <= 132, `_locales/${locale} description is ${description.length}`);
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

const STUB_VERSION = '7.6.5';

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
async function openPopup(language, browserLanguage, options) {
  const config = options || {};
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
    runtime: {
      sendMessage: async () => null,
      // Deliberately not the repository's own version: a test that stubbed the
      // real one would pass just as happily against a hardcoded string.
      getManifest: config.noManifest ? undefined : () => ({ version: STUB_VERSION }),
    },
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

test('every language comes up with no English left on screen', async () => {
  // The Swedish test above, for every table: the popup has to be readable in
  // the language it says it is in, down to the lang attribute that picks the
  // Han glyph forms.
  const english = ['SETTINGS', 'of your life', 'CLEAR HISTORY', 'THIS SITE', 'Nothing checked yet.'];
  for (const language of i18n.LANGUAGES.filter((code) => code !== 'en')) {
    const { document } = await openPopup(language);
    assert.equal(document.documentElement.lang, language);
    assert.equal(
      document.getElementById('open-settings').textContent,
      i18n.MESSAGES[language]['nav.settings']
    );
    english.forEach((phrase) => {
      assert.ok(!document.body.textContent.includes(phrase), `${language}: ${phrase} on screen`);
    });
  }
});

test('with nothing stored, the browser language decides', async () => {
  const swedish = await openPopup(undefined, 'sv-SE');
  assert.equal(swedish.document.documentElement.lang, 'sv');

  const taiwanese = await openPopup(undefined, 'zh-HK');
  assert.equal(taiwanese.document.documentElement.lang, 'zh-TW');

  const french = await openPopup(undefined, 'fr-FR');
  assert.equal(french.document.documentElement.lang, 'en', 'an unsupported language gets English');
  assert.equal(french.document.getElementById('open-settings').textContent, 'SETTINGS');
});

test('the popup footer shows the running version, in both languages', async () => {
  // #76. The stub is deliberately not the repository's own version, so a
  // hardcoded 'v0.4.1' in the popup could not pass this.
  const shipped = JSON.parse(read('manifest.json')).version;
  assert.notEqual(STUB_VERSION, shipped, 'the stub has to differ from the real version');

  for (const language of ['en', 'sv']) {
    const { document } = await openPopup(language);
    const version = document.getElementById('version');
    assert.equal(version.textContent, `v${STUB_VERSION}`, `${language}: the manifest's version`);
    assert.ok(version.classList.contains('muted'), `${language}: it stays muted`);
    assert.ok(version.closest('.footer'), `${language}: it lives in the footer`);
    assert.equal(
      version.previousElementSibling.id,
      'attribution',
      `${language}: below the rate line and the attribution`
    );
  }
});

test('a browser that will not name the version leaves the line empty', async () => {
  // The popup runs over its own HTML in the test suite and could run in a plain
  // page; neither should throw, and neither should print a guess.
  const { document } = await openPopup('en', 'en-US', { noManifest: true });
  assert.equal(document.getElementById('version').textContent, '');
  assert.equal(document.getElementById('rate-status').textContent.length > 0, true, 'and the rest of the footer still renders');
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
    [
      'English',
      'Svenska',
      'Deutsch',
      'Español',
      'Português (Brasil)',
      '日本語',
      '简体中文',
      '繁體中文',
    ]
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
