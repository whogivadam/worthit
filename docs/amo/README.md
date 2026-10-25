# AMO listing assets

What goes in the addons.mozilla.org listing, and how to produce it again.

| File | What it is |
| --- | --- |
| `../../amo-metadata.json` | listing metadata passed to `web-ext sign --amo-metadata` |
| `../../icons/icon-48.png`, `icon-96.png` | shipped in the extension, referenced from `manifest.json` |
| `../../icons/icon-128.png` | the listing icon; not in the zip |
| `harness/se-shop.html`, `harness/us-shop.html` | mock shops for the overlay screenshots |
| `01-*.png` … `05-*.png` | the five listing screenshots, 1280 × 800 |

Icons are generated, not hand-drawn: `node scripts/build-icons.mjs` rewrites all three byte for byte.

## The mock shops

`harness/` holds two fake storefronts. They are **fixtures, not a preview** — the real extension runs
against them, exactly as it would on a real shop. They exist so the screenshots are reproducible and
so the overlay has something honest to be photographed on.

Between them they cover every case the spec names:

- **`se-shop.html`** — `18 999 kr`, a struck-through `2 499 kr` beside `1 299 kr`, a price split
  across two elements (`<span>1 299</span><span>kr</span>`), `499:-`, `2 499:99`, the range
  `399-599 kr`, plus things that must **not** be badged: the date `2026-01-15`, the phone number
  `+46 70 123 45 67`, the order number `123-45-67`, `RTX 4090`, and `Spara 48%`.
- **`us-shop.html`** — `$89.99`, `US$199.95`, `$1,249.00`, the range `$19 - $34`, a date, a US phone
  number, `20%` and an `RTX 4090` model name.

Served from `localhost` there is no country TLD, so the Swedish page resolves `kr` to SEK through its
`<html lang="sv">` and `og:locale` — that is the page-locale step of the ambiguity ladder doing the
work, which is worth knowing if a screenshot ever looks wrong.

Expected result with the settings below: **9 badges on each page.** If a page produces a different
number, something has regressed; `tests/overlay.test.js` covers the same cases.

## Capturing the screenshots

### 1. Set up

```sh
npm install
npm run build          # optional; the temporary add-on loads from source
python3 -m http.server 8000
```

Load the extension: open `about:debugging#/runtime/this-firefox` in Firefox, choose **Load Temporary
Add-on**, and pick `manifest.json` in the repository root. Firefox may ask you to grant site access
before badges appear.

### 2. Use these settings, so the figures match the listing text

- income: **monthly, 25000**
- hours per week: **40**
- home currency: **SEK**
- badges: **on**

Use a round, obviously illustrative figure rather than your own income. The badges let anyone work
the hourly rate back out of any price on the page, so a real salary in these screenshots is a real
salary on a public listing page.

25000 over a 40-hour week is an hourly rate of 144.23, so `1 299 kr` is `9 h 0 min` and its badge
reads `1.1d`. Press **REFRESH** once in the popup and wait for the rate line to show the current
date, so the USD shop converts with live rates rather than the bundled snapshot.

### 3. Set the window to exactly 1280 × 800

Open devtools (F12), turn on **Responsive Design Mode** (⌘⌥M on macOS, Ctrl+Shift+M elsewhere), set
the size to **1280 × 800** and the DPR to **1**. Use the camera button in the Responsive Design Mode
toolbar to save; it writes a PNG at exactly that size.

### 4. The five shots

| File | Page | What must be visible |
| --- | --- | --- |
| `01-popup-result.png` | popup, over `se-shop.html` | a price entered, the large `3 h 46 min`, "of your life", the framing line (`Half your workday`), the eight-block workday bar part-filled, COPY, and history rows with the running total |
| `02-settings.png` | popup, SETTINGS | income mode, the monthly field filled in, hours per week, home currency, and the badges toggle |
| `03-overlay-se.png` | `harness/se-shop.html` | the product grid with red badges on `18 999 kr`, `1 299 kr`, the split price, `499:-` and `2 499:99` — and visibly none on `RTX 4090` or the date in the footer |
| `04-overlay-us.png` | `harness/us-shop.html` | the row list with badges on `$89.99`, `US$199.95`, `$1,249.00` and both ends of `$19 - $34`, showing USD converted into SEK |
| `05-rate-status.png` | popup, footer | `Rates updated <date> · ExchangeRate-API`, the "Rates by ExchangeRate-API" attribution link and the REFRESH button |

For `05`, hover a badge on one of the shop pages first if you would rather show the tooltip — original
price, converted price, hours, the rate used and the rate date — but the rate line in the popup footer
is the one the listing needs.

Save all five into this directory, 1280 x 800 each. Responsive Design Mode on a HiDPI screen writes
them at 2560 x 1602 even with DPR 1; scale and crop with
`sips -Z 1280 shot.png && sips -c 800 1280 shot.png`. Nothing here ships in the extension: `docs/` is excluded by
`web-ext-config.mjs`, and `npm run check-zip` fails if that ever stops being true.

## Putting them on the listing

`web-ext sign --amo-metadata` carries the text fields in `amo-metadata.json` and nothing else. The
images are not part of that API, so the screenshots and the listing icon have to be uploaded by hand,
once, at
[addons.mozilla.org/developers/addon/worth-it/edit](https://addons.mozilla.org/en-US/developers/addon/worth-it/edit):

- **Listing icon** — `../../icons/icon-128.png`. Without it the listing shows Mozilla's grey
  placeholder, even though `manifest.json` references the 48 and 96 px icons and both ship in the zip.
- **Screenshots** — `01-*.png` … `05-*.png`, in that order; the order on the page is the order they
  are shown in.
- **Privacy policy** — optional. The description already carries the privacy section and the manifest
  declares no data collection, so the field being empty is not a review problem.

None of this is version-specific: it survives every later release, and a new version does not reset
or re-require it.
