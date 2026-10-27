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

test('one manifest serves both browsers, from two background keys', () => {
  // Chrome takes service_worker and ignores scripts from Chrome 121; Firefox
  // takes scripts and starts its event page regardless of service_worker from
  // Firefox 121. Declaring both is what lets one zip go to both stores with no
  // build step. Dropping either key silently breaks one browser: Chrome loses
  // its background entirely, Firefox loses rate fetching.
  const manifest = JSON.parse(read('manifest.json'));
  const background = manifest.background;

  assert.ok(Array.isArray(background.scripts), 'Firefox needs background.scripts');
  assert.equal(
    typeof background.service_worker,
    'string',
    'Chrome needs background.service_worker, and it takes one file, not a list'
  );

  // The service worker is the last of the scripts, and loads the rest itself.
  assert.equal(background.service_worker, background.scripts[background.scripts.length - 1]);
  background.scripts.forEach((file) => {
    assert.ok(fs.existsSync(path.join(root, file)), `${file} is missing`);
  });
});

test('the service-worker path loads its own dependencies', () => {
  // Chrome hands the worker one file. Anything background.scripts would have
  // loaded for Firefox has to be imported here, or Chrome throws on a
  // globalThis.WorthIt* that was never defined.
  const manifest = JSON.parse(read('manifest.json'));
  const source = read(manifest.background.service_worker);
  const others = manifest.background.scripts.filter(
    (file) => file !== manifest.background.service_worker
  );

  assert.ok(others.length, 'expected the event page to load more than the worker file');
  others.forEach((file) => {
    assert.ok(
      source.includes(`importScripts('/${file}')`),
      `${manifest.background.service_worker} must importScripts('/${file}')`
    );
  });
  assert.match(source, /typeof importScripts === 'function'/, 'guarded for the event page');
});

