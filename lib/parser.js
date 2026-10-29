// Price detection. Every pattern here is generated from lib/currencies.js at load
// time: there is no hand-written per-currency regex anywhere, so a new currency is
// a table entry and nothing more.
//
// parsePrices(text, context) -> [{ amount, currency, raw, index, length, ambiguous, via }]
// parseOne(text, context)    -> the first result, or null
//
// `context` carries what the page knows, so resolveCurrency() stays pure:
//   { forcedCurrency, pageCurrency, pageLocale, tld, homeCurrency }
(function (root) {
  'use strict';

  const CUR =
    root.WorthItCurrencies ||
    (typeof module !== 'undefined' && typeof require === 'function'
      ? require('./currencies.js')
      : null);

  if (!CUR) throw new Error('WorthItCurrencies must be loaded before WorthItParser');

  const SPACE_CLASS = "[\\s\\u00A0\\u202F\\u2009'\\u2019]";

  function escapeRe(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ---------------------------------------------------------------------------
  // Token table, built from the currency table
  // ---------------------------------------------------------------------------

  // An ISO 4217 code is matched upper-case only. Case-folding them would turn
  // ALL, BOB, CUP, MOP, PEN, SOS, TOP and TRY into currency tokens and badge
  // every "try 500" on the web.
  const CODE_TOKENS = Object.create(null);
  // Symbols and words are matched in any case, so 'kr', 'KR' and 'Kr' all work.
  const TEXT_TOKENS = Object.create(null);

  function addToken(map, token, code) {
    if (!token) return;
    const key = map === CODE_TOKENS ? token : token.toLowerCase();
    if (!map[key]) map[key] = [];
    if (map[key].indexOf(code) === -1) map[key].push(code);
  }

  CUR.CURRENCIES.forEach(function (currency) {
    addToken(CODE_TOKENS, currency.code, currency.code);
    currency.symbols.forEach(function (symbol) {
      addToken(TEXT_TOKENS, symbol, currency.code);
    });
    currency.words.forEach(function (word) {
      addToken(TEXT_TOKENS, word, currency.code);
    });
  });

  /** Case variants so a single case-sensitive regex can still match any casing. */
  function caseVariants(token) {
    const lower = token.toLowerCase();
    const upper = token.toUpperCase();
    const title = token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    return [token, lower, upper, title].filter(function (value, index, all) {
      return all.indexOf(value) === index;
    });
  }

  /**
   * Wraps a token so it cannot match inside a word. Letters are excluded on both
   * sides but digits are not, so 'SEK400' and '400kr' still parse.
   */
  function tokenPattern(token) {
    const before = /^[\p{L}]/u.test(token) ? '(?<![\\p{L}])' : '';
    const after = /[\p{L}]$/u.test(token) ? '(?![\\p{L}])' : '';
    return before + escapeRe(token) + after;
  }

  const ALL_TOKEN_FORMS = [];
  Object.keys(CODE_TOKENS).forEach(function (code) {
    ALL_TOKEN_FORMS.push(code);
  });
  Object.keys(TEXT_TOKENS).forEach(function (token) {
    caseVariants(token).forEach(function (variant) {
      ALL_TOKEN_FORMS.push(variant);
    });
  });

  // Longest first, so 'US$' wins over '$' and 'Rs.' over 'Rs'.
  const TOKEN = '(?:' +
    ALL_TOKEN_FORMS.slice()
      .sort(function (a, b) {
        return b.length - a.length || (a < b ? -1 : 1);
      })
      .map(tokenPattern)
      .join('|') +
    ')';

  /** The currencies that write this token, most specific casing first. */
  function ownersFor(token) {
    if (CODE_TOKENS[token]) return CODE_TOKENS[token];
    const lower = String(token).toLowerCase();
    return TEXT_TOKENS[lower] || [];
  }

  // ---------------------------------------------------------------------------
  // Number and quirk patterns
  // ---------------------------------------------------------------------------

  const GROUP_SEP = "[.,\\u00A0\\u202F\\u2009'\\u2019 ]";
  // Indian grouping is self-identifying: groups of two before a final group of three.
  const INDIAN = '\\d{1,2}(?:,\\d{2})+,\\d{3}(?:\\.\\d{1,2})?';
  const GROUPED = '\\d{1,3}(?:' + GROUP_SEP + '\\d{3})+(?:[.,]\\d{1,2})?';
  const PLAIN = '\\d+(?:[.,]\\d{1,2})?';
  const NUM = '(?:' + INDIAN + '|' + GROUPED + '|' + PLAIN + ')';

  const INDIAN_RE = new RegExp('^' + INDIAN + '$');

  // Regional quirks, collected from the table rather than listed here. ':dd' is
  // the Swedish 499:99 form; ':-' and ',-' mean "and no minor units".
  const QUIRK_FORMS = [];
  CUR.CURRENCIES.forEach(function (currency) {
    currency.specialSuffixes.forEach(function (suffix) {
      if (QUIRK_FORMS.indexOf(suffix) === -1) QUIRK_FORMS.push(suffix);
    });
  });

  function quirkPattern(suffix) {
    return suffix === ':dd' ? ':\\d{2}' : escapeRe(suffix);
  }

  const QUIRK = '(?:' +
    QUIRK_FORMS.slice()
      .sort(function (a, b) {
        return b.length - a.length;
      })
      .map(quirkPattern)
      .join('|') +
    ')';

  /** The currencies that write this quirk suffix. */
  function quirkOwners(raw) {
    const normalised = /^:\d{2}$/.test(raw) ? ':dd' : raw;
    return CUR.CURRENCIES.filter(function (currency) {
      return currency.specialSuffixes.indexOf(normalised) !== -1;
    }).map(function (currency) {
      return currency.code;
    });
  }

  const GAP = '[\\s\\u00A0\\u202F\\u2009]{0,2}';
  const DASH = '\\s*[-\\u2013\\u2014]\\s*';

  // tokenPattern() excludes letters on both sides of a token but allows digits,
  // which 'SEK400' and '400kr' need. That is only safe on the side the number is
  // on: digits past a trailing token, or before a leading one, belong to no
  // price, and without these guards 'rm' inside '1902rm2193u121123fsdf' reads as
  // 1902 MYR. RE_QUIRK has carried the same lookahead since '09:555'.
  const NO_DIGIT_BEFORE = '(?<!\\d)';
  const NO_DIGIT_AFTER = '(?!\\d)';

  // Ranges are scanned first and consume their whole span, so "100-200 kr"
  // becomes two prices rather than one.
  const RE_RANGE_PREFIX = new RegExp(NO_DIGIT_BEFORE + '(' + TOKEN + ')' + GAP + '(' + NUM + ')' + DASH + '(' + NUM + ')', 'gu');
  const RE_RANGE_SUFFIX = new RegExp('(' + NUM + ')' + DASH + '(' + NUM + ')' + GAP + '(' + TOKEN + ')' + NO_DIGIT_AFTER, 'gu');
  const RE_PREFIX = new RegExp(NO_DIGIT_BEFORE + '(' + TOKEN + ')' + GAP + '(' + NUM + ')', 'gu');
  const RE_SUFFIX = new RegExp('(' + NUM + ')' + GAP + '(' + TOKEN + ')' + NO_DIGIT_AFTER, 'gu');
  // The quirk must end where the number ends: without the lookahead, '09:555'
  // matches '09:55' and silently leaves the trailing digit behind.
  const RE_QUIRK = new RegExp('(' + NUM + ')(' + QUIRK + ')(?!\\d)', 'gu');

  // ---------------------------------------------------------------------------
  // Amount normalisation
  // ---------------------------------------------------------------------------

  const SPACE_SEP_RE = new RegExp('^' + SPACE_CLASS + '$');

  /**
   * Turns a matched numeric blob into a number, deciding per match which
   * separator is the decimal one: when both ',' and '.' appear the last wins;
   * a lone separator followed by exactly three digits is a group separator;
   * whitespace and apostrophes always group. Returns NaN when the grouping is
   * inconsistent.
   */
  function parseAmount(raw, currency) {
    const text = String(raw).trim();
    if (INDIAN_RE.test(text)) return parseFloat(text.replace(/,/g, ''));

    const separatorPositions = [];
    for (let i = 0; i < text.length; i += 1) {
      if (!/[0-9]/.test(text[i])) separatorPositions.push(i);
    }
    if (!separatorPositions.length) return parseInt(text, 10);

    const lastPosition = separatorPositions[separatorPositions.length - 1];
    const lastChar = text[lastPosition];
    const tailLength = text.length - lastPosition - 1;
    const groupsOnly = SPACE_SEP_RE.test(lastChar);

    // A zero-decimal currency never writes minor units, so a trailing group of
    // three stays a thousands group -- 1.234 yen is 1234, not 1.234.
    const isDecimal = !groupsOnly && tailLength < 3;
    const decimalAt = isDecimal ? lastPosition : -1;

    const groupChars = separatorPositions
      .filter(function (position) {
        return position !== decimalAt;
      })
      .map(function (position) {
        return text[position];
      })
      .filter(function (char) {
        return !SPACE_SEP_RE.test(char);
      });
    // '1,234.567' and friends: two different group separators is not a number.
    const distinctGroupChars = groupChars.filter(function (char, index, all) {
      return all.indexOf(char) === index;
    });
    if (distinctGroupChars.length > 1) return NaN;

    const integerText = (decimalAt === -1 ? text : text.slice(0, decimalAt)).replace(/[^0-9]/g, '');
    const fractionText = decimalAt === -1 ? '' : text.slice(decimalAt + 1);
    const value = parseFloat(integerText + (fractionText ? '.' + fractionText : ''));

    if (currency && currency.zeroDecimal) return Math.round(value);
    return value;
  }

  /** Applies a quirk suffix: ':-' and ',-' add nothing, ':99' adds the minor units. */
  function applyQuirk(value, suffix) {
    const minorUnits = suffix.match(/^:(\d{2})$/);
    if (minorUnits) return value + parseInt(minorUnits[1], 10) / 100;
    return value;
  }

  // ---------------------------------------------------------------------------
  // Reject rules
  // ---------------------------------------------------------------------------

  const DATE_RE =
    /\d{1,4}\s*[-/.]\s*\d{1,2}\s*[-/.]\s*\d{2,4}/g;

  /** True when the span overlaps something that reads as a date. */
  function insideDate(text, start, end) {
    DATE_RE.lastIndex = 0;
    let match = DATE_RE.exec(text);
    while (match) {
      if (match.index < end && match.index + match[0].length > start) return true;
      match = DATE_RE.exec(text);
    }
    return false;
  }

  /** True when a '%' follows the span, so "20 %" never becomes a price. */
  function followedByPercent(text, end) {
    const rest = text.slice(end, end + 3);
    return /^\s*%/.test(rest);
  }

  /**
   * Clock times. ':dd' is the Swedish 499:99 form -- 499 kronor and 99 ore -- and
   * 'H:MM' is exactly the same shape, so without this rule every opening hour and
   * delivery slot on a page reads as a price. It fired even with no Swedish
   * context at all, because SEK is the only currency that writes ':dd'.
   *
   * The test is the clock itself: an hour of 0 to 23 against minutes of 0 to 59.
   * That keeps 499:99 and 2 499:99, whose 99 is no minute and whose hundreds are
   * no hour, and it rejects 12:15 -- which is both a valid time and a valid 12
   * kronor 15 ore.
   *
   * Rejecting 12:15 is deliberate. A badge on a delivery slot is wrong on every
   * page that shows one and makes the extension look broken; a missed 12:15 costs
   * one badge on the Swedish shops still writing ore, and the ':-' form that
   * modern Swedish retail actually uses is untouched either way. The same choice
   * loses 20:50 as a price, for the same reason.
   */
  function looksLikeTime(rawNumber, quirk) {
    if (!quirk) return false;
    const minorUnits = String(quirk).match(/^:(\d{2})$/);
    if (!minorUnits) return false;
    if (parseInt(minorUnits[1], 10) > 59) return false;
    // An hour is one or two plain digits: '2 499' is not an hour, grouped or not.
    const hour = String(rawNumber).trim();
    if (!/^\d{1,2}$/.test(hour)) return false;
    return parseInt(hour, 10) <= 23;
  }

  /**
   * Phone numbers: a leading '+', or three or more groups of two to three digits
   * joined by dashes. Two groups are left alone, because "100-200 kr" is a range.
   */
  function looksLikePhone(text, start, end) {
    const before = text.slice(Math.max(0, start - 2), start);
    if (/\+\s?$/.test(before)) return true;
    let runStart = start;
    while (runStart > 0 && /[\d\s\-()]/.test(text[runStart - 1])) runStart -= 1;
    let runEnd = end;
    while (runEnd < text.length && /[\d\s\-()]/.test(text[runEnd])) runEnd += 1;
    const run = text.slice(runStart, runEnd);
    const dashGroups = run.split(/-/);
    if (dashGroups.length < 3) return false;
    return dashGroups.every(function (group) {
      return /^\s*\d{2,3}\s*$/.test(group);
    });
  }

  // ---------------------------------------------------------------------------
  // Currency resolution
  // ---------------------------------------------------------------------------

  /**
   * Picks the currency for a token, in the order the spec fixes:
   *   1. the per-site forced currency
   *   2. an explicit qualifier -- either the token itself being unambiguous
   *      ('US$', 'SEK') or an ISO code written next to the amount
   *   3. the page's own declaration: product:price:currency, then og:locale / <html lang>
   *   4. the top-level domain
   *   5. the user's home currency when it shares the token, otherwise the token's
   *      most common owner
   * Returns { currency: null } rather than guessing when nothing decides.
   */
  function resolveCurrency(token, context, nearbyText) {
    const owners = ownersFor(token);
    const ctx = context || {};

    if (!owners.length) return { currency: null, ambiguous: true, via: 'unknown' };

    // Step 2, first half: a token only one currency writes needs no resolution.
    if (owners.length === 1) {
      return { currency: owners[0], ambiguous: false, via: 'token' };
    }

    // Step 1. A forced currency is the user telling us what this site's prices
    // are, so for a shared token it wins outright -- even over the token's own
    // owner list, which is exactly the case it exists to fix.
    if (ctx.forcedCurrency && CUR.BY_CODE[ctx.forcedCurrency]) {
      return { currency: ctx.forcedCurrency, ambiguous: false, via: 'forced' };
    }

    // Step 2, second half: an ISO code written beside the amount.
    if (nearbyText) {
      const codes = nearbyText.match(/\b[A-Z]{3}\b/g) || [];
      for (let i = 0; i < codes.length; i += 1) {
        if (owners.indexOf(codes[i]) !== -1) {
          return { currency: codes[i], ambiguous: false, via: 'qualifier' };
        }
      }
    }

    // Step 3.
    if (ctx.pageCurrency && owners.indexOf(ctx.pageCurrency) !== -1) {
      return { currency: ctx.pageCurrency, ambiguous: false, via: 'page-currency' };
    }
    const localeCurrency = CUR.currencyForLocale(ctx.pageLocale);
    if (localeCurrency && owners.indexOf(localeCurrency) !== -1) {
      return { currency: localeCurrency, ambiguous: false, via: 'locale' };
    }

    // Step 4.
    const tldCurrency = CUR.currencyForTld(ctx.tld);
    if (tldCurrency && owners.indexOf(tldCurrency) !== -1) {
      return { currency: tldCurrency, ambiguous: false, via: 'tld' };
    }

    // Step 5.
    if (ctx.homeCurrency && owners.indexOf(ctx.homeCurrency) !== -1) {
      return { currency: ctx.homeCurrency, ambiguous: false, via: 'home' };
    }
    const fallback =
      CUR.SYMBOL_DEFAULT_OWNER[token] ||
      CUR.SYMBOL_DEFAULT_OWNER[String(token).toLowerCase()] ||
      CUR.SYMBOL_DEFAULT_OWNER[String(token).toUpperCase()];
    if (fallback) {
      return { currency: fallback, ambiguous: true, via: 'default-owner' };
    }

    return { currency: null, ambiguous: true, via: 'unresolved' };
  }

  /**
   * A single Latin letter is a weak token: 'R' is the rand, but it is also every
   * model name from the Audi R8 up. Being unambiguous is not enough for these --
   * the page, the site setting or the user's own currency has to back them up, or
   * the match is dropped rather than badged.
   */
  function isWeakToken(token) {
    return /^[A-Za-z]$/.test(token);
  }

  /** True when something other than the token itself points at this currency. */
  function contextSupports(code, context) {
    if (!code) return false;
    const ctx = context || {};
    return (
      ctx.forcedCurrency === code ||
      ctx.pageCurrency === code ||
      ctx.homeCurrency === code ||
      CUR.currencyForLocale(ctx.pageLocale) === code ||
      CUR.currencyForTld(ctx.tld) === code
    );
  }

  // ---------------------------------------------------------------------------
  // Scanning
  // ---------------------------------------------------------------------------

  function collect(regex, text, build) {
    const found = [];
    regex.lastIndex = 0;
    let match = regex.exec(text);
    while (match) {
      const made = build(match);
      if (made) {
        made.forEach(function (candidate) {
          found.push(candidate);
        });
      }
      if (regex.lastIndex === match.index) regex.lastIndex += 1;
      match = regex.exec(text);
    }
    return found;
  }

  function nearby(text, start, end) {
    return text.slice(Math.max(0, start - 14), Math.min(text.length, end + 14));
  }

  function makeCandidate(text, match, token, rawNumber, quirk, context) {
    const start = match.index;
    const end = start + match[0].length;

    if (followedByPercent(text, end)) return null;
    if (insideDate(text, start, end)) return null;
    if (looksLikePhone(text, start, end)) return null;
    if (looksLikeTime(rawNumber, quirk)) return null;

    const resolved = token
      ? resolveCurrency(token, context, nearby(text, start, end))
      : resolveQuirk(quirk, context);
    if (
      token &&
      isWeakToken(token) &&
      resolved.via !== 'qualifier' &&
      !contextSupports(resolved.currency, context)
    ) {
      return null;
    }

    // A quirk carries no symbol, so an unattributed one is not a price: there is
    // nothing to say it is money rather than some other colon-separated pair.
    if (quirk && !resolved.currency) return null;

    const currency = resolved.currency ? CUR.BY_CODE[resolved.currency] : null;
    let amount = parseAmount(rawNumber, currency);
    if (!isFinite(amount) || isNaN(amount) || amount <= 0) return null;
    if (quirk) amount = applyQuirk(amount, quirk);

    return {
      amount: amount,
      currency: resolved.currency,
      raw: match[0],
      index: start,
      length: match[0].length,
      ambiguous: resolved.ambiguous,
      via: resolved.via,
    };
  }

  /** A bare '400:-' carries no symbol, so the ladder runs over the quirk's owners. */
  function resolveQuirk(quirk, context) {
    const owners = quirkOwners(quirk);
    const ctx = context || {};
    if (!owners.length) return { currency: null, ambiguous: true, via: 'unknown' };
    if (ctx.forcedCurrency && CUR.BY_CODE[ctx.forcedCurrency]) {
      return { currency: ctx.forcedCurrency, ambiguous: false, via: 'forced' };
    }
    if (ctx.pageCurrency && owners.indexOf(ctx.pageCurrency) !== -1) {
      return { currency: ctx.pageCurrency, ambiguous: false, via: 'page-currency' };
    }
    const localeCurrency = CUR.currencyForLocale(ctx.pageLocale);
    if (localeCurrency && owners.indexOf(localeCurrency) !== -1) {
      return { currency: localeCurrency, ambiguous: false, via: 'locale' };
    }
    const tldCurrency = CUR.currencyForTld(ctx.tld);
    if (tldCurrency && owners.indexOf(tldCurrency) !== -1) {
      return { currency: tldCurrency, ambiguous: false, via: 'tld' };
    }
    if (ctx.homeCurrency && owners.indexOf(ctx.homeCurrency) !== -1) {
      return { currency: ctx.homeCurrency, ambiguous: false, via: 'home' };
    }
    // ':dd' is written by SEK alone, and the single-owner shortcut below would
    // therefore call it SEK on any page in the world, 'ambiguous: false', with
    // nothing Swedish about the page to go on. Its shape collides with how
    // everyone writes the time, so it is the one quirk that has to be
    // corroborated by one of the rungs above rather than assumed.
    if (/^:\d{2}$/.test(String(quirk))) {
      return { currency: null, ambiguous: true, via: 'uncorroborated' };
    }
    if (owners.length === 1) return { currency: owners[0], ambiguous: false, via: 'token' };
    return { currency: owners[0], ambiguous: true, via: 'default-owner' };
  }

  /** Where a captured group sits inside the whole match. */
  function offsetOf(whole, part, from) {
    const at = whole.indexOf(part, from || 0);
    return at === -1 ? 0 : at;
  }

  /**
   * Ranges are resolved first and reserve their whole span, then the ordinary
   * passes fill in around them. Both ends of a range are emitted with their own
   * spans, so the overlap check cannot swallow the second one.
   */
  function rangeCandidates(text, context) {
    const found = [];

    collect(RE_RANGE_PREFIX, text, function (match) {
      const lowOffset = 0;
      const highOffset = offsetOf(match[0], match[3], match[0].length - match[3].length);
      const low = makeCandidate(text, match, match[1], match[2], null, context);
      if (!low) return null;
      const highAmount = parseAmount(match[3], CUR.BY_CODE[low.currency]);
      low.index = match.index + lowOffset;
      low.length = highOffset - lowOffset;
      low.raw = match[0].slice(lowOffset, highOffset);
      if (!isFinite(highAmount) || highAmount <= 0) return [low];
      const high = Object.assign({}, low, {
        amount: highAmount,
        index: match.index + highOffset,
        length: match[0].length - highOffset,
        raw: match[0].slice(highOffset),
      });
      return [low, high];
    }).forEach(function (candidate) {
      found.push(candidate);
    });

    collect(RE_RANGE_SUFFIX, text, function (match) {
      const highOffset = offsetOf(match[0], match[2], match[1].length);
      const high = makeCandidate(text, match, match[3], match[2], null, context);
      if (!high) return null;
      const lowAmount = parseAmount(match[1], CUR.BY_CODE[high.currency]);
      high.index = match.index + highOffset;
      high.length = match[0].length - highOffset;
      high.raw = match[0].slice(highOffset);
      if (!isFinite(lowAmount) || lowAmount <= 0) return [high];
      const low = Object.assign({}, high, {
        amount: lowAmount,
        index: match.index,
        length: highOffset,
        raw: match[0].slice(0, highOffset),
      });
      return [low, high];
    }).forEach(function (candidate) {
      found.push(candidate);
    });

    return found;
  }

  function parsePrices(text, context) {
    if (!text || typeof text !== 'string') return [];

    const ranges = rangeCandidates(text, context);
    // The spans a range owns, so the ordinary passes do not re-read its numbers.
    const reserved = ranges.map(function (candidate) {
      return [candidate.index, candidate.index + candidate.length];
    });

    function isReserved(index, length) {
      return reserved.some(function (span) {
        return index < span[1] && index + length > span[0];
      });
    }

    const singles = [];
    collect(RE_PREFIX, text, function (match) {
      const candidate = makeCandidate(text, match, match[1], match[2], null, context);
      return candidate ? [candidate] : null;
    }).forEach(function (candidate) {
      singles.push(candidate);
    });
    collect(RE_SUFFIX, text, function (match) {
      const candidate = makeCandidate(text, match, match[2], match[1], null, context);
      return candidate ? [candidate] : null;
    }).forEach(function (candidate) {
      singles.push(candidate);
    });
    collect(RE_QUIRK, text, function (match) {
      const candidate = makeCandidate(text, match, null, match[1], match[2], context);
      return candidate ? [candidate] : null;
    }).forEach(function (candidate) {
      singles.push(candidate);
    });

    // Earliest first, and where two readings start together the longer one wins,
    // so 'US$100' beats the '$100' sitting inside it.
    singles.sort(function (a, b) {
      return a.index - b.index || b.length - a.length;
    });

    const accepted = ranges.slice();
    let consumedUntil = -1;
    singles.forEach(function (candidate) {
      if (candidate.index < consumedUntil) return;
      if (isReserved(candidate.index, candidate.length)) return;
      accepted.push(candidate);
      consumedUntil = candidate.index + candidate.length;
    });

    accepted.sort(function (a, b) {
      return a.index - b.index || b.length - a.length;
    });
    return accepted;
  }

  function parseOne(text, context) {
    const all = parsePrices(text, context);
    return all.length ? all[0] : null;
  }

  root.WorthItParser = {
    parsePrices: parsePrices,
    parseOne: parseOne,
    resolveCurrency: resolveCurrency,
    parseAmount: parseAmount,
    ownersFor: ownersFor,
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = globalThis.WorthItParser;
}
