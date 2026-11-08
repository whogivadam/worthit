#!/usr/bin/env node
// Measures the popup's height, per language, in a real browser.
//
// Both stores clamp an action popup to 800x600 CSS px and scroll anything past
// it, and there is no sizing API: the only lever is the content's own CSS. The
// popup is a fixed width with no height budget, so its height falls out of
// whatever the active language's strings happen to measure -- which is how
// Japanese Settings ended up 1px over the cap (#107). This script is that
// budget, checkable instead of eyeballed.
//
// It needs a real layout engine, so it drives headless Chrome rather than the
// jsdom the test suite uses -- jsdom has no layout at all and reports every
// height as 0. That is why it is a script and not a test: `npm test` must stay
// browser-free.
//
//   node scripts/measure-popup.mjs            # table, exits non-zero on a miss
//   node scripts/measure-popup.mjs --json     # the same numbers as JSON
//   node scripts/measure-popup.mjs --page out.html   # the harness page itself,
//          to open in a browser: ?view=settings&lang=de&width=425 renders one
//          view at one width, which is where the PR screenshots come from
//   CHROME_PATH=/path/to/chrome node scripts/measure-popup.mjs
//
// It builds one page out of the shipped parts -- popup.html's markup, popup.css
// verbatim, and the real string table from lib/i18n.js -- then fills each view
// the way popup.js fills it and reads the heights back. Nothing is hard-coded
// that the extension also declares: the width budget is parsed out of the CSS.
//
// Heights are platform-dependent (font availability, CJK fallback), so treat a
// number as a measurement of this machine, and the pass/fail as the contract.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// What the stores give us, and what we keep back from it.
const CAP = 600; // the popup viewport both stores clamp to
const HEADROOM = 16; // #107: clear the cap by a line, not by a pixel
const SCROLLBAR = 15; // a classic (space-taking) scrollbar, Windows/Linux

// Views that must fit inside the cap. The main view with a result showing does
// not and structurally cannot (result + history + site panel + footer); it is
// measured and reported, but it is not a budget.
const MUST_FIT = ['settings', 'settings-first-run', 'main-empty'];

const css = read('popup/popup.css');
const widthMatch = /--popup-width:\s*(\d+)px/.exec(css);
if (!widthMatch) {
  console.error('popup.css must declare --popup-width, so this script can read the shipped width');
  process.exit(2);
}
const shipped = Number(widthMatch[1]);

// Both widths are measured: with a scrollbar the content re-wraps ~15px
// narrower, which is how a view can overflow only *because* it overflowed.
const widths = [
  { label: `${shipped}px`, width: shipped },
  { label: `${shipped - SCROLLBAR}px (scrollbar)`, width: shipped - SCROLLBAR },
];

const markup = /<body[^>]*>([\s\S]*)<\/body>/
  .exec(read('popup/popup.html'))[1]
  .replace(/<script[\s\S]*?<\/script>/g, '');

const plan = {
  widths,
  views: ['settings', 'settings-first-run', 'main-empty', 'main-result'],
  // Measured against the longest source name, since that is the line's worst
  // case: 'Frankfurter (ECB)' is one character longer than 'ExchangeRate-API'.
  sources: ['Frankfurter (ECB)', 'ExchangeRate-API'],
  date: '2026-11-06',
  history: 3,
};

