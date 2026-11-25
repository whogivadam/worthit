'use strict';
// App Store validation rejects a Safari build when a locale's extensionDescription
// exceeds 112 characters (Chrome allows 132). Keep every locale within Safari's limit.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const LIMIT = 112;
const dir = path.join(__dirname, '..', '_locales');
const locales = fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory());

for (const locale of locales) {
  test(`${locale}: extensionDescription is at most ${LIMIT} characters`, () => {
    const messages = JSON.parse(fs.readFileSync(path.join(dir, locale, 'messages.json'), 'utf8'));
    const text = messages.extensionDescription && messages.extensionDescription.message;
    assert.equal(typeof text, 'string', 'extensionDescription.message missing');
    assert.ok(text.length <= LIMIT, `${text.length} characters: ${text}`);
  });
}
