# Release the shared UI package

Cloud installs the private `@waitron-io/ui-core` package from GitHub Packages.
You develop and publish it from Waitron. The
[approved release plan](superpowers/plans/2026-11-06-simple-private-ui-release.md)
keeps publication there and dependency updates here.

## Review automatic dependency updates

Cloud's [Dependabot configuration](../.github/dependabot.yml) checks
`@waitron-io/ui-core` every day at 06:00 UTC, including weekends. The root
pnpm workspace contains `apps/portal`, `packages/ui-smoke` and their shared
lockfile, so one update can keep both consumers on the same release.

Dependabot uses Cloud's existing package access grant through Manage Actions
access. [GitHub supplies registry authentication from that grant](https://docs.github.com/en/code-security/concepts/supply-chain-security/automatic-dependabot-access-to-github-registries).
You do not need another registry token. Normal Cloud installs still use the
existing authenticated setup below. Image builds still pass `NODE_AUTH_TOKEN`
as the BuildKit `npm_token` secret; follow the existing
[local image build instructions](local-deployment.md).

Expect an unedited version-update PR to fail CI because its smoke-test
expectations still describe the previous release.
Before merging:

1. Verify the published version and its `waitronSource.commit`.
2. Confirm that `apps/portal/package.json`, `packages/ui-smoke/package.json`
   and both lockfile entries use the same release. The smoke test checks only
   its own package's pin.
3. Update the smoke test's version and source expectations while retaining
   its assertions and browser checks.
4. Update the reviewed tarball URL and integrity in
   `scripts/disposable-tests/private-packages.py` and the host’s accepted SHA512
   digests in `deploy/disposable-tests/session.py`. Keep older approved tarballs
   needed by historical checkouts. The helper selects the package from the
   captured lockfile, so it needs no version-specific filename change. Update
   the guest proof’s input filename. The disposable package checks must cover
   the current lockfile and run each approved digest through host transfer.
5. Review the changed dependencies and their actual test owners using the
   [root ownership](ci-root-input-ownership.md) and
   [documentation selection](ci-documentation-audit.md) guides.
6. Push the reviewed changes and wait for normal CI on that final commit.

The configuration does not merge PRs automatically. Its [first hosted check](https://github.com/waitron-io/waitron-cloud/actions/runs/42295633741)
authenticated to the private registry and found only `0.1.0`, so it opened no
update PR. The first newer-version automatic PR remains unproved. The current consumer
update was prepared manually using the same review steps.

## Keep Cloud within seven days of a release

When your checked-out branch contains `scripts/ci-ui-lag.mjs`, normal CI
checks both consumers' exact package pins against the
GitHub package versions API before selecting tests. Its version creation dates
supply publication times, which [GitHub omits from npm metadata](https://github.blog/changelog/2021-03-05-packages-time-has-been-dropped-from-npm-package-metadata-responses/). You can run the same check locally
with an existing package-read token in `NODE_AUTH_TOKEN`:

```sh
node scripts/ci-ui-lag.mjs
```

An old current version does not expire. Once a newer stable version exists,
you have seven days from its earliest publication to update. Later releases
do not restart that window, and prereleases do not start one. Exactly seven
days still passes; the next millisecond fails CI.

A registry error or missing version metadata warns and passes, so an outage
leaves the deadline unchecked. A known overdue publication still fails even
if another publication's timestamp is missing. The check runs during ordinary
CI, with no new schedule. Older pull request branches that lack the script
print a skip message so they can still reach test selection.
The [older-head rehearsal](https://github.com/waitron-io/waitron-cloud/actions/runs/42324680039)
printed that notice and completed planning. Its [temporary PR](https://github.com/waitron-io/waitron-cloud/pull/1046)
was closed without merging; the remaining general and AWS jobs were stopped
after that compatibility check, so it does not prove complete CI.

## Publish from Waitron

Waitron owns [release preparation](https://github.com/clintongormley/waitron/blob/main/docs/developers/shared-ui-preparation.md).
Its merged [publisher PR](https://github.com/clintongormley/waitron/pull/2526) adds
private publication on merges that change `packages/ui-core`, using
`0.2.<workflow run number>` and recording the merged source commit in
`waitronSource.commit`. The first [hosted publication](https://github.com/clintongormley/waitron/actions/runs/42376444927)
published private version `0.2.1` from merged source
`47dda656b641794051c64d3752937ea7f2929f51`.

The package keeps Elastic License 2.0 and `LICENSE-GRANTS.md`. Cloud keeps its
existing package access and authenticated install and image build paths.

## Prepare private signing packages for disposable tests

The signing package is published from Waitron as `@waitron-io/contract`. Cloud's
disposable-test adapter recognizes reviewed `0.2.9` bytes alongside the UI package;
this support change does not yet add the application dependency. UI-only captured
checkouts continue to select their own approved release.

For a future contract release, update its reviewed URL and full SHA512 integrity in
`scripts/disposable-tests/private-packages.py` and its filename-to-digest entry in
`deploy/disposable-tests/session.py`. Keep approved historical releases. Publish a
matched controller and host recipe through the existing installer before adopting
the new application pin. Follow the [private package and proof instructions](../deploy/disposable-tests/README.md).
The installed guest-tools, local-runtime and cancellation proofs still have to run
on the published support before Cloud adopts `0.2.9`.

## Install locally

Use pnpm 9.15.0 and authenticate GitHub CLI with package-read permission:

```sh
gh auth refresh --hostname github.com --scopes read:packages
```

A pnpm token helper can read that login without copying its token into the repository
or another credential file. Create an executable at a stable local path:

```sh
mkdir -p "$HOME/.config/waitron"
cat > "$HOME/.config/waitron/github-package-token" <<'SH'
#!/bin/sh
exec gh auth token --hostname github.com
SH
chmod 700 "$HOME/.config/waitron/github-package-token"
```

Add this entry to your **user** `~/.npmrc`, replacing the example with your absolute
home path. Keep any unrelated settings. If you already configured GitHub registry
authentication, use that configuration instead of adding a competing credential.

```ini
//npm.pkg.github.com/:tokenHelper=/Users/your-name/.config/waitron/github-package-token
```

The project registry mapping routes only `@waitron-io` packages to GitHub. Other
packages continue to use the normal npm registry. CI uses `actions/setup-node` with
`NODE_AUTH_TOKEN` supplied only to the installation step, plus package-read permission.
It does not need your personal credential.

## Verify the consumer

Cloud pins `@waitron-io/ui-core@0.2.1` and Lit `3.3.3` in `apps/portal`,
`packages/ui-smoke` and the workspace lockfile. Install from that lockfile,
then run:

```sh
pnpm --filter @waitron-cloud/ui-smoke exec playwright install chromium
pnpm test:ui
pnpm typecheck
```

The test checks the exact dependency version and recorded Waitron source, bundles
from installed JavaScript, renders controls in Chromium and verifies input names,
autocomplete, button interaction and light/dark tokens. Its declaration check keeps
`skipLibCheck` disabled. A local file dependency fails the version check. The normal
`pnpm test` includes this fixture; it is test infrastructure, not an account screen.

Version `0.2.1` records Waitron source
`47dda656b641794051c64d3752937ea7f2929f51`. Its installed `dist/LICENSE` and
`dist/LICENSE-GRANTS.md` match that source commit byte for byte. The source
package's own version remains `0.1.0`; publication assigns the registry version
without changing the source manifest. Local qualification used the GitHub CLI
token helper, the smoke browser and declaration checks, `pnpm typecheck`, and the
portal's four English/Spanish, light/dark accessibility cases. Screens were also
inspected at 390 and 1280 pixels. CI must install with its own temporary
package-read token.

Use the [automatic update review steps](#review-automatic-dependency-updates)
when Dependabot opens an upgrade PR. If you prepare an update manually, keep
both consumers and the lockfile on the same verified release and follow those
same review steps.

References: [GitHub's npm registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry),
[package access](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility),
and [pnpm token helpers](https://pnpm.io/npmrc#urltokenhelper).
