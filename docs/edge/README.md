# Microsoft Edge Add-ons

How Worth It? reaches Edge, and the parts of it that are not automated.

Listing: <https://microsoftedge.microsoft.com/addons/detail/worth-it/mmjliacccebkkafagabhdjopffiocoma>

Edge is Chromium, so it installs the same zip as Chrome and Firefox: `manifest.json` serves all
three, Edge takes `background.service_worker` exactly as Chrome does, and `minimum_chrome_version`
(148) is Edge's floor too, since Edge versions track Chromium's. Everything in
[docs/chrome/README.md](../chrome/README.md) about the dual background key and the `browser`
namespace applies unchanged.

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

Repository secrets, all from Partner Center:

| Secret | What | Where |
| --- | --- | --- |
| `EDGE_PRODUCT_ID` | The product ID, a GUID | the extension's **Overview** page, *Extension identity* (also in the address bar between `microsoftedge/` and `/packages`). **Not** the store ID `mmjliacc…` in the public listing URL. |
| `EDGE_CLIENT_ID` | The API client ID | **Microsoft Edge → Publish API** |
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
3. Re-submit the release that failed: **Actions** → **Release** → *Run workflow*, with its tag.

Check the expiry date before a release rather than after one.

## When the step fails

The log names the cause. The ones worth knowing:

| Message | Cause | Fix |
| --- | --- | --- |
| `401 -- the API key is missing, expired or invalid` | expired or wrong `EDGE_API_KEY`, or wrong `EDGE_CLIENT_ID` | renew the key, above |
| `404 -- EDGE_PRODUCT_ID is wrong` | wrong product ID, or it belongs to another account | copy it from the Overview page |
| `InProgressSubmission` | the previous version is still in certification | wait for it to clear, then re-submit the tag |
| `NoModulesUpdated` | the zip is identical to the one already submitted | nothing to do |
| `still in progress after 300s` | the store is slow to process the upload | check Partner Center; re-submit if nothing arrived |

To finish a failed release by hand instead, fetch the zip CI built for the tag and upload it in
Partner Center (extension → **Packages** → replace, then **Publish**):

```sh
npm run chrome:zip v0.8.0
# -> web-ext-artifacts/worth_it_-0.8.0.zip
```

The command is named for Chrome but only downloads the tag's release zip and checks it; the same
bytes go to every store. Never upload a zip built from the working tree — see
[Uploading the zip by hand](../chrome/README.md#uploading-the-zip-by-hand) for why.

## Checking a build in Edge

`edge://extensions` → **Developer mode** → **Load unpacked** → the repository root. Then the same
checks as for Chrome: the popup opens, income saves, badges appear on
`docs/amo/harness/se-shop.html`, and `await browser.alarms.getAll()` in the service worker console
lists the daily refresh alarm.
