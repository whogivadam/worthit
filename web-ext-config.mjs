// Used by `web-ext build`, `web-ext lint` and `web-ext sign`.
//
// ignoreFiles must exclude everything that is not runtime code, so the zip holds
// only: manifest.json, LICENSE, icons/, background/, popup/, content/, lib/.
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
    warningsAsErrors: false,
  },
};
