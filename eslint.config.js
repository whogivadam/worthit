'use strict';

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'web-ext-artifacts/**',
      'dist/**',
      'coverage/**',
      'docs/amo/harness/vendor/**',
    ],
  },
  js.configs.recommended,
  {
    // Extension sources are classic scripts: they run as content scripts, popup
    // scripts and the background, and are also require()d by the Node test suite
    // through a CommonJS export tail. No bundler, no transpiler.
    files: ['lib/**/*.js', 'content/**/*.js', 'popup/**/*.js', 'background/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        ...globals.commonjs,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: true,
    },
    rules: {
      strict: ['error', 'function'],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-implicit-globals': 'off',
    },
  },
  {
    // The background is an event page in Firefox and a service worker in Chrome,
    // from the two keys in manifest.json, so it sees the worker globals too --
    // importScripts is how the service-worker path loads lib/rates.js.
    files: ['background/**/*.js'],
    languageOptions: {
      globals: { ...globals.serviceworker },
    },
  },
  {
    files: ['tests/**/*.js', 'scripts/**/*.js', 'commitlint.config.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
];
