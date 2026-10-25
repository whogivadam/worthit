# Worth It?

A Firefox extension that turns any price into the time it costs you: the hours of work needed to pay
for it, based on your own after-tax income.

Prices on a page get a small red badge — `3h45m`, or `2.5d` once it passes a working day — and the
popup lets you check any amount by hand, in your currency or another one.

```
1 299 kr  [3h12m]        €89,90  [1h47m]        $1,599  [2.1d]
```

## Why

A price is a number until you know what it costs you. Hours are harder to ignore than kronor.

## Install

- **Users** — install from addons.mozilla.org:
  <https://addons.mozilla.org/firefox/addon/worth-it/>

- **Development** — load it temporarily, no build step needed:
  1. clone this repository
  2. open `about:debugging#/runtime/this-firefox` in Firefox
  3. choose **Load Temporary Add-on** and pick `manifest.json` in the repository root

  A temporary add-on is removed when Firefox restarts, and Firefox may ask you to grant site access
  before the price badges appear.

Requires Firefox 140 or newer.

## Using it

On first run the popup asks for your income once, and never asks again:

- a monthly after-tax salary, or an hourly after-tax rate
- hours worked per week (40 by default)
- your home currency, pre-filled from your browser locale
- the interface language, English or Swedish, pre-filled from your browser language

The hourly rate is `monthly / (hours_per_week * 52 / 12)`.

Changing the language takes effect at once, in the popup and in the badges already on the page, and
is saved as you pick it rather than on **SAVE**.

From the popup you can also turn the page overlay off, disable the extension on the site you are
looking at, or force a particular currency on that site when its prices are ambiguous.

## Development

```sh
npm install          # also installs the git hooks
npm test             # Node's built-in test runner, no browser needed
npm run lint         # eslint
npx web-ext lint     # extension-specific linting
npm run build        # writes web-ext-artifacts/*.zip
npm run check-zip    # asserts the zip holds only runtime files
```

`npm test` must pass before a build. There is no bundler, minifier or transpiler — the extension
ships its source exactly as written.

## Privacy

No data is collected, and nothing you enter or look at leaves your browser. Your income, settings
and check history live only in `browser.storage.local` on your own machine; `storage.sync` is never
used. The one outbound request the extension makes is for public exchange rates, with a fixed query
that is identical for every user and contains no information about you.

Full detail in [PRIVACY.md](PRIVACY.md).

## Exchange rates

Rates by [ExchangeRate-API](https://www.exchangerate-api.com), with the European Central Bank feed
from [Frankfurter](https://frankfurter.dev) as a fallback and a bundled offline snapshot as a last
resort. The popup always shows which source and date are in use, and warns when the data is more
than seven days old.

## Contributing

Issues and pull requests are welcome — please read [CONTRIBUTING.md](CONTRIBUTING.md) first, since
commits, branches, issues and pull requests all follow a fixed convention here.

Security reports: see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Magnus Jeppsson
