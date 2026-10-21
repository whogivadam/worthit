# Privacy

**Worth It? collects nothing. No user data is stored or shared anywhere but locally, on your own
machine.**

## What is stored, and where

Everything the extension knows lives in `browser.storage.local`, on your computer only:

- your income (monthly after-tax salary or hourly after-tax rate) and hours worked per week
- your home currency and whether the overlay is on
- your per-site settings ("disable on this site", "force currency on this site")
- your last 20 manual checks, so the popup can show a history and a running total

`browser.storage.sync` is never used and the `sync` permission is never requested, so none of this
is uploaded to a Mozilla account or synced between your devices. The history is capped at 20 entries
and you can clear it from the popup at any time. Uninstalling the extension removes all of it.

## The only network request

The extension makes exactly one kind of outbound request: fetching published exchange rates, so a
price in another currency can be converted to yours.

- `https://open.er-api.com/v6/latest/USD` (primary, via ExchangeRate-API)
- `https://api.frankfurter.app/latest?from=USD` (fallback, European Central Bank data; this host
  redirects to `https://api.frankfurter.dev`, which is why both hosts are declared in the manifest)

These requests ask for one thing — the current rate table with USD as the base — and carry nothing
else. No price you look at or type in, no income, no hourly rate, no page URL, no hostname, no
locale, no identifier, no cookies and no custom headers are sent. The request is identical for
every user of the extension.

The fetch runs on a 24-hour `alarms` timer from the background script, plus once on install, once on
browser start, and whenever you press **Refresh rates**. It is never triggered by a price being
detected on a page or checked in the popup, so not even the timing of these requests reveals
anything about what you browse or price. If the network is unavailable, a bundled offline rate
snapshot is used instead.

## What the extension never does

No analytics, no telemetry, no crash or error reporting, no remote configuration, no tracking
pixels, no `sendBeacon`, no WebSockets, no third-party scripts, fonts or CDNs. All code and styling
ship inside the extension. This is enforced in continuous integration by
`scripts/check-privacy.mjs`, which fails the build if any of it appears in the shipped files.

## Permissions, and why

- `storage` — to save your settings and history locally
- `alarms` — to refresh exchange rates once a day
- `activeTab` — to read the hostname of the tab you have the popup open on, so per-site settings
  can be applied. The `tabs` permission is deliberately **not** requested, so the extension cannot
  see your tabs or browsing history.
- content script on all sites — prices appear on any shop, so the price detector has to be able to
  run anywhere. It reads page text locally to find prices and sends nothing anywhere.

The manifest declares `data_collection_permissions: { required: ["none"] }`, Firefox's formal
declaration that this add-on collects no data.

## Contact

Questions about privacy: <worthit-ext@proton.me>
