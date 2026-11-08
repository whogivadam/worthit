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

  // Below one unit of the home currency is not a price anyone is deciding about.
  // There is deliberately no ceiling: every reader has a different budget, and
  // a fixed one hid every home on booli.se -- while meaning a flat in kronor, a
  // car in yen and a phone in dong.
  const MIN_HOME_AMOUNT = 1;

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

  // A shadow root sees none of the document's stylesheets, so a badge inside
  // one would be styled by whatever the component itself says about a <span> --
  // on komplett.se, the 46px of the price it sits beside. The sheet is put into
  // each root that gets a badge, and this is a copy of content/badge.css
  // because there is no way to read that file back out: the content script
  // fetches nothing, by design, and making it web-accessible would let any page
  // test for the extension. tests/overlay.test.js fails if the two drift apart.
  const BADGE_CSS = `/* The badge has to survive any page's CSS and must not disturb the layout it
   lands in. \`all: initial\` drops everything inherited or matched from the page,
   and every declaration after it is !important because a page rule can always
   outrank a plain one on specificity.

   Nothing here affects flow: inline-block with line-height 1 and no margin, so
   the badge sits in the text like a word. */

span[data-worthit-badge] {
  all: initial !important;
  display: inline-block !important;
  box-sizing: content-box !important;
  margin: 0 0 0 4px !important;
  padding: 2px !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: #ff2d2d !important;
  background-image: none !important;
  color: #fff !important;
  font-family: "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace !important;
  font-size: 11px !important;
  font-style: normal !important;
  font-weight: 700 !important;
  line-height: 1 !important;
  letter-spacing: 0 !important;
  text-align: left !important;
  text-decoration: none !important;
  text-indent: 0 !important;
  text-transform: none !important;
  white-space: nowrap !important;
  vertical-align: baseline !important;
  direction: ltr !important;
  float: none !important;
  position: static !important;
  width: auto !important;
  height: auto !important;
  min-width: 0 !important;
  min-height: 0 !important;
  max-width: none !important;
  max-height: none !important;
  box-shadow: none !important;
  text-shadow: none !important;
  opacity: 1 !important;
  visibility: visible !important;
  transform: none !important;
  transition: none !important;
  animation: none !important;
  cursor: help !important;
  user-select: none !important;
  pointer-events: auto !important;
}`;

  const styledRoots = new WeakSet();

  /**
   * Puts the badge sheet into the shadow root this node lives in, once.
   * Constructed sheets are preferred: they are CSSOM rather than markup, so a
   * page's style-src CSP has nothing to say about them.
   */
  function ensureBadgeStyle(node) {
    const root = node.getRootNode ? node.getRootNode() : null;
    // The document already has content/badge.css from the manifest.
    if (!root || !root.host || styledRoots.has(root)) return;
    styledRoots.add(root);

    try {
      if (typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in root) {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(BADGE_CSS);
        root.adoptedStyleSheets = root.adoptedStyleSheets.concat([sheet]);
        return;
      }
    } catch {
      // Fall through to the element below.
    }

    const style = document.createElement('style');
    style.textContent = BADGE_CSS;
    root.insertBefore(style, root.firstChild);
  }

  /**
   * Every open shadow root inside a node, depth first. Shops increasingly build
   * product cards as custom elements, and neither a TreeWalker nor a
   * MutationObserver crosses a shadow boundary: komplett.se nests four of them
   * -- komplett-search-results > komplett-product-card-container >
   * komplett-product-card > komplett-product-card-price -- which left the whole
   * page reading as though it had no prices on it at all.
   *
   * A closed root keeps its tree to itself and there is nothing to be done
   * about that from out here.
   */
  function shadowRootsIn(start) {
    const roots = [];
    if (start.shadowRoot) roots.push(start.shadowRoot);

    const walker = document.createTreeWalker(start, NodeFilter.SHOW_ELEMENT);
    let element = walker.nextNode();
    while (element) {
      if (element.shadowRoot) roots.push(element.shadowRoot);
      element = walker.nextNode();
    }

    return roots.reduce(function (all, root) {
      return all.concat([root], shadowRootsIn(root));
    }, []);
  }

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
      rate: I18n.formatNumber(rate.toPrecision(6)),
      to: homeCode,
      date: when,
      source: label,
    });
  }

  /**
   * `spoken` is what assistive technology gets in place of the badge's own text.
   *
   * The badge sits in the shop's reading order, so a screen reader announces it
   * either way: the only question is whether it announces something useful.
   * '5.2d' is a glance-value with no unit a listener can resolve, and nothing in
   * it says the extension rather than the shop is speaking -- so the badge
   * carries the tooltip's own sentence instead, prefixed with the extension's
   * name. Hiding the badge with aria-hidden would have been the quieter choice,
   * and it would have decided on a blind reader's behalf that the one thing this
   * extension exists to say is not for them.
   *
   * role="img" is what makes the name land. An accessible name on a generic
   * span is not required to be exposed at all -- 'generic' does not support
   * naming from the author -- and the role also makes the badge's own text
   * presentational, so the sentence is heard instead of the sentence and then
   * '5.2d'. The title stays for the sighted reader.
   */
  function makeBadge(label, tooltip, spoken) {
    const badge = document.createElement('span');
    badge.setAttribute(BADGE_ATTR, '');
    badge.setAttribute('title', tooltip);
    badge.setAttribute('role', 'img');
    badge.setAttribute('aria-label', `Worth It? ${spoken}`);
    badge.textContent = label;
    return badge;
  }

  /**
   * A price we cannot convert gets an honest '?' rather than a guess, which is
   * what the spec asks for when a currency is unknown.
   */
  function unknownBadge(price) {
    const what = price.currency || I18n.t('badge.thisCurrency');
    const why = I18n.t('badge.noRate', { what: what });
    return makeBadge('?', ['Worth It?', price.raw, why].join('\n'), why);
  }

  function priceBadge(price) {
    const home = state.settings.homeCurrency;
    const amountHome =
      price.currency === home
        ? price.amount
        : Rates.crossConvert(price.amount, price.currency, home, state.cache && state.cache.rates);

    if (amountHome === null) return unknownBadge(price);
    if (amountHome < MIN_HOME_AMOUNT) return null;

    const rate = Calc.hourlyRate(state.settings);
    const totalHours = Calc.totalHoursFor(amountHome, rate);
    if (totalHours === null) return null;

    const converted =
      price.currency === home
        ? null
        : `${I18n.formatNumber(amountHome.toFixed(2))} ${home}`;

    const workTime = I18n.t('badge.workTime', { time: I18n.formatHoursMinutes(totalHours) });
    const tooltip = [
      'Worth It?',
      price.raw.trim(),
      converted ? `= ${converted}` : null,
      `= ${workTime}`,
      // Only worth saying when a conversion actually happened.
      converted ? describeRate(price.currency, home) : null,
    ]
      .filter(Boolean)
      .join('\n');

    // The spoken form is the precise duration, not the badge's rounded '5.2d':
    // the page has just read the price out, and the hours are the answer to it.
    return makeBadge(
      I18n.formatBadge(totalHours, state.settings.hoursPerWeek),
      tooltip,
      workTime,
    );
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
      ensureBadgeStyle(node);

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
   * A container's text as the page wrote it, plus where `node` sits in it.
   *
   * textContent would include the badges already placed inside the container,
   * and a badge's own text reads as part of a price: on booli.se the fee
   * '10 236 kr' gets '5.2d', the container then reads '10 236 kr5.2d', and
   * 'kr5.2' was badged as 5.20 kronor beside the year the house was built.
   */
  function pageTextOf(container, node) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let text = '';
    let offset = -1;
    let current = walker.nextNode();
    while (current) {
      const parent = current.parentElement;
      if (!parent || !parent.closest('[' + BADGE_ATTR + ']')) {
        if (current === node) offset = text.length;
        text += current.nodeValue;
      }
      current = walker.nextNode();
    }
    return { text: text, offset: offset };
  }

  /**
   * Shops often break a price across elements, as in
   * <span>1 299</span><span>kr</span>. When a node holds nothing but a number
   * and its parent reads as exactly one price built from that number, the badge
   * goes on the parent.
   */
  function trySplitPrice(node) {
    if (!BARE_NUMBER.test(node.nodeValue || '')) return false;

    // The currency sits in a sibling of the number's own wrapper, so the
    // element that reads as a whole price is one or two levels up.
    let container = node.parentElement;
    for (let depth = 0; container && depth < 3; depth += 1) {
      if (container === document.body || container.hasAttribute(DONE_ATTR)) return false;

      const page = pageTextOf(container, node);
      const combined = page.text;
      if (combined && combined.length <= 200) {
        const prices = Parser.parsePrices(combined, state.context);
        // The one price has to be this number's: a bare '1929' in a fact list
        // that also holds a fee is a year, and the fee has its own badge.
        if (prices.length === 1 && !spansNode(prices[0], page.offset, node)) return false;
        if (prices.length === 1) {
          if (isScreenReaderOnly(container)) {
            processedText.add(node);
            return false;
          }
          const badge = priceBadge(prices[0]);
          if (!badge) return false;
          ensureBadgeStyle(container);
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

  /** True when the price's span covers the digits of `node`. */
  function spansNode(price, offset, node) {
    if (offset < 0) return false;
    const value = node.nodeValue;
    const first = offset + value.search(/\d/);
    const last = offset + value.length - 1 - value.split('').reverse().join('').search(/\d/);
    return price.index <= first && last < price.index + price.length;
  }

  function scan(root) {
    if (!state.enabled || !state.settings) return;
    const isRoot =
      root &&
      (root.nodeType === Node.ELEMENT_NODE || root.nodeType === Node.DOCUMENT_FRAGMENT_NODE);
    const start = isRoot ? root : document.body;
    if (!start) return;

    if (start.closest && start.closest(SKIP_SELECTOR)) return;

    scanRoot(start);
    // Each open shadow root is its own tree and has to be walked, and watched,
    // in its own right.
    shadowRootsIn(start).forEach(function (shadowRoot) {
      observeRoot(shadowRoot);
      scanRoot(shadowRoot);
    });
  }

  function scanRoot(start) {
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
    // Badges in a shadow root are invisible to document.querySelectorAll, so
    // every root is asked separately or a re-price leaves the old ones behind.
    const roots = [document].concat(
      document.documentElement ? shadowRootsIn(document.documentElement) : []
    );
    roots.forEach((root) => {
      root.querySelectorAll('[' + BADGE_ATTR + ']').forEach((badge) => {
        if (badge.parentNode) touched.add(badge.parentNode);
        badge.remove();
      });
      root.querySelectorAll('[' + DONE_ATTR + ']').forEach((element) => {
        element.removeAttribute(DONE_ATTR);
      });
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

  let observer = null;
  const observedRoots = new WeakSet();

  /** The one observer watches every root it is given, document or shadow. */
  function observeRoot(root) {
    if (!observer || !root || observedRoots.has(root)) return;
    observedRoots.add(root);
    observer.observe(root, { childList: true, subtree: true });
  }

  function observe() {
    observer = new MutationObserver((records) => {
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

    observeRoot(document.documentElement);
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