const driver = `
'use strict';
const I18n = globalThis.WorthItI18n;
const Calc = globalThis.WorthItCalc;
const PLAN = ${JSON.stringify(plan)};
const $ = (id) => document.getElementById(id);

// popup.js's applyTranslations(), including the lang attribute -- that is what
// makes a browser draw Han characters in the Japanese or Chinese form, and the
// two measure differently.
function applyTranslations() {
  document.documentElement.lang = I18n.language();
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = I18n.t(el.dataset.i18n);
  });
}

function fillLanguageSelect() {
  const select = $('language');
  select.replaceChildren();
  I18n.LANGUAGES.forEach((code) => {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = I18n.nameOf(code);
    select.append(option);
  });
  select.value = I18n.language();
}

function showSettings(firstRun) {
  $('view-main').hidden = true;
  $('view-settings').hidden = false;
  $('first-run').hidden = !firstRun;
  $('cancel-settings').hidden = Boolean(firstRun);
  $('settings-error').hidden = true;
  document.querySelector('input[name="income-mode"][value="monthly"]').checked = true;
  $('monthly').value = '42000';
  $('hourly').value = '';
  $('hours-per-week').value = '40';
  $('home-currency').value = '\\u{1F1F8}\\u{1F1EA} SEK kr';
  fillLanguageSelect();
}

function showMain(withResult) {
  const hoursPerWeek = 40;
  const totalHours = 42.5;
  $('view-settings').hidden = true;
  $('view-main').hidden = false;
  $('currency-symbol').textContent = 'kr';
  $('source-currency').value = '\\u{1F1F8}\\u{1F1EA} SEK kr';
  $('price').value = withResult ? '12999' : '';
  $('no-rate').hidden = true;
  $('result').hidden = !withResult;

  $('time').textContent = withResult ? I18n.formatHoursMinutes(totalHours) : '\\u00a0';
  $('framing').textContent = withResult
    ? I18n.render(Calc.framing(totalHours, hoursPerWeek))
    : '';
  const blocks = $('blocks');
  blocks.replaceChildren();
  if (withResult) {
    const bar = Calc.workdayBlocks(totalHours, hoursPerWeek);
    bar.filled.forEach((fill) => {
      const block = document.createElement('span');
      block.className = 'block';
      const inner = document.createElement('i');
      inner.style.width = Math.round(fill * 100) + '%';
      block.append(inner);
      blocks.append(block);
    });
    $('overflow').textContent =
      bar.overflowDays > 0 ? I18n.t('result.overflowDays', { days: bar.overflowDays }) : '';
  } else {
    $('overflow').textContent = '';
  }

  const rows = withResult ? PLAN.history : 0;
  const list = $('history-list');
  list.replaceChildren();
  for (let i = 0; i < rows; i += 1) {
    const row = document.createElement('li');
    const price = document.createElement('span');
    price.textContent = '12999 SEK';
    const time = document.createElement('span');
    time.textContent = I18n.formatBadge(totalHours, hoursPerWeek);
    row.append(price, time);
    list.append(row);
  }
  $('history-empty').hidden = rows > 0;
  $('total').textContent = rows
    ? I18n.t('history.total', { time: I18n.formatHoursMinutes(totalHours * rows) })
    : '';

  $('site-panel').hidden = false;
  $('site-host').textContent = 'www.example.com';
  $('site-currency').value = I18n.t('site.autoDetect');
  $('version').textContent = 'v0.0.0';
}

function setView(view) {
  if (view === 'settings') showSettings(false);
  else if (view === 'settings-first-run') showSettings(true);
  else showMain(view === 'main-result');
}

function setRateStatus(source) {
  $('rate-status').textContent = I18n.t('rates.updated', { date: PLAN.date, source: source });
}

// The number of line boxes the text actually occupies: one client rect per line.
function lineCount(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  return range.getClientRects().length;
}

// The height the browser has to find room for. body.scrollHeight alone is not
// it: the last .wide button's 12px bottom margin collapses through body, so it
// drops out of that number while the browser still paints it. Take the furthest
// bottom edge of the laid-out boxes, margins included. (documentElement's scroll
// height is no use here -- html stretches to the window, which is deliberately
// far taller than any popup.)
function documentHeight() {
  let edge = 0;
  const walk = (el) => {
    const style = getComputedStyle(el);
    if (style.display === 'none') return;
    edge = Math.max(edge, el.getBoundingClientRect().bottom + parseFloat(style.marginBottom || 0));
    for (const child of el.children) walk(child);
  };
  for (const child of document.body.children) walk(child);
  return Math.ceil(Math.max(edge, document.body.scrollHeight));
}

const probe = document.getElementById('probe');
const results = [];

// ?view=...&lang=...&width=... renders one view and stops, so the same harness
// that measures the popup can also be looked at.
function preview(query) {
  const width = query.get('width');
  if (width) probe.textContent = ':root { --popup-width: ' + Number(width) + 'px; }';
  I18n.setLanguage(query.get('lang') || 'en');
  applyTranslations();
  setView(query.get('view'));
  setRateStatus(query.get('source') || PLAN.sources[0]);
  document.documentElement.setAttribute('data-height', String(documentHeight()));
}

function measureAll() {
  for (const widthCase of PLAN.widths) {
    probe.textContent = ':root { --popup-width: ' + widthCase.width + 'px; }';
    for (const language of I18n.LANGUAGES) {
      I18n.setLanguage(language);
      applyTranslations();
      for (const view of PLAN.views) {
        setView(view);
        let height = 0;
        let statusLines = 0;
        for (const source of PLAN.sources) {
          setRateStatus(source);
          void document.body.offsetHeight;
          height = Math.max(height, documentHeight());
          if (view.startsWith('main')) {
            statusLines = Math.max(statusLines, lineCount($('rate-status')));
          }
        }
        results.push({
          width: widthCase.width,
          widthLabel: widthCase.label,
          language,
          view,
          height,
          bodyScrollHeight: document.body.scrollHeight,
          statusLines,
        });
      }
    }
  }

  document.documentElement.setAttribute(
    'data-measurements',
    btoa(unescape(encodeURIComponent(JSON.stringify(results))))
  );
}

const query = new URLSearchParams(location.search);
if (query.has('view')) preview(query);
else measureAll();
`;

