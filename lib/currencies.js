// The single data-driven source for price parsing. Every regex in the project is
// generated from this table at load time -- see lib/parser.js. Adding support for
// a currency means adding an entry here and nothing else.
//
// Entry shape:
//   code             ISO 4217 code, also always matched as a token on either side
//   symbols[]        symbol forms, e.g. '$', 'US$', 'kr'
//   words[]          spelled-out or native-script forms, e.g. 'kronor', '円'
//   position         'prefix' | 'suffix' | 'both' -- where the symbol normally sits.
//                    Both sides always parse; this only breaks ties between
//                    currencies competing for the same token.
//   decimal          the decimal separator this locale writes
//   thousands[]      the group separators this locale writes
//   zeroDecimal      true when the currency is written without a fractional part
//   specialSuffixes[] regional quirks that terminate an amount. ':-' and ',-' mean
//                    "and no minor units"; ':dd' means two decimal digits follow a
//                    colon, as in the Swedish 499:99
//   ambiguousSymbols[] the subset of symbols that several currencies share and that
//                    therefore need resolveCurrency() to pick an owner
//   region           ISO 3166-1 alpha-2 code of the issuing country, or 'EU', used
//                    only to draw a flag in the popup. null for the supranational
//                    codes that have no flag at any level; see NO_FLAG. This is a
//                    one-way label and takes no part in parsing -- REGION_CURRENCY
//                    below answers the opposite question, for the ambiguity ladder,
//                    and the two are deliberately not the same map.
(function (root) {
  'use strict';

  const NBSP = ' ';
  const NNBSP = ' ';
  const THIN = ' ';
  const SPACES = [' ', NBSP, NNBSP, THIN];

  // Separator conventions, shared by reference so the table stays readable.
  const DOT = { decimal: '.', thousands: [','].concat(SPACES) };
  const COMMA = { decimal: ',', thousands: ['.'].concat(SPACES) };
  const SPACED_COMMA = { decimal: ',', thousands: SPACES.concat(['.']) };
  const APOSTROPHE = { decimal: '.', thousands: ["'", '’'].concat(SPACES) };

  // Written without minor units. ISO 4217 says HUF and IDR have two, but prices in
  // both are universally written without them, and the spec calls for that reading.
  const ZERO_DECIMAL =
    'BIF CLP DJF GNF HUF IDR ISK JPY KMF KRW PYG RWF UGX VND VUV XAF XOF XPF'.split(' ');

  // Every code the primary rate provider publishes.
  const ALL_CODES = (
    'AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL ' +
    'BSD BTN BWP BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ' +
    'ERN ETB EUR FJD FKP GBP GEL GGP GHS GIP GMD GNF GTQ GYD HKD HNL HRK HTG HUF IDR ' +
    'ILS IMP INR IQD IRR ISK JEP JMD JOD JPY KES KGS KHR KMF KPW KRW KWD KYD KZT LAK ' +
    'LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MYR MZN NAD ' +
    'NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR SBD ' +
    'SCR SDG SEK SGD SHP SLE SLL SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY ' +
    'TTD TWD TZS UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XCG XDR XOF XPF YER ZAR ' +
    'ZMW ZWL'
  ).split(' ');

  // Currencies with no flag to draw. XAF and XOF are the two CFA francs, shared by
  // six and eight countries through their monetary unions; XPF is the CFP franc
  // across French Pacific territories; XCD is the East Caribbean dollar and XCG the
  // Caribbean guilder. None of those unions has a flag in Unicode. XDR is the IMF's
  // unit of account and is not a country's money at all.
  const NO_FLAG = 'XAF XCD XCG XDR XOF XPF'.split(' ');

  // Currency to issuing country, for the popup's flag. Alphabetical, so it reads
  // against ALL_CODES above. Many-to-one is fine and expected in this direction:
  // SLE and SLL are Sierra Leone's new and old leone, and EUR is the one entry that
  // is a union rather than a country, which 'EU' draws correctly.
  const CODE_REGION = (
    'AED:AE AFN:AF ALL:AL AMD:AM ANG:CW AOA:AO ARS:AR AUD:AU AWG:AW AZN:AZ ' +
    'BAM:BA BBD:BB BDT:BD BGN:BG BHD:BH BIF:BI BMD:BM BND:BN BOB:BO BRL:BR ' +
    'BSD:BS BTN:BT BWP:BW BYN:BY BZD:BZ CAD:CA CDF:CD CHF:CH CLP:CL CNY:CN ' +
    'COP:CO CRC:CR CUP:CU CVE:CV CZK:CZ DJF:DJ DKK:DK DOP:DO DZD:DZ EGP:EG ' +
    'ERN:ER ETB:ET EUR:EU FJD:FJ FKP:FK GBP:GB GEL:GE GGP:GG GHS:GH GIP:GI ' +
    'GMD:GM GNF:GN GTQ:GT GYD:GY HKD:HK HNL:HN HRK:HR HTG:HT HUF:HU IDR:ID ' +
    'ILS:IL IMP:IM INR:IN IQD:IQ IRR:IR ISK:IS JEP:JE JMD:JM JOD:JO JPY:JP ' +
    'KES:KE KGS:KG KHR:KH KMF:KM KPW:KP KRW:KR KWD:KW KYD:KY KZT:KZ LAK:LA ' +
    'LBP:LB LKR:LK LRD:LR LSL:LS LYD:LY MAD:MA MDL:MD MGA:MG MKD:MK MMK:MM ' +
    'MNT:MN MOP:MO MRU:MR MUR:MU MVR:MV MWK:MW MXN:MX MYR:MY MZN:MZ NAD:NA ' +
    'NGN:NG NIO:NI NOK:NO NPR:NP NZD:NZ OMR:OM PAB:PA PEN:PE PGK:PG PHP:PH ' +
    'PKR:PK PLN:PL PYG:PY QAR:QA RON:RO RSD:RS RUB:RU RWF:RW SAR:SA SBD:SB ' +
    'SCR:SC SDG:SD SEK:SE SGD:SG SHP:SH SLE:SL SLL:SL SOS:SO SRD:SR SSP:SS ' +
    'STN:ST SVC:SV SYP:SY SZL:SZ THB:TH TJS:TJ TMT:TM TND:TN TOP:TO TRY:TR ' +
    'TTD:TT TWD:TW TZS:TZ UAH:UA UGX:UG USD:US UYU:UY UZS:UZ VES:VE VND:VN ' +
    'VUV:VU WST:WS YER:YE ZAR:ZA ZMW:ZM ZWL:ZW'
  )
    .split(' ')
    .reduce(function (map, pair) {
      const parts = pair.split(':');
      map[parts[0]] = parts[1];
      return map;
    }, Object.create(null));

  // Currencies named in the spec, plus the ones sharing an ambiguous symbol with them.
  // Anything not listed here still parses by its ISO code through the generic entry.
  const DETAIL = {
    // --- the dollar family: '$' is the most contested symbol there is ---
    USD: Object.assign({ symbols: ['US$', 'USD$', '$'], words: ['dollar', 'dollars'], position: 'prefix', ambiguousSymbols: ['$'] }, DOT),
    CAD: Object.assign({ symbols: ['CA$', 'CAD$', 'C$', '$'], position: 'prefix', ambiguousSymbols: ['$'] }, DOT),
    AUD: Object.assign({ symbols: ['AU$', 'A$', '$'], position: 'prefix', ambiguousSymbols: ['$'] }, DOT),
    NZD: Object.assign({ symbols: ['NZ$', '$'], position: 'prefix', ambiguousSymbols: ['$'] }, DOT),
    HKD: Object.assign({ symbols: ['HK$', '$'], position: 'prefix', ambiguousSymbols: ['$'] }, DOT),
    SGD: Object.assign({ symbols: ['S$', '$'], position: 'prefix', ambiguousSymbols: ['$'] }, DOT),
    TWD: Object.assign({ symbols: ['NT$', '$'], position: 'prefix', ambiguousSymbols: ['$'] }, DOT),
    BRL: Object.assign({ symbols: ['R$'], words: ['reais', 'real'], position: 'prefix' }, COMMA),
    MXN: Object.assign({ symbols: ['MX$', 'MXN$', '$'], position: 'prefix', ambiguousSymbols: ['$'] }, DOT),
    ARS: Object.assign({ symbols: ['AR$', '$'], position: 'prefix', ambiguousSymbols: ['$'] }, COMMA),
    CLP: Object.assign({ symbols: ['CL$', '$'], position: 'prefix', ambiguousSymbols: ['$'] }, COMMA),
    COP: Object.assign({ symbols: ['CO$', '$'], position: 'prefix', ambiguousSymbols: ['$'] }, COMMA),
    UYU: Object.assign({ symbols: ['$U', '$'], position: 'prefix', ambiguousSymbols: ['$'] }, COMMA),

    // --- Europe ---
    EUR: Object.assign({ symbols: ['€'], words: ['euro', 'euros'], position: 'both', specialSuffixes: [',-'] }, SPACED_COMMA),
    GBP: Object.assign({ symbols: ['£'], words: ['pound', 'pounds'], position: 'prefix', ambiguousSymbols: ['£'] }, DOT),
    CHF: Object.assign({ symbols: ['Fr.', 'Fr', 'SFr.', 'SFr'], words: ['franken', 'francs'], position: 'both', ambiguousSymbols: ['Fr', 'Fr.'] }, APOSTROPHE),

    // Nordic 'kr' is shared four ways; 400:- and 400,- are the local shorthands.
    SEK: Object.assign({ symbols: ['kr'], words: ['kronor'], position: 'suffix', specialSuffixes: [':-', ':dd', ',-'], ambiguousSymbols: ['kr'] }, SPACED_COMMA),
    NOK: Object.assign({ symbols: ['kr'], words: ['kroner'], position: 'suffix', specialSuffixes: [',-', ':-'], ambiguousSymbols: ['kr'] }, SPACED_COMMA),
    DKK: Object.assign({ symbols: ['kr'], words: ['kroner'], position: 'suffix', specialSuffixes: [',-'], ambiguousSymbols: ['kr'] }, SPACED_COMMA),
    ISK: Object.assign({ symbols: ['kr'], words: ['kronur'], position: 'suffix', specialSuffixes: [',-'], ambiguousSymbols: ['kr'] }, SPACED_COMMA),

    PLN: Object.assign({ symbols: ['zł'], words: ['złotych', 'zlotych', 'zloty', 'złoty', 'zl'], position: 'suffix' }, SPACED_COMMA),
    CZK: Object.assign({ symbols: ['Kč', 'Kc'], words: ['korun'], position: 'suffix' }, SPACED_COMMA),
    HUF: Object.assign({ symbols: ['Ft'], words: ['forint'], position: 'suffix' }, SPACED_COMMA),
    RON: Object.assign({ symbols: ['lei', 'leu'], position: 'suffix' }, SPACED_COMMA),
    BGN: Object.assign({ symbols: ['лв.', 'лв'], words: ['leva'], position: 'suffix' }, SPACED_COMMA),
    RUB: Object.assign({ symbols: ['₽', 'руб.', 'руб', 'р.'], words: ['рублей'], position: 'suffix' }, SPACED_COMMA),
    UAH: Object.assign({ symbols: ['₴', 'грн.', 'грн'], position: 'suffix' }, SPACED_COMMA),
    TRY: Object.assign({ symbols: ['₺', 'TL'], words: ['lira'], position: 'both' }, COMMA),
    RSD: Object.assign({ symbols: ['дин.'], position: 'suffix' }, SPACED_COMMA),
    NGN: Object.assign({ symbols: ['₦'], position: 'prefix' }, DOT),

    // --- Asia: '¥' is shared by the yen and the yuan ---
    JPY: Object.assign({ symbols: ['¥', '￥'], words: ['円', 'yen'], position: 'both', ambiguousSymbols: ['¥', '￥'] }, DOT),
    CNY: Object.assign({ symbols: ['CN¥', 'RMB', '¥', '￥'], words: ['元', '人民币', 'yuan'], position: 'both', ambiguousSymbols: ['¥', '￥'] }, DOT),
    KRW: Object.assign({ symbols: ['₩'], words: ['원', 'won'], position: 'both' }, DOT),
    THB: Object.assign({ symbols: ['฿'], words: ['บาท', 'baht'], position: 'both' }, DOT),
    IDR: Object.assign({ symbols: ['Rp', 'Rp.'], words: ['rupiah'], position: 'prefix' }, COMMA),
    VND: Object.assign({ symbols: ['₫', 'đ'], words: ['dong'], position: 'suffix' }, COMMA),
    PHP: Object.assign({ symbols: ['₱'], words: ['piso'], position: 'prefix' }, DOT),
    MYR: Object.assign({ symbols: ['RM'], position: 'prefix' }, DOT),
    VES: Object.assign({ symbols: ['Bs.', 'Bs'], position: 'prefix' }, COMMA),

    // 'Rs' is shared across South Asia.
    INR: Object.assign({ symbols: ['₹', 'Rs.', 'Rs', '₨'], words: ['rupees', 'rupee'], position: 'prefix', ambiguousSymbols: ['Rs', 'Rs.', '₨'] }, DOT),
    PKR: Object.assign({ symbols: ['Rs.', 'Rs', '₨'], position: 'prefix', ambiguousSymbols: ['Rs', 'Rs.', '₨'] }, DOT),
    LKR: Object.assign({ symbols: ['Rs.', 'Rs', '₨'], position: 'prefix', ambiguousSymbols: ['Rs', 'Rs.', '₨'] }, DOT),
    NPR: Object.assign({ symbols: ['Rs.', 'Rs', '₨'], position: 'prefix', ambiguousSymbols: ['Rs', 'Rs.', '₨'] }, DOT),
    BDT: Object.assign({ symbols: ['৳', 'Tk'], position: 'prefix' }, DOT),

    // --- Middle East and Africa ---
    ILS: Object.assign({ symbols: ['₪'], words: ['ש"ח', 'ש״ח', 'שח', 'shekel'], position: 'both' }, DOT),
    EGP: Object.assign({ symbols: ['E£'], words: ['ج.م'], position: 'prefix' }, DOT),
    AED: Object.assign({ symbols: ['Dhs.', 'Dhs'], words: ['د.إ', 'dirham', 'dirhams'], position: 'suffix' }, DOT),
    SAR: Object.assign({ symbols: ['SR', '﷼'], words: ['ر.س', 'riyal'], position: 'suffix' }, DOT),
    KWD: Object.assign({ symbols: ['KD'], words: ['د.ك', 'dinar'], position: 'suffix' }, DOT),
    QAR: Object.assign({ symbols: ['QR'], words: ['ر.ق'], position: 'suffix' }, DOT),
    MAD: Object.assign({ symbols: ['DH'], words: ['د.م.'], position: 'suffix' }, DOT),

    // 'R' alone is the rand; it collides with nothing else that writes a bare R.
    ZAR: Object.assign({ symbols: ['R'], words: ['rand'], position: 'prefix', ambiguousSymbols: ['R'] }, SPACED_COMMA),
    KES: Object.assign({ symbols: ['KSh', 'Ksh'], position: 'prefix' }, DOT),
  };

  /** The generic entry every ISO code gets before DETAIL is layered on top. */
  function entryFor(code) {
    const detail = DETAIL[code] || {};
    return {
      code: code,
      symbols: detail.symbols || [],
      words: detail.words || [],
      position: detail.position || 'both',
      decimal: detail.decimal || '.',
      thousands: detail.thousands || [','].concat(SPACES),
      zeroDecimal: ZERO_DECIMAL.indexOf(code) !== -1,
      specialSuffixes: detail.specialSuffixes || [],
      ambiguousSymbols: detail.ambiguousSymbols || [],
      region: CODE_REGION[code] || null,
    };
  }

  const CURRENCIES = ALL_CODES.map(entryFor);

  const BY_CODE = CURRENCIES.reduce(function (map, currency) {
    map[currency.code] = currency;
    return map;
  }, Object.create(null));

  // Region to currency. Serves both the page-locale step and the TLD step of the
  // ambiguity ladder, so the mapping is written once.
  const REGION_CURRENCY = {
    AE: 'AED', AR: 'ARS', AT: 'EUR', AU: 'AUD', BE: 'EUR', BG: 'BGN', BR: 'BRL',
    CA: 'CAD', CH: 'CHF', CL: 'CLP', CN: 'CNY', CO: 'COP', CY: 'EUR', CZ: 'CZK',
    DE: 'EUR', DK: 'DKK', EE: 'EUR', EG: 'EGP', ES: 'EUR', FI: 'EUR', FR: 'EUR',
    GB: 'GBP', GR: 'EUR', HK: 'HKD', HR: 'EUR', HU: 'HUF', ID: 'IDR', IE: 'EUR',
    IL: 'ILS', IN: 'INR', IS: 'ISK', IT: 'EUR', JP: 'JPY', KE: 'KES', KR: 'KRW',
    KW: 'KWD', LK: 'LKR', LT: 'EUR', LU: 'EUR', LV: 'EUR', MA: 'MAD', MT: 'EUR',
    MX: 'MXN', MY: 'MYR', NG: 'NGN', NL: 'EUR', NO: 'NOK', NP: 'NPR', NZ: 'NZD',
    PH: 'PHP', PK: 'PKR', PL: 'PLN', PT: 'EUR', QA: 'QAR', RO: 'RON', RS: 'RSD',
    RU: 'RUB', SA: 'SAR', SE: 'SEK', SG: 'SGD', SI: 'EUR', SK: 'EUR', TH: 'THB',
    TR: 'TRY', TW: 'TWD', UA: 'UAH', US: 'USD', UY: 'UYU', VE: 'VES', VN: 'VND',
    ZA: 'ZAR',
  };

  // Top-level domains that are not a plain lower-cased region code.
  const TLD_REGION = { uk: 'GB', eu: null };

  // Step 5 of the ladder: when nothing else decides, the most common owner of a
  // shared symbol. Deliberately conservative -- a wrong guess here is worse than
  // an honest '?' badge, so only symbols with an overwhelming owner appear.
  const SYMBOL_DEFAULT_OWNER = {
    $: 'USD',
    '¥': 'JPY',
    '￥': 'JPY',
    '£': 'GBP',
    kr: 'SEK',
    R: 'ZAR',
    Rs: 'INR',
    'Rs.': 'INR',
    '₨': 'INR',
    Fr: 'CHF',
    'Fr.': 'CHF',
  };

  /**
   * The flag for an alpha-2 region code, as the two regional indicator symbols
   * Unicode builds flags from: 'SE' -> U+1F1F8 U+1F1EA. Derived rather than
   * stored, so no image or font ships in the extension.
   *
   * Returns '' for a missing or malformed region, which is also what the six
   * NO_FLAG codes get. Those rows simply start at the code; no placeholder is
   * substituted, because every candidate glyph claims something untrue.
   *
   * Firefox on Windows draws nothing here: Segoe UI Emoji carries no flag glyphs,
   * so the pair falls back to the letters 'SE'. That is a usable country hint, and
   * the ISO code is in the label either way, so nothing is lost by it.
   */
  function flagFor(region) {
    if (typeof region !== 'string' || !/^[A-Za-z]{2}$/.test(region)) return '';
    const upper = region.toUpperCase();
    return String.fromCodePoint(
      0x1f1e6 + upper.charCodeAt(0) - 65,
      0x1f1e6 + upper.charCodeAt(1) - 65
    );
  }

  /** The flag for a currency code, or '' when it has none. */
  function flagForCurrency(code) {
    const currency = BY_CODE[code];
    return currency ? flagFor(currency.region) : '';
  }

  /** Currency for a BCP 47 tag such as 'sv-SE', or null. */
  function currencyForLocale(locale) {
    if (!locale || typeof locale !== 'string') return null;
    const parts = locale.replace(/_/g, '-').split('-');
    for (let i = parts.length - 1; i >= 1; i -= 1) {
      const region = parts[i].toUpperCase();
      if (REGION_CURRENCY[region]) return REGION_CURRENCY[region];
    }
    return null;
  }

  /** Currency for a hostname's public suffix, or null. */
  function currencyForTld(hostOrTld) {
    if (!hostOrTld || typeof hostOrTld !== 'string') return null;
    const parts = hostOrTld.toLowerCase().replace(/\.$/, '').split('.');
    const tld = parts[parts.length - 1];
    if (!tld) return null;
    if (Object.prototype.hasOwnProperty.call(TLD_REGION, tld)) {
      const region = TLD_REGION[tld];
      return region ? REGION_CURRENCY[region] || null : null;
    }
    return REGION_CURRENCY[tld.toUpperCase()] || null;
  }

  root.WorthItCurrencies = {
    CURRENCIES: CURRENCIES,
    BY_CODE: BY_CODE,
    REGION_CURRENCY: REGION_CURRENCY,
    NO_FLAG: NO_FLAG,
    SYMBOL_DEFAULT_OWNER: SYMBOL_DEFAULT_OWNER,
    SPACES: SPACES,
    currencyForLocale: currencyForLocale,
    currencyForTld: currencyForTld,
    flagFor: flagFor,
    flagForCurrency: flagForCurrency,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.WorthItCurrencies;
}
