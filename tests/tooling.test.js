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
  // With no prior tag release-please falls back to its own default of 1.0.0,
  // which is how the first release PR proposed 1.0.0 instead of 0.1.0.
  assert.match(root_['initial-version'], /^0\./, 'the first release must be on 0.x');
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

test('the popup ships the required rate attribution, in every language', () => {
  // ExchangeRate-API's free tier requires the attribution link, so it is not
  // something a translation may quietly drop. The link lives in the markup; the
  // text it carries now comes from the string table, once per language.
  const markup = read('popup/popup.html');
  assert.match(markup, /href="https:\/\/www\.exchangerate-api\.com"/);
  assert.match(markup, /data-i18n="rates\.attribution"/);

  const i18n = require('../lib/i18n.js');
  i18n.LANGUAGES.forEach((language) => {
    const text = i18n.MESSAGES[language]['rates.attribution'];
    assert.ok(text, `${language} is missing rates.attribution`);
    assert.match(text, /ExchangeRate-API/, `${language} must name ExchangeRate-API`);
  });
});

test('the popup loads every library it uses, in dependency order', () => {
  const markup = read('popup/popup.html');
  const scripts = [...markup.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.deepEqual(scripts, [
    '../lib/currencies.js',
    '../lib/parser.js',
    '../lib/calc.js',
    '../lib/i18n.js',
    '../lib/search.js',
    '../lib/rates.js',
    'popup.js',
  ]);
});

test('a failed AMO submission can be retried without a new version', () => {
  // The release job cannot retry itself: release-please runs first, sees the
  // release already exists, returns release_created false, and every later step
  // including the sign step is skipped. The dispatch path exists for that case.
  const workflow = read('.github/workflows/release-please.yml');

  assert.match(workflow, /^\s*workflow_dispatch:/m, 'expected a manual trigger');
  assert.match(workflow, /inputs:\s*\n\s*tag:/, 'the manual trigger takes a tag');

  // Each job must claim exactly one of the two triggers, or a dispatch would
  // run release-please again.
  assert.match(workflow, /release-please\n\s*if: github\.event_name == 'push'/);
  assert.match(workflow, /resubmit\n\s*if: github\.event_name == 'workflow_dispatch'/);

  // The retry has to verify the build the same way the release did.
  const resubmit = workflow.slice(workflow.indexOf('  resubmit:'));
  for (const step of ['npm test', 'npm run build', 'npm run check-zip', 'npm run check-privacy']) {
    assert.ok(resubmit.includes(step), `the retry path must run ${step}`);
  }
  assert.ok(resubmit.indexOf('npm run check-privacy') < resubmit.indexOf('npm run sign'),
    'the checks must run before signing');
});

test('AMO credentials come only from secrets, and only in the sign steps', () => {
  const workflow = read('.github/workflows/release-please.yml');
  const signSteps = workflow.split('npm run sign').length - 1;
  assert.equal(signSteps, 2, 'one sign step on the release path, one on the retry path');

  assert.equal(workflow.split('secrets.AMO_JWT_ISSUER').length - 1, 2);
  assert.equal(workflow.split('secrets.AMO_JWT_SECRET').length - 1, 2);
  // Nothing resembling a literal credential.
  assert.doesNotMatch(workflow, /user:\d+:\d+/, 'an issuer must never be written into the workflow');
});

test('no workflow interpolates a value straight into a shell script', () => {
  // A `${{ }}` written into a `run:` block is a script injection waiting to
  // happen -- the workflow_dispatch tag is attacker-controllable in the general
  // case. Values have to reach the shell through the environment. `ref:`,
  // `env:` and `if:` are not shell, so they are untouched by this.
  const workflows = fs
    .readdirSync(path.join(root, '.github/workflows'))
    .map((name) => ['.github/workflows/' + name, read('.github/workflows/' + name)]);

  let checked = 0;
  for (const [name, workflow] of workflows) {
    const lines = workflow.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const start_ = lines[i].match(/^(\s*)(?:-\s+)?run:(.*)$/);
      if (!start_) continue;
      checked += 1;

      // Only a block scalar continues onto the following lines; a one-line
      // `run: cmd` is just itself, and what follows is another YAML key.
      const isBlock = /^\s*[|>]/.test(start_[2]);
      const block = [lines[i]];
      if (isBlock) {
        const indent = lines[i].indexOf('run:');
        for (let j = i + 1; j < lines.length; j += 1) {
          if (lines[j].trim() === '') continue;
          if (lines[j].match(/^\s*/)[0].length <= indent) break;
          block.push(lines[j]);
        }
      }

      const injected = block.join('\n').match(/\$\{\{[^}]*\}\}/g);
      assert.equal(
        injected,
        null,
        `${name}:${i + 1} interpolates ${injected} into a shell script; pass it through env instead`,
      );
    }
  }
  assert.ok(checked > 5, `expected to inspect several run blocks, saw ${checked}`);

  // And the retry path passes its tag the right way.
  assert.match(
    read('.github/workflows/release-please.yml'),
    /env:\s*\n\s*TAG: \$\{\{ inputs\.tag \}\}/,
  );
});
