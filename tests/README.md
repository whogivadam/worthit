# Tests

Plain Node tests — `node:test` plus `node:assert/strict`, no browser and no test framework
dependency. Run them with `npm test`; they must pass before a build.

The modules under `lib/` are classic browser scripts with a CommonJS export tail, so each suite
simply `require()`s the same file the extension ships.

| Suite | Covers |
| --- | --- |
| `parser.test.js` | `(price string, page context)` to `(amount, currency)`: separators, prefix and suffix symbols, ISO codes, currency words and native scripts, regional quirks, zero-decimal currencies, the ambiguity resolution order, and the reject cases |
| `calc.test.js` | hourly and monthly income conversion, rounding, and the framing-line thresholds |
| `rates.test.js` | USD cross-conversion, cache-age logic, and the provider fallback order with a mocked `fetch` |
