// Used by `web-ext build`, `web-ext lint` and `web-ext sign`.
//
// ignoreFiles must exclude everything that is not runtime code, so the zip holds
// only: manifest.json, LICENSE, icons/, background/, popup/, content/, lib/ and
// _locales/. One zip is submitted to both stores, so nothing here may be
// browser-specific.
// Verified after every build by scripts/check-zip.mjs.
export default {
  ignoreFiles: [
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
    'release-please-config.json',
    '.release-please-manifest.json',
    '.editorconfig',
    '.gitignore',
    '**/*.md',
  ],
  build: {
    overwriteDest: true,
  },
  lint: {
    // Must stay false. The dual background key in manifest.json raises one
    // permanent warning, BACKGROUND_SERVICE_WORKER_IGNORED: Firefox ignores
    // `service_worker` and tells you to make sure `scripts` covers it, which it
    // does. That warning is the design working, not a defect, and turning this
    // on would fail CI on every run for it. Errors still fail, as they should.
    warningsAsErrors: false,
  },
};
