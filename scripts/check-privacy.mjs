// Enforces the privacy invariant over the files that actually ship.
//
// No user data is stored or shared anywhere but locally, and the only outbound
// request is the exchange-rate fetch. That promise is in PRIVACY.md, in the AMO
// listing and in the manifest's data_collection_permissions, so it should break
// the build when it regresses rather than ship quietly.

import fs from 'node:fs';
import path from 'node:path';

// Runtime code only -- the same set the zip carries, minus the binary icons.
const ROOTS = ['manifest.json', 'lib', 'background', 'popup', 'content'];
const TEXT_EXTENSIONS = new Set(['.js', '.json', '.html', '.css']);

// The rate providers, plus the two attribution links the popup is required to
// show. Nothing here is a request the extension makes on the user's behalf
// beyond the first three.
const ALLOWED_HOSTS = new Set([
  'open.er-api.com',
  'api.frankfurter.app',
  'api.frankfurter.dev',
  'www.exchangerate-api.com',
  'frankfurter.dev',
]);

// `fetch` is allowed only in the rate layer and its background driver.
const FETCH_ALLOWED = [path.join('background', ''), path.join('lib', 'rates.js')];

const BANNED = [
  { pattern: /storage\s*\.\s*sync/, rule: 'storage.sync', why: 'settings must never leave the device' },
  { pattern: /\bXMLHttpRequest\b/, rule: 'XMLHttpRequest', why: 'only the rate fetch may use the network' },
  { pattern: /\bsendBeacon\b/, rule: 'navigator.sendBeacon', why: 'no telemetry' },
  { pattern: /\bnew\s+WebSocket\b/, rule: 'WebSocket', why: 'no persistent connections' },
  { pattern: /\bnew\s+EventSource\b/, rule: 'EventSource', why: 'no server-sent events' },
  { pattern: /\bnavigator\s*\.\s*geolocation\b/, rule: 'geolocation', why: 'no location access' },
];

const problems = [];

function walk(entry) {
  const stat = fs.existsSync(entry) ? fs.statSync(entry) : null;
  if (!stat) return [];
  if (stat.isFile()) return [entry];
  return fs
    .readdirSync(entry)
    .flatMap((name) => walk(path.join(entry, name)));
}

const files = ROOTS.flatMap(walk).filter((file) => TEXT_EXTENSIONS.has(path.extname(file)));

function report(file, lineNumber, rule, detail) {
  problems.push({ file, line: lineNumber, rule, detail });
}

for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const fetchAllowedHere = FETCH_ALLOWED.some((allowed) => file.startsWith(allowed));

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    // Any absolute URL has to be on the allowlist.
    const urls = line.match(/https?:\/\/[^\s"'`)<>\\]+/g) || [];
    for (const url of urls) {
      let host;
      try {
        host = new URL(url).host;
      } catch {
        host = '';
      }
      if (!ALLOWED_HOSTS.has(host)) {
        report(file, lineNumber, 'external URL', url);
      }
    }

    // No remote assets: everything the extension renders ships with it.
    const remoteAsset = line.match(/(?:src|href)\s*=\s*["']\s*(?:https?:)?\/\//i);
    if (remoteAsset) {
      const sameLineUrls = line.match(/(?:src|href)\s*=\s*["']\s*(https?:)?\/\/[^"']*/i);
      report(file, lineNumber, 'remote asset', sameLineUrls ? sameLineUrls[0] : remoteAsset[0]);
    }
    if (/@import\s+(?:url\()?["']?\s*(?:https?:)?\/\//i.test(line)) {
      report(file, lineNumber, 'remote stylesheet', line.trim());
    }

    for (const banned of BANNED) {
      if (banned.pattern.test(line)) {
        report(file, lineNumber, banned.rule, banned.why);
      }
    }

    // fetch() outside the rate layer.
    if (!fetchAllowedHere && /(^|[^.\w])fetch\s*\(/.test(line)) {
      report(file, lineNumber, 'fetch outside the rate layer', line.trim());
    }
  });
}

// The manifest must keep declaring that nothing is collected, and must not ask
// for a permission that would let it collect anything.
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const declared = manifest.browser_specific_settings?.gecko?.data_collection_permissions?.required;
if (!Array.isArray(declared) || declared.length !== 1 || declared[0] !== 'none') {
  problems.push({
    file: 'manifest.json',
    line: 0,
    rule: 'data_collection_permissions',
    detail: 'gecko.data_collection_permissions.required must be exactly ["none"]',
  });
}

const ALLOWED_PERMISSIONS = new Set(['storage', 'alarms', 'activeTab']);
for (const permission of manifest.permissions || []) {
  if (!ALLOWED_PERMISSIONS.has(permission)) {
    problems.push({
      file: 'manifest.json',
      line: 0,
      rule: 'permission',
      detail: `"${permission}" is not one of storage, alarms, activeTab`,
    });
  }
}

const ALLOWED_HOST_PERMISSIONS = new Set([
  'https://open.er-api.com/*',
  'https://api.frankfurter.app/*',
  'https://api.frankfurter.dev/*',
]);
for (const host of manifest.host_permissions || []) {
  if (!ALLOWED_HOST_PERMISSIONS.has(host)) {
    problems.push({
      file: 'manifest.json',
      line: 0,
      rule: 'host permission',
      detail: `"${host}" is not a declared rate provider`,
    });
  }
}

if (problems.length) {
  console.error('check-privacy: the privacy invariant is broken\n');
  for (const problem of problems) {
    const where = problem.line ? `${problem.file}:${problem.line}` : problem.file;
    console.error(`  ${where}\n    ${problem.rule}: ${problem.detail}`);
  }
  console.error('\n  See PRIVACY.md. If a change here is genuinely intended, that document,');
  console.error('  the AMO listing description and this script all have to change together.');
  process.exit(1);
}

console.error(`check-privacy: ${files.length} shipped files clean`);
