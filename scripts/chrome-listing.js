'use strict';

// Prints the Chrome Web Store description for one UI language, from the AMO
// listing in amo-metadata.json.
//
// Chrome's detailed description is pasted by hand, once per language, in the
// developer console's Store listing tab. The AMO text is the source, but it says
// browser sync would upload to "a Mozilla account", which is right on AMO and
// wrong on Chrome (docs/chrome/README.md). This swaps that one phrase per locale
// and refuses to print anything that still names Mozilla.
//
// It also adds the repository link after the MIT paragraph under OPEN SOURCE.
// AMO shows the homepage as a link beside the listing; Chrome's listing has no
// such field, so without this the text promises open source with nowhere to go.
//
//   npm run chrome:listing -- de
//   npm run chrome:listing -- zh-TW

const fs = require('node:fs');
const path = require('node:path');

// AMO's locale for each UI language. They differ on purpose: AMO spells Swedish
// 'sv-SE' and Spanish 'es-ES', and will not accept the bare codes the extension
// uses in I18n.LANGUAGES and in the stored language setting. docs/amo/README.md.
const AMO_LOCALE = {
  en: 'en-US',
  sv: 'sv-SE',
  fr: 'fr',
  de: 'de',
  es: 'es-ES',
  'pt-BR': 'pt-BR',
  ja: 'ja',
  'zh-CN': 'zh-CN',
  'zh-TW': 'zh-TW',
};

// The one AMO-specific phrase in each description, and what Chrome gets instead.
const VENDOR_NEUTRAL = {
  'en-US': ['uploaded to a Mozilla account', 'uploaded to a browser account'],
  'sv-SE': ['laddas upp till ett Mozilla-konto', 'laddas upp till ett webbläsarkonto'],
  fr: ['envoyé vers un compte Mozilla', 'envoyé vers un compte de navigateur'],
  de: ['in ein Mozilla-Konto hochgeladen', 'in ein Browserkonto hochgeladen'],
  'es-ES': ['se sube a una cuenta de Mozilla', 'se sube a una cuenta del navegador'],
  'pt-BR': ['enviado para uma conta Mozilla', 'enviado para uma conta do navegador'],
  ja: ['Mozilla アカウントにアップロード', 'ブラウザーのアカウントにアップロード'],
  'zh-CN': ['上传到 Mozilla 账户', '上传到浏览器账户'],
  'zh-TW': ['上傳到 Mozilla 帳號', '上傳到瀏覽器帳號'],
};

function readMetadata() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'amo-metadata.json'), 'utf8'));
}

/** The Chrome description for a UI language, or throws saying why not. */
function chromeDescription(language, metadata) {
  const locale = AMO_LOCALE[language];
  if (!locale) throw new Error(`no AMO locale is mapped for the UI language ${language}`);
  const meta = metadata || readMetadata();
  const text = meta.description[locale];
  if (!text) throw new Error(`amo-metadata.json has no description for ${locale}`);
  const swap = VENDOR_NEUTRAL[locale];
  if (!swap) throw new Error(`no vendor-neutral wording for ${locale}`);
  const [from, to] = swap;
  if (text.split(from).length !== 2) {
    throw new Error(`${locale}: expected the phrase ${JSON.stringify(from)} exactly once`);
  }
  const neutral = text.replace(from, to);
  if (/mozilla/i.test(neutral)) throw new Error(`${locale}: the Chrome text still names Mozilla`);
  return withRepositoryLink(neutral, meta.homepage['en-US'], locale);
}

/** The repository URL as its own line, straight after the paragraph naming MIT. */
function withRepositoryLink(text, url, locale) {
  if (!url) throw new Error('amo-metadata.json has no homepage');
  const paragraphs = text.split('\n\n');
  const mit = paragraphs.filter((paragraph) => /\bMIT\b/.test(paragraph));
  if (mit.length !== 1) {
    throw new Error(`${locale}: expected one paragraph naming MIT, found ${mit.length}`);
  }
  paragraphs.splice(paragraphs.indexOf(mit[0]) + 1, 0, url);
  return paragraphs.join('\n\n');
}

module.exports = { AMO_LOCALE, VENDOR_NEUTRAL, chromeDescription };

if (require.main === module) {
  const language = process.argv[2];
  if (!language) {
    console.error(`usage: npm run chrome:listing -- <${Object.keys(AMO_LOCALE).join('|')}>`);
    process.exit(1);
  }
  try {
    process.stdout.write(chromeDescription(language) + '\n');
  } catch (error) {
    console.error(`chrome-listing: ${error.message}`);
    process.exit(1);
  }
}
