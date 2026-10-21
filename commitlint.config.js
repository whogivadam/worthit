'use strict';

// Conventional Commits v1.0.0, narrowed to the types and scopes this project uses.
// Keep in sync with .github/workflows/pr-title.yml and CONTRIBUTING.md.
const TYPES = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
];

const SCOPES = [
  'popup',
  'overlay',
  'parser',
  'rates',
  'background',
  'calc',
  'manifest',
  'tests',
  'ci',
  'deps',
  'release',
  'repo',
];

module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', TYPES],
    'scope-enum': [2, 'always', SCOPES],
    'scope-empty': [2, 'never'],
    'header-max-length': [2, 'always', 72],
    'body-max-line-length': [0],
  },
};