test('the background registers every listener at the top level', () => {
  // The MV3 requirement neither browser forgives: a listener added inside an
  // async callback is not registered when the context is rebuilt for an event,
  // so the event is missed. Indentation is the signal -- these must sit in the
  // IIFE body, two spaces in, not nested inside anything.
  const source = read('manifest.json');
  const background = read(JSON.parse(source).background.service_worker);
  const listeners = background.match(/^ {0,2}browser\.[\w.]+\.addListener\(/gm) || [];
  const nested = background.match(/^ {3,}browser\.[\w.]+\.addListener\(/gm) || [];

  assert.ok(listeners.length >= 4, `expected top-level listeners, found ${listeners.length}`);
  assert.deepEqual(nested, [], 'these listeners are nested and will miss events');
});

test('Chrome gets a minimum version it can actually run', () => {
  // 148 is the first Chrome to expose the extension APIs under `browser`, which
  // is the whole reason no shim or polyfill ships. Lowering this without adding
  // one would leave `browser` undefined in Chrome and break everything.
  const manifest = JSON.parse(read('manifest.json'));
  assert.ok(manifest.minimum_chrome_version, 'minimum_chrome_version must be set');
  assert.ok(
    Number(manifest.minimum_chrome_version) >= 148,
    'below Chrome 148 the `browser` namespace does not exist and a shim is required'
  );
});

test('the 128px icon is declared and shipped', () => {
  // It was excluded from the zip while it was only the AMO listing icon. Chrome
  // shows it in the browser, so it ships now -- and check-zip rejects an icon
  // the manifest does not reference, so the two have to agree.
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.icons['128'], 'icons/icon-128.png');
  assert.ok(fs.existsSync(path.join(root, 'icons/icon-128.png')));

  const checkZip = read('scripts/check-zip.mjs');
  assert.match(checkZip, /'icons\/icon-128\.png'/, 'check-zip must require it');
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

test('the AMO listing is translated wherever the extension is', () => {
  // AMO spells Swedish 'sv-SE'; the extension spells it 'sv' in _locales/, in
  // I18n.LANGUAGES and in the language setting. The two are not interchangeable
  // and amo-metadata.json is strict JSON with nowhere to write that down, so it
  // is recorded here and in docs/amo/README.md instead.
  const AMO_LOCALE = { en: 'en-US', sv: 'sv-SE' };

  // Prose the reader sees, which has to exist in every language the UI offers.
  const TRANSLATED = ['summary', 'description'];
  // Deliberately one locale only: 'Worth It?' is the product name, untranslated
  // in _locales/sv/messages.json too, and the rest are URLs and an address.
  const SINGLE = ['name', 'homepage', 'support_email', 'support_url'];

  const metadata = JSON.parse(read('amo-metadata.json'));
  const locales = Object.keys(metadata.summary).sort();

  TRANSLATED.forEach((field) => {
    assert.deepEqual(Object.keys(metadata[field]).sort(), locales, `${field} locales`);
    locales.forEach((locale) => {
      assert.ok(metadata[field][locale], `${field} is empty in ${locale}`);
    });
  });

  SINGLE.forEach((field) => {
    assert.deepEqual(Object.keys(metadata[field]), ['en-US'], `${field} should not be translated`);
  });

  // AMO rejects a summary over 250 characters, and Swedish runs longer than
  // English, so this is worth asserting rather than eyeballing.
  locales.forEach((locale) => {
    assert.ok(
      metadata.summary[locale].length <= 250,
      `summary ${locale} is ${metadata.summary[locale].length} characters, over AMO's 250`
    );
  });

  // The point of the test: adding a third UI language fails here until the
  // listing is translated too, rather than shipping a store page in English.
  const i18n = require('../lib/i18n.js');
  i18n.LANGUAGES.forEach((language) => {
    const locale = AMO_LOCALE[language];
    assert.ok(locale, `no AMO locale is mapped for the UI language ${language}`);
    assert.ok(locales.includes(locale), `the listing has no ${locale} for UI language ${language}`);
  });
});

test('every locale of the listing makes the same privacy claims', () => {
  // The privacy section is more than half the description and states facts that
  // check-privacy and the manifest enforce. A translation that softened or
  // dropped one of them would be an inaccurate claim on a public store page.
  //
  // Each claim is matched per locale, and the patterns allow synonyms on purpose:
  // the point is to catch a claim going missing, not to freeze the wording. An
  // earlier version of this test pinned 'exakt en typ' and failed the moment a
  // Swedish speaker quite rightly made it 'endast en typ'.
  const CLAIMS = [
    {
      claim: 'browser sync is never used',
      'en-US': /never uses browser sync/i,
      'sv-SE': /aldrig webbläsarsynkronisering/i,
    },
    {
      claim: 'there is only one kind of network request',
      'en-US': /(exactly|only|just) one kind of network request/i,
      'sv-SE': /(endast|exakt|bara) en typ av nätverksanrop/i,
    },
    {
      claim: 'that request carries nothing but the USD-based rate table',
      'en-US': /USD as the base/i,
      'sv-SE': /USD som bas/i,
    },
    { claim: 'no cookies', 'en-US': /no cookies/i, 'sv-SE': /inga kakor/i },
    {
      claim: 'no analytics or telemetry',
      'en-US': /no analytics, telemetry/i,
      'sv-SE': /ingen analys, telemetri/i,
    },
    {
      claim: 'no third-party script, font or CDN',
      'en-US': /third-party/i,
      'sv-SE': /tredje part/i,
    },
    {
      claim: 'the tabs permission is deliberately not requested',
      'en-US': /"tabs" permission/i,
      'sv-SE': /behörigheten "tabs"/i,
    },
    { claim: 'MIT licensed', 'en-US': /MIT/, 'sv-SE': /MIT/ },
  ];

  const metadata = JSON.parse(read('amo-metadata.json'));
  Object.keys(metadata.description).forEach((locale) => {
    CLAIMS.forEach((entry) => {
      const pattern = entry[locale];
      assert.ok(pattern, `no pattern for ${locale}: add one when adding a locale`);
      assert.match(
        metadata.description[locale],
        pattern,
        `the ${locale} description must still state: ${entry.claim}`
      );
    });
  });

  // And the claims have to be true of what actually ships.
  const manifest = JSON.parse(read('manifest.json'));
  assert.ok(!manifest.permissions.includes('tabs'), 'the listing says tabs is not requested');
  assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions.required, [
    'none',
  ]);
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
