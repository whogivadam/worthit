# Chrome Web Store

How Worth It? reaches Chrome, and the parts of it that are not automated.

One zip goes to both stores. `manifest.json` declares **both** background keys:

```json
"background": {
  "scripts": ["lib/rates.js", "background/background.js"],
  "service_worker": "background/background.js"
}
```

Chrome takes `service_worker` and ignores `scripts` (from Chrome 121); Firefox takes `scripts` and
starts its event page regardless of `service_worker` (from Firefox 121). No build step, no second
manifest, no bundler — `npm run build` produces one artifact that installs in both.

**Each browser warns about the other's key, and both are expected.** Neither is an error and neither
stops the extension loading:

| Where | Warning | Meaning |
| --- | --- | --- |
| `npx web-ext lint` | `BACKGROUND_SERVICE_WORKER_IGNORED` | Firefox ignores `service_worker`; make sure `scripts` covers it. It does. |
| `chrome://extensions` | *'background.scripts' requires manifest version of 2 or lower* | Chrome ignores `scripts` in MV3. It has done since Chrome 121; before that it refused to load the extension at all, which is why 121 is the real floor for this pattern. |

Both are the price of one manifest instead of two, and both were confirmed against real browsers:
Chrome loads the extension, starts the worker and creates the daily alarm with the warning showing.
`lint.warningsAsErrors` in `web-ext-config.mjs` must stay `false` because of the first one.

Verified in Chrome, in the service worker console:

```js
await browser.alarms.getAll()
// [{ name: 'worthit-rates-refresh', periodInMinutes: 1440, persistAcrossSessions: true, … }]
```

That one line exercises the whole Chrome path at once: the worker started, `importScripts` loaded
`lib/rates.js`, `browser.*` resolved without a shim, and `ensureRefreshAlarm()` ran.

## No shim, and what that costs

`minimum_chrome_version` is **148**, the first Chrome to expose the extension APIs under the
`browser` namespace. Chrome 121 and later already return promises from every async extension API, so
all of the extension's `browser.*` calls work in Chrome unchanged — no polyfill, nothing vendored,
nothing new in the zip.

The floor excludes Chrome below 148, which cannot be measured exactly: StatCounter buckets everything
outside the top versions into "Other". Every version with a measurable share is 151 or newer, stable
was 156 in October 2026 on a two-week cadence, and Extended Stable — the eight-week enterprise
channel — sits around 154.

To lower the floor to 121, add a file containing
`globalThis.browser = globalThis.browser || globalThis.chrome;`, load it first everywhere
(`popup/popup.html`, the `content_scripts` list and the background), and change the one manifest
value. Nothing about shipping at 148 forecloses that.

## The account

- A Google account with **2-Step Verification** enabled, and a one-time **$5** registration fee,
  charged per account rather than per extension.
- The developer email **cannot be changed afterwards**. Ours matches the AMO contact,
  `worthit-ext@proton.me`.
- A **trader/non-trader** declaration is required for EU compliance.
- Dashboard: <https://chrome.google.com/webstore/devconsole/>

## The first submission is manual

CI cannot make it. A new extension has no item ID until a draft has been uploaded by hand in the
developer console, and cannot be published until its listing is complete. So:

1. **Add new item** and upload `web-ext-artifacts/*.zip` from `npm run build`. This creates the item
   and gives you its 32-character ID.
2. Fill **Store listing**, **Privacy practices** and **Distribution** — the fields below.
3. Submit for review.
4. Put the item ID and the OAuth credentials into the repository secrets, and every release after
   this one goes up from the `Release` workflow.

The **Privacy practices** tab only exists once the item does, and the permissions it asks you to
justify are read out of the manifest you uploaded — which is why there is nothing to fill in before
step 1.

## The listing fields

**Single purpose.** One sentence, narrow:

> Worth It? converts prices into the hours of work they cost the reader, using an after-tax income
> they enter once, and shows that figure next to prices on any shop and in its popup.

**Remote code:** *not using remote code*. `npm run check-privacy` enforces exactly that on every
change — no CDN, no remote script, font or configuration, all code inside the extension.

**Data usage:** nothing is collected. `manifest.json` declares
`data_collection_permissions: { required: ["none"] }` and the extension never uses `storage.sync`.
Privacy policy URL: <https://github.com/whogivadam/worthit/blob/main/PRIVACY.md>

**Permission justifications**, one per declared permission:

| Permission | Justification |
| --- | --- |
| `storage` | Stores the reader's income settings, per-site preferences and their last 20 checks in `storage.local` on their own machine. Never `storage.sync`, so none of it leaves the device. |
| `alarms` | Fetches published exchange rates on a 24-hour timer, and backs off on failure. A timer rather than page activity, so the timing of requests says nothing about what the reader browses. |
| `activeTab` | Reads the hostname of the current tab so the popup can offer to disable the extension on that site, or force a currency where its prices are ambiguous. |
| `https://open.er-api.com/*` | The exchange-rate provider. Fetches one USD-based rate table; the request carries no cookies, no referrer and nothing about the reader. |
| `https://api.frankfurter.app/*`, `https://api.frankfurter.dev/*` | The European Central Bank feed, used only as a fallback when the primary provider cannot be reached. |

**Host permission justification** for `<all_urls>` — the field that draws the closest review:

> Prices appear on any shop, in any country, so the price detector has to be able to run anywhere;
> there is no list of shopping sites that would not miss the one the reader is on. It reads page text
> locally to find prices and sends nothing anywhere. The extension deliberately does **not** request
> the `tabs` permission, so it cannot see the reader's tabs or browsing history.

The same text, longer, is the *WHY IT NEEDS ACCESS TO ANY SITE* section of `amo-metadata.json`.

**Assets**, both of which already exist and need no work: the five screenshots in `docs/amo/` are
1280 × 800, a size Chrome accepts, and `icons/icon-128.png` is the store icon. Unlike AMO, these go
up through the same dashboard as everything else.

## Automatic publishing

`npm run publish:chrome` runs `chrome-webstore-upload`, which uploads and submits for review in one
call and returns. Review is asynchronous and arrives by email, so there is deliberately nothing to
wait for — the AMO step learned that the hard way, reporting three successful releases as failures
until `--approval-timeout=0` stopped it blocking on a human reviewer.

Repository secrets:

| Secret | From |
| --- | --- |
| `CHROME_EXTENSION_ID` | the item's 32-character ID in the developer console |
| `CHROME_PUBLISHER_ID` | your developer account |
| `CHROME_CLIENT_ID`, `CHROME_CLIENT_SECRET`, `CHROME_REFRESH_TOKEN` | a Google Cloud OAuth client with the Chrome Web Store API enabled |

The `resubmit` workflow path submits an existing tag to both stores, for a release whose submission
failed after the GitHub release already existed.

## Checking a build in Chrome

```sh
npm run build
```

`chrome://extensions` → **Developer mode** → **Load unpacked** → the repository root. Then:

- the popup opens, income saves, and badges appear on `docs/amo/harness/se-shop.html`
- the **service worker** link on the extensions card opens its console; in it,
  `await browser.alarms.getAll()` should list the daily refresh alarm
- the language switch and the currency search both work

A service worker is killed after about 30 seconds idle, so seeing *inactive* on the card is normal,
not a fault. Load the same `manifest.json` as a temporary add-on in Firefox afterwards to confirm the
dual background key did not disturb the event page.
