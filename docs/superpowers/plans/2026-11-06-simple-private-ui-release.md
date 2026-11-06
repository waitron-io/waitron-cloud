# Proposed simple private UI release plan

**Status: Proposed, awaiting owner approval.** PR1018 is cancelled and plan1008 is rejected. No implementation or publication is authorised before approval.

## 1. Publish current Waitron source

Lane F/A1336 owns all Waitron implementation. A merge to Waitron main that changes `packages/ui-core` triggers publication of a new **private** `@waitron-io/ui-core` version to `npm.pkg.github.com`.

Publish the current merged source, replacing the September `0.1.0` baseline. Use `0.2.<workflow run number>` as the automatic release version, with serial publishing. Assign the release version during publication without source-version commits. Waitron keeps `workspace:*` and does not consume the published package.

The owner supplies a classic PAT with `write:packages` and actual authority over the `waitron-io` package, stored as the Waitron Actions secret `UI_PACKAGES_WRITE_TOKEN`, exposed only to publication. [GitHub requires the token’s package permissions as well as its scope](https://docs.github.com/en/packages/learn-github-packages/about-permissions-for-github-packages).

Keep ordinary source package checks, built exports, Elastic License 2.0 and `LICENSE-GRANTS.md`. A failed publication remains a failed workflow; the next qualifying merge publishes a new version. Add no scheduled publisher, Cloud polling, catch-up, ledger, input fingerprints, reservations or recovery.

**Accepted risk:** Token theft or expiry can compromise or interrupt publication, and a failed publish may be missed until the next qualifying merge.

## 2. Open automatic Cloud dependency PRs

Configure daily authenticated Dependabot updates for `apps/portal`, `packages/ui-smoke` and the lockfile. Updates open PRs that run normal CI and require review, with no automerge.

Grant Cloud Read access in the package’s Manage Actions access settings. [Dependabot can use that grant](https://docs.github.com/en/code-security/concepts/supply-chain-security/automatic-dependabot-access-to-github-registries) without another registry token. Existing Cloud `.npmrc`, `NODE_AUTH_TOKEN` and BuildKit credentials remain.

**Accepted risk:** Daily checks may combine releases into one update, and a published version may be incompatible with the portal.

## 3. Enforce the seven-day update window in Cloud CI

For each installed UI package version, find the first stable version published after it by version order and publication time: use the earliest publication timestamp among stable versions newer than the installed version. Fail CI when more than seven days have elapsed from that publication.

An installed version with no newer stable publication is current, regardless of its age. Missing versions, missing required publication timestamps or registry lookup errors fail CI. Use existing CI runs; add no monitoring schedule.

**Accepted risk:** Enforcement depends on registry availability and only happens when CI runs.

## 4. Remove superseded machinery and verify behavior

After approval, delete obsolete Cloud files:

- `.github/workflows/ui-release.yml` and `scripts/release/ui-source.json`.
- PR978 `ui-ledger.mjs`, `ui-ledger-git.mjs` and their owning tests.
- PR995 ledger-only preparation paths in `prepare-ui.mjs` and `ui-manifest.mjs`, plus owning tests, once F replaces preparation.
- PR1001 `record-ui-artifact.mjs`, `ui-artifact.mjs` and owning tests.

Retain useful ordinary package and license checks in Waitron. Update incoming links before deleting `docs/shared-ui-release-ledger.md` and superseded plans `2026-11-05-public-ui-registry.md` and `2026-11-06-ui-build-evidence.md`. Renew ordinary root/docs records during code removal.

Verify qualifying versus unrelated merges, private publication and increasing versions, failed-publication behavior, authenticated update PRs, and CI cases covering current idle versions, multiple newer releases, the seven-day boundary, missing metadata and registry failures.

**Awaiting owner approval.**
