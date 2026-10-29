// The page overlay: a small red badge after every price, saying what it costs
// in hours of the reader's own work.
//
// This script never fetches. It reads settings and the rate table out of
// storage.local, which the background event page keeps up to date.
(function () {
  'use strict';

  const Currencies = globalThis.WorthItCurrencies;
  const Parser = globalThis.WorthItParser;
  const Calc = globalThis.WorthItCalc;
  const I18n = globalThis.WorthItI18n;
  const Rates = globalThis.WorthItRates;

  const SETTINGS_KEY = 'settings';
  const SITES_KEY = 'sites';

  const BADGE_ATTR = 'data-worthit-badge';
  const DONE_ATTR = 'data-worthit';

  // One scan per 300 ms at most, however busy the page is.
  const SCAN_INTERVAL_MS = 300;

  // Anything outside this, after conversion to the home currency, is not a
  // price anyone is deciding about.
  const MIN_HOME_AMOUNT = 1;
  const MAX_HOME_AMOUNT = 10000000;

  // Editable fields, code listings, and anything already handled.
  const SKIP_SELECTOR = [
    'input',
    'textarea',
    'select',
    'option',
    'script',
    'style',
    'noscript',
    'svg',
    'code',
    'pre',
    'kbd',
    'samp',
    '[contenteditable]',
    '[' + BADGE_ATTR + ']',
    '[' + DONE_ATTR + ']',
  ].join(',');

  // Proper names stay; the bundled snapshot is a description and gets translated.
  const SOURCE_NAMES = {
    'er-api': 'ExchangeRate-API',
    frankfurter: 'Frankfurter (ECB)',
  };

  function sourceLabel(source) {
    if (source === 'snapshot') return I18n.t('rates.sourceSnapshot');
    return SOURCE_NAMES[source] || source;
  }

  // Built from the currency table's own space list rather than written out, so
  // no non-breaking space ends up pasted into this file as a literal.
  const SPACE_CLASS = Currencies.SPACES.map(function (space) {
    return '\\u' + space.charCodeAt(0).toString(16).padStart(4, '0');
  }).join('');
  const BARE_NUMBER = new RegExp(
    '^[' + SPACE_CLASS + "]*\\d[\\d.,'\\u2019" + SPACE_CLASS + ']*$',
  );

  // Text nodes cannot carry an attribute, so the "already processed" mark for
  // them lives here; split-price parents are marked with data-worthit instead.
  let processedText = new WeakSet();

  const state = {
    settings: null,
    site: null,
    cache: null,
    context: null,
    enabled: false,
  };

  let scanTimer = null;
  let lastScanAt = 0;
  let pendingRoots = [];

  // --- page context ----------------------------------------------------------

  function metaContent(selector) {
    const element = document.querySelector(selector);
    return element ? element.getAttribute('content') : null;
  }

  function buildContext() {
    const documentLocale =
      (document.documentElement && document.documentElement.getAttribute('lang')) ||
      metaContent('meta[property="og:locale"]');

    return {
      forcedCurrency: state.site && state.site.forceCurrency ? state.site.forceCurrency : null,
      pageCurrency:
        metaContent('meta[property="product:price:currency"]') ||
        metaContent('meta[itemprop="priceCurrency"]') ||
        null,
      pageLocale: documentLocale,
      tld: location.hostname,
      homeCurrency: state.settings ? state.settings.homeCurrency : null,
    };
  }

  // --- badges ----------------------------------------------------------------

  function describeRate(sourceCode, homeCode) {
    if (!state.cache) return I18n.t('rates.noneYetShort');
    const rate = Rates.effectiveRate(sourceCode, homeCode, state.cache.rates);
    const label = sourceLabel(state.cache.source);
    const when = state.cache.rateDate || I18n.t('rates.unknownDateLong');
    if (rate === null) return I18n.t('rates.unavailable', { source: label, date: when });
    return I18n.t('rates.rateLine', {
      from: sourceCode,
      rate: rate.toPrecision(6),
      to: homeCode,
      date: when,
      source: label,
    });
  }

  function makeBadge(label, tooltip) {
    const badge = document.createElement('span');
    badge.setAttribute(BADGE_ATTR, '');
    badge.setAttribute('title', tooltip);
    badge.textContent = label;
    return badge;
  }

  /**
   * A price we cannot convert gets an honest '?' rather than a guess, which is
   * what the spec asks for when a currency is unknown.
   */
  function unknownBadge(price) {
    const what = price.currency || I18n.t('badge.thisCurrency');
    return makeBadge(
      '?',
      ['Worth It?', price.raw, I18n.t('badge.noRate', { what: what })].join('\n'),
    );
  }

  function priceBadge(price) {
    const home = state.settings.homeCurrency;
    const amountHome =
      price.currency === home
        ? price.amount
        : Rates.crossConvert(price.amount, price.currency, home, state.cache && state.cache.rates);

    if (amountHome === null) return unknownBadge(price);
    if (amountHome < MIN_HOME_AMOUNT || amountHome > MAX_HOME_AMOUNT) return null;

    const rate = Calc.hourlyRate(state.settings);
    const totalHours = Calc.totalHoursFor(amountHome, rate);
    if (totalHours === null) return null;

    const converted =
      price.currency === home
        ? null
        : `${amountHome.toFixed(2)} ${home}`;

    const tooltip = [
      'Worth It?',
      price.raw.trim(),
      converted ? `= ${converted}` : null,
      I18n.t('badge.ofYourWork', { time: I18n.formatHoursMinutes(totalHours) }),
      // Only worth saying when a conversion actually happened.
      converted ? describeRate(price.currency, home) : null,
    ]
      .filter(Boolean)
      .join('\n');

    return makeBadge(I18n.formatBadge(totalHours, state.settings.hoursPerWeek), tooltip);
  }

  // --- scanning --------------------------------------------------------------

  function isSkipped(node) {
    const parent = node.parentElement;
    if (!parent) return true;
    return Boolean(parent.closest(SKIP_SELECTOR));
  }

  /**
   * Text carried for assistive technology and hidden from the screen. Elgiganten
   * ships both forms -- "2 190.-" visibly and "Pris 2 190 kr" for readers -- so
   * without this the only badge on the page lands where nobody can see it, and
   * once the visible form parses too there are two badges for one price.
   *
   * Computed styles only: 'sr-only' and 'visually-hidden' are conventions, not
   * guarantees, and the class name says nothing about what the page actually did.
   *
   * display:none and visibility:hidden are deliberately not treated as hidden. A
   * collapsed tab, accordion or menu can become visible again with no DOM
   * mutation, so the observer would never come back and those prices would be
   * lost for good. That is also why the 1px-box test needs a layout box to go
   * with it: an unrendered element measures zero in both directions as well, and
   * must not be mistaken for a clipped one.
   */
  function isScreenReaderOnly(element) {
    let current = element;
    for (let depth = 0; current && depth <= 4; depth += 1) {
      if (current === document.body) return false;

      const style = window.getComputedStyle(current);
      if (style) {
        if (style.clip && style.clip !== 'auto') return true;
        if (style.clipPath && style.clipPath.indexOf('inset(50%') === 0) return true;
        if (
          style.overflow === 'hidden' &&
          current.offsetWidth <= 1 &&
          current.offsetHeight <= 1 &&
          current.getClientRects().length > 0
        ) {
          return true;
        }
      }

      current = current.parentElement;
    }

    return false;
  }

  /**
   * Badges every price in one text node, working backwards so that splitting
   * the node does not move the offsets of the prices still to be handled.
   */
  function decorateTextNode(node) {
    if (processedText.has(node)) return false;

    const text = node.nodeValue;
    if (!text || text.length > 2000) return false;
    if (!/\d/.test(text)) return false;

    const prices = Parser.parsePrices(text, state.context);
    if (!prices.length) return trySplitPrice(node);

    // Marked as handled either way: a rescan would reach the same verdict, and
    // leaving it unmarked makes every later pass walk it again.
    if (isScreenReaderOnly(node.parentElement)) {
      processedText.add(node);
      return false;
    }

    processedText.add(node);
    let inserted = false;

    for (let i = prices.length - 1; i >= 0; i -= 1) {
      const price = prices[i];
      const badge = priceBadge(price);
      if (!badge) continue;

      const end = price.index + price.length;
      const parent = node.parentNode;
      if (!parent) break;

      if (end < node.nodeValue.length) {
        const tail = node.splitText(end);
        // The tail is a brand-new node, and everything in it has already been
        // handled by an earlier turn of this loop. Without marking it, the
        // observer sees it arrive and badges those prices a second time.
        processedText.add(tail);
        parent.insertBefore(badge, tail);
      } else {
        parent.insertBefore(badge, node.nextSibling);
      }
      inserted = true;
    }

    return inserted;
  }

  /**
   * Shops often break a price across elements, as in
   * <span>1 299</span><span>kr</span>. When a node holds nothing but a number
   * and its parent reads as exactly one price, the badge goes on the parent.
   */
  function trySplitPrice(node) {
    if (!BARE_NUMBER.test(node.nodeValue || '')) return false;

    // The currency sits in a sibling of the number's own wrapper, so the
    // element that reads as a whole price is one or two levels up.
    let container = node.parentElement;
    for (let depth = 0; container && depth < 3; depth += 1) {
      if (container === document.body || container.hasAttribute(DONE_ATTR)) return false;

      const combined = container.textContent;
      if (combined && combined.length <= 200) {
        const prices = Parser.parsePrices(combined, state.context);
        if (prices.length === 1) {
          if (isScreenReaderOnly(container)) {
            processedText.add(node);
            return false;
          }
          const badge = priceBadge(prices[0]);
          if (!badge) return false;
          container.setAttribute(DONE_ATTR, '');
          container.appendChild(badge);
          processedText.add(node);
          return true;
        }
        if (prices.length > 1) return false;
      }
      container = container.parentElement;
    }
    return false;
  }

  function scan(root) {
    if (!state.enabled || !state.settings) return;
    const start = root && root.nodeType === Node.ELEMENT_NODE ? root : document.body;
    if (!start) return;

    if (start.closest && start.closest(SKIP_SELECTOR)) return;

    const walker = document.createTreeWalker(start, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (processedText.has(node)) return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue || !/\d/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        if (isSkipped(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    // Collected first: decorating splits text nodes, which would otherwise
    // disturb the walk in progress.
    const nodes = [];
    let current = walker.nextNode();
    while (current) {
      nodes.push(current);
      current = walker.nextNode();
    }

    nodes.forEach(decorateTextNode);
  }

  function removeAllBadges() {
    const touched = new Set();
    document.querySelectorAll('[' + BADGE_ATTR + ']').forEach((badge) => {
      if (badge.parentNode) touched.add(badge.parentNode);
      badge.remove();
    });
    document.querySelectorAll('[' + DONE_ATTR + ']').forEach((element) => {
      element.removeAttribute(DONE_ATTR);
    });
    // Decorating split text nodes; re-join them so a rescan sees whole prices.
    touched.forEach((parent) => parent.normalize());
    // And forget that any of it was processed, or the rescan has nothing to do.
    processedText = new WeakSet();
  }

  // --- dynamic pages ---------------------------------------------------------

  function runPendingScan() {
    scanTimer = null;
    lastScanAt = Date.now();
    const roots = pendingRoots;
    pendingRoots = [];
    if (!roots.length) {
      scan(document.body);
      return;
    }
    roots.forEach((root) => {
      if (root.isConnected) scan(root);
    });
  }

  /** At most one scan per 300 ms, and only over what was added. */
  function requestScan(roots) {
    if (roots && roots.length) {
      pendingRoots = pendingRoots.concat(roots);
    }
    if (scanTimer !== null) return;
    const wait = Math.max(0, SCAN_INTERVAL_MS - (Date.now() - lastScanAt));
    scanTimer = window.setTimeout(runPendingScan, wait);
  }

  function observe() {
    const observer = new MutationObserver((records) => {
      if (!state.enabled) return;
      const roots = [];
      records.forEach((record) => {
        record.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.hasAttribute(BADGE_ATTR)) return;
            roots.push(node);
          } else if (node.nodeType === Node.TEXT_NODE && node.parentElement) {
            roots.push(node.parentElement);
          }
        });
      });
      if (roots.length) requestScan(roots);
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  // --- state -----------------------------------------------------------------

  function siteFor(sites) {
    const all = sites || {};
    return all[location.hostname] || { disabled: false, forceCurrency: null };
  }

  function recomputeEnabled() {
    const settings = state.settings;
    const ready = Boolean(settings) && Calc.hourlyRate(settings) > 0 && Boolean(settings.homeCurrency);
    state.enabled = ready && settings.overlayEnabled !== false && !state.site.disabled;
  }

  async function load() {
    const stored = await browser.storage.local.get([SETTINGS_KEY, SITES_KEY, Rates.STORAGE_KEY]);
    state.settings = stored[SETTINGS_KEY] || null;
    state.site = siteFor(stored[SITES_KEY]);
    state.cache = stored[Rates.STORAGE_KEY] || null;
    state.context = buildContext();
    // Language lives inside settings, so the storage watcher below already
    // re-badges the page when it changes -- same path as a currency change.
    I18n.setLanguage(state.settings && state.settings.language);
    recomputeEnabled();
  }

  /** Settings changes apply immediately, with no page reload. */
  function watchStorage() {
    browser.storage.onChanged.addListener(async (changes, area) => {
      if (area !== 'local') return;
      if (!changes[SETTINGS_KEY] && !changes[SITES_KEY] && !changes[Rates.STORAGE_KEY]) return;

      const wasEnabled = state.enabled;
      await load();

      if (!state.enabled) {
        if (wasEnabled) removeAllBadges();
        return;
      }

      // Anything already badged was priced with the old settings or old rates.
      removeAllBadges();
      requestScan(null);
    });
  }

  async function start() {
    await load();
    watchStorage();
    observe();
    if (state.enabled) requestScan(null);
  }

  start();
})();
