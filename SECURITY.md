# Security policy

## Supported versions

The latest version published on addons.mozilla.org and on the Chrome Web Store is the only supported
version. Chrome can trail by a version while a store review is pending. Fixes ship as new releases;
please update before reporting.

## Reporting a vulnerability

Please report security issues privately to <worthit-ext@proton.me>. Do not open a public issue for a
vulnerability.

Include where you can:

- what the issue is and why it matters
- the steps or the page needed to reproduce it
- the extension version, and your browser and its version

You can expect an acknowledgement within 7 days. If the report is confirmed, a fix will be released
to both stores and credited in `CHANGELOG.md` unless you would rather stay anonymous.

## Scope

In scope: the extension's own code — the content script, the background script (an event page in
Firefox, a service worker in Chrome), the popup, the price parser and the exchange-rate handling.

Out of scope: vulnerabilities in Firefox or Chrome themselves, in `addons.mozilla.org` or the Chrome
Web Store, or in the upstream rate providers (`open.er-api.com`, `api.frankfurter.app`,
`api.frankfurter.dev`). Those belong to their respective vendors.

Note that the extension collects no data and makes no network requests other than fetching public
exchange rates with a fixed, user-independent query; see [PRIVACY.md](PRIVACY.md).
