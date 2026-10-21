'use strict';

// Regenerates lib/rates-snapshot.json, the last resort in the provider chain.
//
// The snapshot ships inside the extension so a first run with no network still
// converts prices, which is why it is committed rather than generated at install
// time. Run it with `npm run snapshot`.

const fs = require('node:fs');
const path = require('node:path');

const Rates = require('../lib/rates.js');

const TARGET = path.join(__dirname, '..', 'lib', 'rates-snapshot.json');

async function main() {
  const result = await Rates.fetchRates({
    fetchImpl: (url) => fetch(url),
  });

  if (!result) {
    console.error('build-snapshot: every rate provider failed, snapshot left unchanged');
    process.exit(1);
  }

  const snapshot = {
    base: result.base,
    rateDate: result.rateDate,
    source: 'snapshot',
    generatedFrom: result.source,
    generatedAt: new Date().toISOString(),
    rates: result.rates,
  };

  fs.writeFileSync(TARGET, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  console.error(
    `build-snapshot: wrote ${Object.keys(snapshot.rates).length} rates ` +
      `from ${result.source}, published ${result.rateDate}`,
  );
}

main().catch((error) => {
  console.error('build-snapshot: ' + (error && error.message ? error.message : error));
  process.exit(1);
});
