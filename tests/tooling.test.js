'use strict';

// Guards the repository's own contract. The commit types and scopes are declared
// in three places that have to agree -- commitlint, the PR-title workflow and
// CONTRIBUTING.md -- and the packaging ignore list has to keep non-runtime files
// out of the zip. Nothing here touches the extension; it exists so that drift in
// the tooling fails a test run instead of a release.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const pkg = JSON.parse(read('package.json'));
const commitlint = require('../commitlint.config.js');

/** Pulls the items out of a `key: |` YAML block scalar. */
function blockScalarList(yaml, key) {
  const lines = yaml.split('\n');
  const start = lines.findIndex((line) => line.trim() === `${key}: |`);
  assert.notEqual(start, -1, `expected a "${key}: |" block`);
  const indent = lines[start].match(/^ */)[0].length;
  const items = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') break;
    if (line.match(/^ */)[0].length <= indent) break;
    items.push(line.trim());
  }
  return items;
}

/** Pulls the `backticked` tokens out of a "**Label** — ..." paragraph. */
function documentedTokens(markdown, label) {
  const start = markdown.indexOf(`**${label}** —`);
  assert.notEqual(start, -1, `expected a "**${label}**" paragraph in CONTRIBUTING.md`);
  const end = markdown.indexOf('Nothing else.', start);
  assert.notEqual(end, -1, `expected "Nothing else." after **${label}**`);
  return [...markdown.slice(start, end).matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

test('package.json exposes every script the workflows and docs call', () => {
  for (const script of [
    'test',
    'lint',
    'build',
    'sign',
    'snapshot',
    'check-zip',
    'check-privacy',
    'prepare',
  ]) {
    assert.equal(typeof pkg.scripts[script], 'string', `missing npm script: ${script}`);
  }
});

test('the test script names files rather than a directory', () => {
  // `node --test tests/` is not portable: Node 26 scans the directory, while
  // Node 24 -- which CI runs -- takes the positional as a single test file and
  // dies with MODULE_NOT_FOUND. Letting the shell expand the glob hands Node
  // explicit file paths, which every version accepts.
  assert.match(
    pkg.scripts.test,
    /tests\/\*\.test\.js/,
    'npm test must pass explicit file paths, not a bare directory',
  );

  const suites = fs.readdirSync(path.join(root, 'tests')).filter((f) => f.endsWith('.test.js'));
  assert.ok(suites.length > 0, 'tests/ must contain at least one *.test.js file');
});

test('.gitignore keeps build output and secrets out of the repository', () => {
  const ignored = read('.gitignore')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (const entry of [
    'node_modules/',
    'web-ext-artifacts/',
    'dist/',
    'coverage/',
    '.env',
    '.env.*',
    '.amo-upload-uuid',
    '*.log',
    '.DS_Store',
  ]) {
    assert.ok(ignored.includes(entry), `.gitignore is missing ${entry}`);
  }
});

test('commitlint, the pr-title workflow and CONTRIBUTING.md agree on the types', () => {
  const fromCommitlint = commitlint.rules['type-enum'][2];
  const fromWorkflow = blockScalarList(read('.github/workflows/pr-title.yml'), 'types');
  const fromDocs = documentedTokens(read('CONTRIBUTING.md'), 'Types');

  assert.deepEqual([...fromWorkflow].sort(), [...fromCommitlint].sort());
  assert.deepEqual([...fromDocs].sort(), [...fromCommitlint].sort());
});

test('commitlint, the pr-title workflow and CONTRIBUTING.md agree on the scopes', () => {
  const fromCommitlint = commitlint.rules['scope-enum'][2];
  const fromWorkflow = blockScalarList(read('.github/workflows/pr-title.yml'), 'scopes');
  const fromDocs = documentedTokens(read('CONTRIBUTING.md'), 'Scopes');

  assert.deepEqual([...fromWorkflow].sort(), [...fromCommitlint].sort());
  assert.deepEqual([...fromDocs].sort(), [...fromCommitlint].sort());
});

test('commitlint enforces a scope and a 72 character header', () => {
  assert.deepEqual(commitlint.rules['scope-empty'], [2, 'never']);
  assert.deepEqual(commitlint.rules['header-max-length'], [2, 'always', 72]);
});

test('dependabot commits a scope that commitlint accepts', () => {
  const dependabot = read('.github/dependabot.yml');
  const prefixes = [...dependabot.matchAll(/prefix: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(prefixes.length >= 2, 'expected a commit-message prefix per ecosystem');

  const types = commitlint.rules['type-enum'][2];
  const scopes = commitlint.rules['scope-enum'][2];
  for (const prefix of prefixes) {
    const match = prefix.match(/^(\w+)\(([\w-]+)\)$/);
    assert.ok(match, `dependabot prefix "${prefix}" is not type(scope)`);
    assert.ok(types.includes(match[1]), `dependabot type "${match[1]}" is not allowed`);
    assert.ok(scopes.includes(match[2]), `dependabot scope "${match[2]}" is not allowed`);
  }
});

test('release-please keeps package.json and manifest.json versions together', async () => {
  const config = JSON.parse(read('release-please-config.json'));
  const root_ = config.packages['.'];
  assert.equal(root_['bump-minor-pre-major'], true, 'must stay on 0.x until stable');
  assert.deepEqual(root_['extra-files'], [
    { type: 'json', path: 'manifest.json', jsonpath: '$.version' },
  ]);

  // The release PR title has to satisfy the pr-title check as well, so its scope
  // must be one commitlint accepts.
  const pattern = config['pull-request-title-pattern'];
  const scopes = commitlint.rules['scope-enum'][2];
  const match = pattern.match(/^(\w+)\(([\w-]+)\):/);
  assert.ok(match, `release PR title pattern "${pattern}" is not type(scope):`);
  assert.ok(scopes.includes(match[2]), `release PR scope "${match[2]}" is not allowed`);

  const manifest = JSON.parse(read('.release-please-manifest.json'));
  assert.equal(manifest['.'], pkg.version, 'release-please manifest is out of step with package.json');
});

test('the packaging ignore list excludes everything that is not runtime code', async () => {
  const config = (await import('../web-ext-config.mjs')).default;
  const ignored = config.ignoreFiles;
  for (const entry of [
    'tests',
    'docs',
    'scripts',
    '.github',
    'node_modules',
    'web-ext-artifacts',
    'dist',
    'coverage',
    '.husky',
    'amo-metadata.json',
    'package.json',
    'package-lock.json',
    'web-ext-config.mjs',
    'eslint.config.js',
    'commitlint.config.js',
    '**/*.md',
  ]) {
    assert.ok(ignored.includes(entry), `ignoreFiles is missing ${entry}`);
  }
  // LICENSE must stay in the zip.
  assert.ok(!ignored.includes('LICENSE'), 'LICENSE must ship inside the extension');
});

test('every element the popup script reaches for exists in its HTML', () => {
  // The popup has no automated DOM test, so this pins the one contract that
  // breaks silently: a renamed or mistyped id. A miss here would show up as a
  // dead button rather than an error.
  const script = read('popup/popup.js');
  const markup = read('popup/popup.html');

  const ids = new Set(
    [...markup.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]),
  );
  const wanted = new Set([
    ...[...script.matchAll(/\$\('([^']+)'\)/g)].map((match) => match[1]),
    ...[...script.matchAll(/getElementById\('([^']+)'\)/g)].map((match) => match[1]),
  ]);

  assert.ok(wanted.size > 10, `expected the popup to address many elements, saw ${wanted.size}`);
  for (const id of wanted) {
    assert.ok(ids.has(id), `popup.js addresses #${id}, which popup.html does not define`);
  }

  // Attribute selectors too, e.g. the income-mode radios.
  const names = new Set([...markup.matchAll(/\bname="([^"]+)"/g)].map((match) => match[1]));
  for (const [, name] of script.matchAll(/\[name="([^"]+)"\]/g)) {
    assert.ok(names.has(name), `popup.js selects [name="${name}"], which popup.html does not define`);
  }
});

test('the popup builds nodes instead of assigning markup', () => {
  // innerHTML in an extension popup is what AMO review flags first, and the
  // history list renders user-entered text.
  const script = read('popup/popup.js');
  const assignments = script.match(/\.innerHTML\s*=/g) || [];
  assert.deepEqual(assignments, [], 'popup.js must not assign innerHTML');
  assert.match(script, /replaceChildren\(/, 'expected DOM construction');
});

test('the popup ships the required rate attribution', () => {
  const markup = read('popup/popup.html');
  assert.match(markup, /Rates by ExchangeRate-API/);
  assert.match(markup, /href="https:\/\/www\.exchangerate-api\.com"/);
});

test('the popup loads every library it uses, in dependency order', () => {
  const markup = read('popup/popup.html');
  const scripts = [...markup.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.deepEqual(scripts, [
    '../lib/currencies.js',
    '../lib/parser.js',
    '../lib/calc.js',
    '../lib/rates.js',
    'popup.js',
  ]);
});