const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <style>${css}</style>
    <style id="probe"></style>
  </head>
  <body>
${markup}
    <script>${read('lib/calc.js')}</script>
    <script>${read('lib/i18n.js')}</script>
    <script>${driver}</script>
  </body>
</html>
`;

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    console.error(
      'No Chrome found. Install Chrome or Chromium, or set CHROME_PATH to the binary.\nLooked in:\n  ' +
        candidates.join('\n  ')
    );
    process.exit(2);
  }
  return found;
}

function measure() {
  // A throwaway profile: this must never touch the user's own Chrome session.
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'worthit-measure-'));
  const pagePath = path.join(workdir, 'popup-harness.html');
  fs.writeFileSync(pagePath, page);
  try {
    const dom = execFileSync(
      chromePath(),
      [
        '--headless=new',
        '--disable-gpu',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        `--user-data-dir=${path.join(workdir, 'profile')}`,
        // Tall enough that nothing is clamped by the viewport; the popup's own
        // width comes from the CSS, not from the window.
        '--window-size=900,4000',
        '--dump-dom',
        `file://${pagePath}`,
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const encoded = /data-measurements="([^"]*)"/.exec(dom);
    if (!encoded) {
      console.error('The harness page did not report any measurements.');
      process.exit(2);
    }
    return JSON.parse(Buffer.from(encoded[1], 'base64').toString('utf8'));
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
}

const pageFlag = process.argv.indexOf('--page');
if (pageFlag !== -1) {
  const out = path.resolve(process.argv[pageFlag + 1] || 'popup-harness.html');
  fs.writeFileSync(out, page);
  console.log(`file://${out}?view=settings&lang=en&width=${shipped}`);
  process.exit(0);
}

const results = measure();
const budget = CAP - HEADROOM;
const languages = [...new Set(results.map((r) => r.language))];
const failures = [];

for (const result of results) {
  if (MUST_FIT.includes(result.view) && result.height > budget) {
    failures.push(
      `${result.view} is ${result.height}px in ${result.language} at ${result.widthLabel}` +
        ` -- over the ${budget}px budget (${CAP}px cap less ${HEADROOM}px headroom)`
    );
  }
  if (result.statusLines > 1) {
    failures.push(
      `rates.updated wraps onto ${result.statusLines} lines in ${result.language}` +
        ` at ${result.widthLabel} (${result.view})`
    );
  }
}

// No view may change by more than one line when the language is switched: that
// is the symptom #107 is about, a scrollbar that depends on the translation.
const LINE = 20;
for (const widthCase of widths) {
  for (const view of plan.views) {
    const heights = results
      .filter((r) => r.width === widthCase.width && r.view === view)
      .map((r) => r.height);
    const spread = Math.max(...heights) - Math.min(...heights);
    if (spread > LINE) {
      failures.push(
        `${view} swings ${spread}px across languages at ${widthCase.label} -- more than one line`
      );
    }
  }
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ shipped, cap: CAP, budget, results, failures }, null, 2));
} else {
  console.log(`popup width ${shipped}px, store cap ${CAP}px, budget ${budget}px\n`);
  for (const widthCase of widths) {
    console.log(`at ${widthCase.label}:`);
    const head = ['language', ...plan.views].map((h) => h.padEnd(19)).join('');
    console.log('  ' + head);
    for (const language of languages) {
      const cells = plan.views.map((view) => {
        const row = results.find(
          (r) => r.width === widthCase.width && r.language === language && r.view === view
        );
        const over = MUST_FIT.includes(view) && row.height > budget;
        const wraps = row.statusLines > 1;
        const mark = over ? ' OVER' : wraps ? ' WRAP' : '';
        return `${row.height}px${mark}`.padEnd(19);
      });
      console.log('  ' + language.padEnd(19) + cells.join(''));
    }
    console.log('');
  }
}

if (failures.length) {
  console.error('FAIL');
  for (const failure of failures) console.error('  - ' + failure);
  process.exit(1);
}
console.log('OK: every budgeted view fits, and rates.updated stays on one line.');
