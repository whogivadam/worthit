# Microsoft Edge Add-ons

How Worth It? reaches Edge, and the parts of it that are not automated.

Listing: <https://microsoftedge.microsoft.com/addons/detail/worth-it/mmjliacccebkkafagabhdjopffiocoma>

Edge is Chromium, so it runs the same code as Chrome: it takes `background.service_worker` the same
way, and `minimum_chrome_version` (148) is Edge's floor too, since Edge versions track Chromium's.
Everything in [docs/chrome/README.md](../chrome/README.md) about the `browser` namespace applies
unchanged.

**It does not take the same zip.** See below — this is the one way Edge differs, and it has cost two
releases.

## Edge needs background.scripts removed

`manifest.json` carries both background keys so one manifest serves every store:

```json
"background": {
  "scripts": ["lib/rates.js", "background/background.js"],
  "service_worker": "background/background.js"
}
```

Firefox MV3 runs the background as an event page and needs `scripts`. Chrome reads `service_worker`,
ignores `scripts` and merely warns about it (the `chrome://extensions` row in
[docs/chrome/README.md](../chrome/README.md)). Edge runs the same worker as Chrome but its
**package validator refuses the pair outright**:

```
Package Validation Errors:
The background.scripts field cannot be used with manifest version 3.
Use the background.service_worker field instead.  Line: 31 Column: 17
```

So Edge gets the released zip with `background.scripts` removed and nothing else changed. That is
safe because the background loads its own dependency when it runs as a worker:

```js
// background/background.js
if (typeof importScripts === 'function') importScripts('/lib/rates.js');
```

`scripts` exists for AMO alone. **Do not "tidy" it out of `manifest.json`** — the Firefox build needs
it, and only the Edge upload may differ. `scripts/lib/edge-package.mjs` is the one place that rule
lives; both `npm run edge:zip` and the automated submission go through it, so they cannot drift.
`npm run publish:edge` strips the key in memory, leaving the zip attached to the GitHub Release and
the one AMO signs untouched.

## The account

- Partner Center, **Microsoft Edge** program: <https://partner.microsoft.com/dashboard/microsoftedge/>
- Registration is free.
- The listing text and screenshots are edited in Partner Center only — the API cannot change them.

## The first submission is manual

The API updates an existing product; it cannot create one (the publish step fails with
`CreateNotAllowed`). The first version was submitted by hand in Partner Center. Every version after
it goes up from the `Release` workflow.

## Publishing from CI

`npm run publish:edge` runs `scripts/edge-publish.mjs` against v1.1 of the Edge Add-ons REST API.
No dependency, four requests:

1. `POST /v1/products/{product}/submissions/draft/package` — upload the zip
2. poll `.../draft/package/operations/{operation}` until it settles
3. `POST /v1/products/{product}/submissions` — submit for certification
4. poll `.../submissions/operations/{operation}` until it settles

It returns once the store accepts the submission. Certification is asynchronous and arrives by email,
so there is nothing to wait for after that — the same rule as AMO and Chrome.

The step runs in both the release job and the `resubmit` job, after AMO and Chrome, with
`continue-on-error`. A failure leaves a published release, AMO and Chrome untouched, and a job
summary that says what to do.

> **The run still goes green when this step fails.** `continue-on-error` reports the step's
> conclusion as success, so neither the step, the job nor the workflow turns red — the only signal is
> that the *Say that Edge needs finishing by hand* step ran at all, and its summary. v0.7.1 failed to
> reach Edge and reported success. Check the job summary after a release rather than the tick.
> Tracked in [#148](https://github.com/whogivadam/worthit/issues/148).

To retry Edge alone, use *Run workflow* with the tag and **edge** ticked, leaving **amo** and
**chrome** clear. Each store submits only when asked for, so a retry cannot disturb one that already
accepted the version — which matters because AMO refuses a version it has already signed, and
re-submitting anywhere resets review state. Ticking nothing fails the run rather than building for
no reason.

Repository secrets, all from Partner Center:

| Secret | What | Where |
| --- | --- | --- |
| `EDGE_PRODUCT_ID` | The product ID, a GUID | the extension's **Overview** page, *Extension identity* (also in the address bar between `microsoftedge/` and `/packages`). **Not** the store ID `mmjliacc…` in the public listing URL. |
| `EDGE_CLIENT_ID` | The API client ID, **a GUID** | **Microsoft Edge → Publish API** |
| `EDGE_API_KEY` | An API key | **Microsoft Edge → Publish API** |

## The API key expires

Each key on the **Publish API** page has an **Expiry** date. Once it passes, every call returns
`401` and the step fails with:

```
edge-publish: upload: 401 -- the API key is missing, expired or invalid.
```

To renew:

1. Partner Center → **Microsoft Edge** → **Publish API** → create a new API key, and copy it.
2. `gh secret set EDGE_API_KEY --repo whogivadam/worthit` and paste it.
3. Re-submit the release that failed: **Actions** → **Release** → *Run workflow*, with its tag and
   **edge** ticked. Or upload by hand — see [Uploading by hand](#uploading-by-hand).

Check the expiry date before a release rather than after one. **The current key expires on
3 February 2027**; update this line when you renew it.

## When the step fails

The log names the cause. The ones worth knowing:

| Message | Cause | Fix |
| --- | --- | --- |
| `EDGE_CLIENT_ID is not a GUID` | the secret holds something that is not a GUID — an API key, or the store ID `mmjliacc…` | copy the client ID from **Publish API**, then `gh secret set EDGE_CLIENT_ID` |
| `EDGE_PRODUCT_ID is not a GUID` | same, for the product ID | copy it from the **Overview** page |
| `401 -- the API key is missing, expired or invalid` | expired or wrong `EDGE_API_KEY` | renew the key, above |
| `400 … The value of X-ClientID must be a valid GUID` | a non-GUID `EDGE_CLIENT_ID` reached the store | as the first row; the local check above now catches this first |
| `400 … Package Validation Errors` / `background.scripts … cannot be used` | the zip still carries `background.scripts` — a Chrome or AMO zip was uploaded | use `npm run edge:zip`, above |
| `404 -- EDGE_PRODUCT_ID is wrong` | wrong product ID, or it belongs to another account | copy it from the Overview page |
| `InProgressSubmission` | the previous version is still in certification | wait for it to clear, then re-submit the tag |
| `NoModulesUpdated` | the zip is identical to the one already submitted | nothing to do |
| `still in progress after 300s` | the store is slow to process the upload | check Partner Center; re-submit if nothing arrived |

## Uploading by hand

To finish a failed release by hand, build the Edge package for the tag and upload it in Partner
Center (extension → **Packages** → replace, then **Publish**):

```sh
npm run edge:zip v0.8.0
# -> web-ext-artifacts/worth_it_-0.8.0-edge.zip
```

That downloads the zip CI attached to the tag, removes `background.scripts`, checks the result
against the zip it came from, and prints the path.

**Use `edge:zip`, not `chrome:zip`.** They are not the same artifact: Partner Center rejects the
Chrome zip with the validation error above. Never upload a zip built from the working tree either —
see [Uploading the zip by hand](../chrome/README.md#uploading-the-zip-by-hand) for why.

## Checking a build in Edge

`edge://extensions` → **Developer mode** → **Load unpacked** → the repository root. Then the same
checks as for Chrome: the popup opens, income saves, badges appear on
`docs/amo/harness/se-shop.html`, and `await browser.alarms.getAll()` in the service worker console
lists the daily refresh alarm.
