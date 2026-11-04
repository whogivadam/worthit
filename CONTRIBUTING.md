# Contributing

Thanks for looking. This repository runs a strict, small workflow: every change is tracked by an
issue, lands through a pull request, and is squash-merged into `main`.

## Ground rules

1. **Every task gets an issue before any code is written.** Use one of the issue forms; blank
   issues are disabled.
2. **One issue per pull request.**
3. `main` is protected: no direct pushes, a pull request is required, CI must pass, and history is
   linear. The single bootstrap commit was the only direct push to `main` and will stay that way.
4. No new network calls beyond the exchange-rate fetch, and no new stored user data. See
   [PRIVACY.md](PRIVACY.md) — `scripts/check-privacy.mjs` enforces this in CI.

## Development

```sh
npm install          # also installs the husky hooks
npm test             # Node's built-in test runner, no browser needed
npm run lint         # eslint
npx web-ext lint     # extension-specific linting
npm run build        # produces web-ext-artifacts/*.zip
npm run check-zip    # asserts the zip holds only runtime files
```

Load the extension while developing:

- *Firefox*: open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and
  pick `manifest.json` in the repository root.
- *Chrome*: open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and
  pick the repository root.

One `manifest.json` serves both browsers; see [docs/chrome/README.md](docs/chrome/README.md) for how
and for the warning each browser shows about the other's background key.

There is no bundler, minifier or transpiler, and there must not be one: the extension ships its
source exactly as written, which is also why AMO needs no separate source-code submission. Files in
`lib/` are therefore classic scripts with a CommonJS export tail, so the same file runs in the
browser and is `require()`d by the test suite.

## Commits

Conventional Commits v1.0.0, enforced by commitlint through the `commit-msg` hook.

```
type(scope): imperative summary
```

- the header is at most 72 characters
- the scope is required
- a breaking change uses `type(scope)!:` and adds a `BREAKING CHANGE:` footer
- every commit references its issue in the footer: `Refs #12` or `Closes #12`

**Types** — `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`,
`revert`. Nothing else.

**Scopes** — `popup`, `overlay`, `parser`, `rates`, `background`, `calc`, `manifest`, `tests`,
`ci`, `deps`, `release`, `repo`. Nothing else. `repo` means repository meta: README, CONTRIBUTING,
SECURITY, PRIVACY, LICENSE, templates, editor/lint/commit configs.

Example:

```
feat(rates): add Frankfurter fallback

Falls back to the ECB feed when the primary provider fails, merging it over
the cached set so currencies it does not carry are kept.

Closes #12
```

## Issues

- the title uses the commit convention too: `feat(rates): add Frankfurter fallback`
- labels: `type:*` mirroring the commit types, `scope:*` mirroring the scopes, and
  `priority:p1`/`p2`/`p3`
- every issue carries acceptance criteria

## Branches and pull requests

- branch name: `type/issue-number-short-slug`, e.g. `feat/12-rate-fallback`
- the pull request title follows the commit convention and is linted in CI, because **the PR title
  becomes the commit on `main`** — squash merge is the only merge method enabled
- fill in the PR template: linked issue, what changed, how tested, and screenshots for any popup or
  overlay change

## Hooks

- `commit-msg` runs commitlint
- `pre-commit` runs eslint on staged files and the full test suite

Please do not bypass them with `--no-verify`.

## Releases

Releases are automated with release-please and driven by commit types: `fix` bumps the patch,
`feat` bumps the minor, a breaking change bumps the major. The project stays on `0.x` until it is
stable.

release-please keeps a release pull request open, writes `CHANGELOG.md` (never edit it by hand) and
bumps the version in both `package.json` and `manifest.json`. Merging that pull request tags the
release, attaches the unsigned zip to the GitHub Release and submits the same zip to AMO and to the
Chrome Web Store for review. Store credentials live only in GitHub Actions secrets —
`AMO_JWT_ISSUER` and `AMO_JWT_SECRET` for AMO, the five `CHROME_*` secrets listed in
[docs/chrome/README.md](docs/chrome/README.md) for Chrome — and must never appear in the repository.

The release pull request is created with `GITHUB_TOKEN`, which cannot trigger workflows, so no
checks ever report on it and branch protection shows it as blocked. Merge it with
`gh pr merge <n> --squash --admin`. The build is still verified: the release job runs the tests,
the build and both guards before it signs.

**If the AMO submission fails** -- bad credentials, an AMO outage -- the release itself is already
published, and re-running the job will not help: release-please runs first, sees the release, and
every later step is skipped. Use the **Release** workflow's *Run workflow* button instead and give
it the existing tag. That path re-runs the tests, the build and both guards against that tag, checks
the tag matches the version it carries, and submits to both stores again.

**The Chrome submission is non-blocking.** It runs last with `continue-on-error`, so a failure
there — usually an expired refresh token or a previous version still in review — leaves a published
release and a zip to upload by hand with `npm run chrome:zip`. See
[docs/chrome/README.md](docs/chrome/README.md).
