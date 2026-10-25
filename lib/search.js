// Finding a currency by typing. Code, country or the currency's own name.
//
// The names are not shipped: Intl.DisplayNames already holds every country and
// currency name in every language the browser has, and lib/currencies.js carries
// the ISO 3166-1 region each currency belongs to. So a 162-row index costs no
// bytes in the zip and is automatically right in whatever language the UI is in.
// It is all local -- Intl reads no network -- so the privacy invariant holds.
//
// Coverage was checked across all 162 codes: every region resolves to a name in
// both languages, and only GGP, IMP and JEP have no currency name, CLDR having
// none for the crown dependencies. Those three stay findable by country.
(function (root) {
  'use strict';

  const Currencies = root.WorthItCurrencies;

  // Lower, better. The tiers exist so that typing 'se' puts SEK first instead of
  // burying it under every country with "se" somewhere in the middle.
  const EXACT_CODE = 0;
  // A whole symbol is a deliberate thing to type, so it outranks a code that
  // merely starts the same way: 'kr' means the kronor before it means KRW.
  const EXACT_SYMBOL = 1;
  const CODE_PREFIX = 2;
  const EXACT_REGION = 3;
  const NAME_PREFIX = 4;
  const NAME_SUBSTRING = 5;
  const SYMBOL_SUBSTRING = 6;
  const NO_MATCH = 99;

  /**
   * Case- and diacritic-insensitive form for comparing. 'Curaçao' folds to
   * 'curacao' and 'Österrike' to 'osterrike', so a keyboard without those keys
   * still finds them. Folding a/a/o onto a, a and o only ever widens a match,
   * which is what search should do even though they are separate letters in
   * Swedish.
   */
  function fold(text) {
    return String(text === null || text === undefined ? '' : text)
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .trim();
  }

  /** An Intl.DisplayNames, or null where the runtime has not got one. */
  function displayNames(language, type, style) {
    try {
      return new Intl.DisplayNames([language], { type: type, style: style });
    } catch {
      return null;
    }
  }

  /**
   * One name, or null. DisplayNames hands back the code it was given when it has
   * no name for it, which is not a name and must not be indexed as one -- it
   * would make every unknown code match its own letters twice over.
   */
  function nameFrom(formatter, code) {
    if (!formatter || !code) return null;
    try {
      const name = formatter.of(code);
      return name && name !== code ? name : null;
    } catch {
      return null;
    }
  }

  /**
   * Every region that spends a currency, not only the one it is issued from.
   * Without this, EUR is indexed as "European Union" alone and typing 'Germany'
   * or 'Österrike' finds nothing -- which is most of the point of searching by
   * country. REGION_CURRENCY is the map the ambiguity ladder already keeps, and
   * it is many-to-one onto EUR exactly where this is needed.
   */
  function regionsFor(code, ownRegion) {
    const regions = [];
    if (ownRegion) regions.push(ownRegion);
    Object.keys(Currencies.REGION_CURRENCY).forEach(function (region) {
      if (Currencies.REGION_CURRENCY[region] === code && regions.indexOf(region) === -1) {
        regions.push(region);
      }
    });
    return regions;
  }

  const caches = Object.create(null);

  /**
   * The searchable index for one language: every currency with its code, region,
   * the short and long country names, the currency's own name and its symbols,
   * each folded once here rather than on every keystroke.
   */
  function buildIndex(language) {
    const regionLong = displayNames(language, 'region', 'long');
    const regionShort = displayNames(language, 'region', 'short');
    const currencyName = displayNames(language, 'currency', 'long');

    return Currencies.CURRENCIES.map(function (currency) {
      const regions = regionsFor(currency.code, currency.region);
      const country = nameFrom(regionLong, currency.region);
      const money = nameFrom(currencyName, currency.code);

      // 'US' and 'United States' are both wanted; in Swedish the two styles
      // usually coincide, so the list de-duplicates them. Every region that
      // spends the currency contributes its names, which is how 'Germany' and
      // 'Tyskland' reach EUR.
      const names = [];
      const add = (name) => {
        const folded = fold(name);
        if (folded && names.indexOf(folded) === -1) names.push(folded);
      };
      regions.forEach(function (region) {
        add(nameFrom(regionLong, region));
        add(nameFrom(regionShort, region));
      });
      add(money);

      return {
        code: currency.code,
        region: currency.region,
        // What the row says underneath the code: the country, or the currency's
        // own name where there is no country to name (the CFA francs, the SDR).
        description: country || money || '',
        foldedCode: fold(currency.code),
        regions: regions.map(fold).filter(Boolean),
        names: names,
        symbols: currency.symbols.map(fold).filter(Boolean),
      };
    });
  }

  /** The index for a language, built once and kept. */
  function indexFor(language) {
    const key = String(language || 'en');
    if (!caches[key]) caches[key] = buildIndex(key);
    return caches[key];
  }

  /** Forgets the cached indexes, for a language change or a test. */
  function clearCache() {
    Object.keys(caches).forEach(function (key) {
      delete caches[key];
    });
  }

  /** How well one entry answers a folded query, as a tier. */
  function scoreEntry(entry, query) {
    if (entry.foldedCode === query) return EXACT_CODE;
    for (let i = 0; i < entry.symbols.length; i += 1) {
      if (entry.symbols[i] === query) return EXACT_SYMBOL;
    }
    if (entry.foldedCode.startsWith(query)) return CODE_PREFIX;
    if (entry.regions.indexOf(query) !== -1) return EXACT_REGION;

    for (let i = 0; i < entry.names.length; i += 1) {
      if (entry.names[i].startsWith(query)) return NAME_PREFIX;
    }
    for (let i = 0; i < entry.names.length; i += 1) {
      // A word inside the name counts as a prefix: 'emirates' should find the
      // United Arab Emirates, not rank below an incidental substring.
      if (entry.names[i].includes(' ' + query)) return NAME_PREFIX;
    }
    for (let i = 0; i < entry.names.length; i += 1) {
      if (entry.names[i].includes(query)) return NAME_SUBSTRING;
    }
    for (let i = 0; i < entry.symbols.length; i += 1) {
      if (entry.symbols[i].includes(query)) return SYMBOL_SUBSTRING;
    }
    return NO_MATCH;
  }

  /**
   * The entries matching a query, best first. An empty query is every currency
   * in table order, which is what an unfiltered picker should show.
   */
  function search(query, language) {
    const entries = indexFor(language);
    const folded = fold(query);
    if (!folded) return entries.slice();

    const hits = [];
    entries.forEach(function (entry) {
      const score = scoreEntry(entry, folded);
      if (score !== NO_MATCH) hits.push({ entry: entry, score: score });
    });

    // Ties break on the code, so the same query always gives the same order.
    hits.sort(function (a, b) {
      if (a.score !== b.score) return a.score - b.score;
      return a.entry.code < b.entry.code ? -1 : a.entry.code > b.entry.code ? 1 : 0;
    });

    return hits.map(function (hit) {
      return hit.entry;
    });
  }

  root.WorthItSearch = {
    fold: fold,
    buildIndex: buildIndex,
    indexFor: indexFor,
    clearCache: clearCache,
    search: search,
    SCORES: {
      EXACT_CODE: EXACT_CODE,
      CODE_PREFIX: CODE_PREFIX,
      EXACT_REGION: EXACT_REGION,
      NAME_PREFIX: NAME_PREFIX,
      EXACT_SYMBOL: EXACT_SYMBOL,
      NAME_SUBSTRING: NAME_SUBSTRING,
      SYMBOL_SUBSTRING: SYMBOL_SUBSTRING,
      NO_MATCH: NO_MATCH,
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.WorthItSearch;
}
