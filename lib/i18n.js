// The UI language, and every string the user reads.
//
// This is a table in the extension rather than browser.i18n and _locales/,
// because browser.i18n resolves against the *browser's* UI locale when the
// extension loads and has no runtime override -- no setLocale, no way back. An
// extension built on it can be translated but not switched, and the point here is
// a switch in Settings that takes effect at once. _locales/ is still used, for
// the three manifest strings Firefox renders in about:addons and the toolbar,
// which no extension can repaint at runtime.
//
// Adding a language means adding one block to MESSAGES. Nothing outside this file
// holds a user-facing string: lib/calc.js returns keys and numbers, and the
// popup and the content script render them through render() and t().
(function (root) {
  'use strict';

  const DEFAULT = 'en';

  // Language names are written in their own language, as they are everywhere
  // else, so the picker is readable whichever language is active.
  const NAMES = { en: 'English', sv: 'Svenska' };

  const MESSAGES = {
    en: {
      'nav.settings': 'SETTINGS',
      'nav.settingsTitle': 'Settings',
      'price.label': 'Price',
      'price.currencyLabel': 'Currency of this price',

      'result.ofYourLife': 'of your life',
      'result.copy': 'COPY',
      'result.copied': 'COPIED',
      'result.copyFailed': 'COPY FAILED',
      'result.overflowDays': '+{days} days',

      'history.title': 'HISTORY',
      'history.empty': 'Nothing checked yet.',
      'history.clear': 'CLEAR HISTORY',
      'history.total': '{time} total',

      'site.title': 'THIS SITE',
      'site.disable': 'Disable on this site',
      'site.forceCurrency': 'Force currency on this site',
      'site.autoDetect': 'Auto-detect',

      'rates.attribution': 'Rates by ExchangeRate-API',
      'rates.refresh': 'REFRESH',
      'rates.none': 'No rates yet',
      'rates.updated': 'Rates updated {date} · {source}',
      'rates.unknownDate': 'unknown',
      'rates.unknownDateLong': 'unknown date',
      'rates.sourceSnapshot': 'bundled snapshot',
      'rates.noRateFor': 'No rate for {code} yet. Try Refresh, or pick another currency.',
      'rates.noneYetShort': 'no rates yet',
      'rates.unavailable': 'rate unavailable ({source}, {date})',
      'rates.rateLine': '1 {from} = {rate} {to} ({date}, {source})',

      'settings.firstRun':
        'One thing first: what do you earn after tax? It stays on this machine.',
      'settings.income': 'INCOME',
      'settings.monthly': 'Monthly, after tax',
      'settings.monthlyLabel': 'Monthly after-tax income',
      'settings.hourly': 'Hourly, after tax',
      'settings.hourlyLabel': 'Hourly after-tax rate',
      'settings.hoursPerWeek': 'Hours worked per week',
      'settings.homeCurrency': 'Home currency',
      'settings.showBadges': 'Show badges next to prices on pages',
      'settings.language': 'Language',
      'settings.save': 'SAVE',
      'settings.back': 'BACK',
      'settings.errorHourly': 'Enter an hourly rate above zero.',
      'settings.errorMonthly': 'Enter a monthly income above zero, and hours per week.',

      // A named weekday standing in for one ordinary working day. Each language
      // picks its own idiom for that; it is not a word-for-word translation.
      'framing.coffeeBreak': 'A coffee break',
      'framing.quickErrand': 'A quick errand',
      'framing.halfWorkday': 'Half your workday',
      'framing.wholeWorkday': 'Your whole Tuesday',
      'framing.daysOfLife': '{days} days of your life',
      'framing.wholeWorkWeek': 'Your whole work week',
      'framing.workWeeks': '{weeks} work weeks',

      'time.hoursMinutes': '{hours} h {minutes} min',
      'time.hours': '{hours} h',
      'time.minutes': '{minutes} min',

      'badge.hoursMinutes': '{hours}h{minutes}m',
      'badge.hours': '{hours}h',
      'badge.minutes': '{minutes}m',
      'badge.days': '{days}d',
      // The honest answer when a price cannot be converted. A symbol, so it is
      // the same in every language, but it lives here so render() can reach it.
      'badge.unknown': '?',
      'badge.ofYourWork': '= {time} of your work',
      'badge.noRate': 'No exchange rate for {what}, so this is not converted.',
      'badge.thisCurrency': 'this currency',

      'share.clipboard': '{price} = {time} of my life. Worth it?',
    },

    sv: {
      'nav.settings': 'INSTÄLLNINGAR',
      'nav.settingsTitle': 'Inställningar',
      'price.label': 'Pris',
      'price.currencyLabel': 'Valuta för priset',

      'result.ofYourLife': 'av ditt liv',
      'result.copy': 'KOPIERA',
      'result.copied': 'KOPIERAT',
      'result.copyFailed': 'KOPIERING MISSLYCKADES',
      'result.overflowDays': '+{days} dagar',

      'history.title': 'HISTORIK',
      'history.empty': 'Inget kontrollerat än.',
      'history.clear': 'RENSA HISTORIK',
      'history.total': '{time} totalt',

      'site.title': 'DEN HÄR SIDAN',
      'site.disable': 'Stäng av på den här sidan',
      'site.forceCurrency': 'Tvinga valuta på den här sidan',
      'site.autoDetect': 'Identifiera automatiskt',

      'rates.attribution': 'Växelkurser från ExchangeRate-API',
      'rates.refresh': 'UPPDATERA',
      'rates.none': 'Inga kurser än',
      'rates.updated': 'Kurser uppdaterade {date} · {source}',
      'rates.unknownDate': 'okänt',
      'rates.unknownDateLong': 'okänt datum',
      'rates.sourceSnapshot': 'medföljande kopia',
      'rates.noRateFor': 'Ingen kurs för {code} än. Prova Uppdatera, eller välj en annan valuta.',
      'rates.noneYetShort': 'inga kurser än',
      'rates.unavailable': 'kurs saknas ({source}, {date})',
      'rates.rateLine': '1 {from} = {rate} {to} ({date}, {source})',

      'settings.firstRun':
        'En sak först: vad tjänar du efter skatt? Det stannar på den här datorn.',
      'settings.income': 'INKOMST',
      'settings.monthly': 'Per månad, efter skatt',
      'settings.monthlyLabel': 'Månadsinkomst efter skatt',
      'settings.hourly': 'Per timme, efter skatt',
      'settings.hourlyLabel': 'Timlön efter skatt',
      'settings.hoursPerWeek': 'Arbetstimmar per vecka',
      'settings.homeCurrency': 'Din valuta',
      'settings.showBadges': 'Visa märken vid priser på sidor',
      'settings.language': 'Språk',
      'settings.save': 'SPARA',
      'settings.back': 'TILLBAKA',
      'settings.errorHourly': 'Ange en timlön över noll.',
      'settings.errorMonthly': 'Ange en månadsinkomst över noll, och timmar per vecka.',

      // 'En fika' is the idiom a Swede would reach for here, and it is the same
      // length of time the English line means.
      'framing.coffeeBreak': 'En fikapaus',
      'framing.quickErrand': 'Ett snabbt ärende',
      'framing.halfWorkday': 'Halva din arbetsdag',
      'framing.wholeWorkday': 'Hela din tisdag',
      'framing.daysOfLife': '{days} dagar av ditt liv',
      'framing.wholeWorkWeek': 'Hela din arbetsvecka',
      'framing.workWeeks': '{weeks} arbetsveckor',

      'time.hoursMinutes': '{hours} tim {minutes} min',
      'time.hours': '{hours} tim',
      'time.minutes': '{minutes} min',

      'badge.hoursMinutes': '{hours}t{minutes}m',
      'badge.hours': '{hours}t',
      'badge.minutes': '{minutes}m',
      'badge.days': '{days}d',
      'badge.unknown': '?',
      'badge.ofYourWork': '= {time} av ditt arbete',
      'badge.noRate': 'Ingen växelkurs för {what}, så detta är inte omräknat.',
      'badge.thisCurrency': 'den här valutan',

      'share.clipboard': '{price} = {time} av mitt liv. Värt det?',
    },
  };

  const LANGUAGES = Object.keys(MESSAGES);

  let current = DEFAULT;

  /** True for a language this build actually carries. */
  function isSupported(language) {
    return typeof language === 'string' && Object.prototype.hasOwnProperty.call(MESSAGES, language);
  }

  /**
   * The language to start in: the stored setting if it is one we have, else the
   * browser's own language, else English. A tag like 'sv-SE' matches 'sv'.
   */
  function resolve(stored, browserLanguage) {
    if (isSupported(stored)) return stored;
    if (typeof browserLanguage === 'string') {
      const base = browserLanguage.toLowerCase().replace(/_/g, '-').split('-')[0];
      if (isSupported(base)) return base;
    }
    return DEFAULT;
  }

  function setLanguage(language) {
    current = isSupported(language) ? language : DEFAULT;
    return current;
  }

  function language() {
    return current;
  }

  /**
   * One string, with {placeholders} filled from vars.
   *
   * Falls back through English to the key itself. A key that has gone missing
   * shows up as 'framing.wholeWorkday' in the UI, which is ugly on purpose: it
   * is visible, it names what is wrong, and it is not a thrown exception in a
   * content script running on someone's shop.
   */
  function t(key, vars) {
    const table = MESSAGES[current] || MESSAGES[DEFAULT];
    let template = table[key];
    if (typeof template !== 'string') template = MESSAGES[DEFAULT][key];
    if (typeof template !== 'string') return String(key);
    if (!vars) return template;
    return template.replace(/\{(\w+)\}/g, function (match, name) {
      const value = vars[name];
      return value === undefined || value === null ? match : String(value);
    });
  }

  /**
   * Renders what lib/calc.js returns: a { key, ...vars } object, or null when
   * there is nothing to say. Keeps the arithmetic and the wording apart.
   */
  function render(parts) {
    if (!parts || !parts.key) return '';
    return t(parts.key, parts);
  }

  /** '3 h 45 min', localised. */
  function formatHoursMinutes(totalHours) {
    return render(root.WorthItCalc.durationParts(totalHours));
  }

  /** The compact badge form, '3h45m' or '2.5d', localised. */
  function formatBadge(totalHours, hoursPerWeek) {
    return render(root.WorthItCalc.badgeParts(totalHours, hoursPerWeek));
  }

  /** The display name of a language, in that language. */
  function nameOf(code) {
    return NAMES[code] || code;
  }

  root.WorthItI18n = {
    DEFAULT: DEFAULT,
    LANGUAGES: LANGUAGES,
    MESSAGES: MESSAGES,
    isSupported: isSupported,
    resolve: resolve,
    setLanguage: setLanguage,
    language: language,
    t: t,
    render: render,
    formatHoursMinutes: formatHoursMinutes,
    formatBadge: formatBadge,
    nameOf: nameOf,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.WorthItI18n;
}
