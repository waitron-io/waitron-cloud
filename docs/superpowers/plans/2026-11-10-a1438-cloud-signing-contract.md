# A1438-1c: Cloud signing contract plan

**Request**, verbatim from `~/waitron-campaign-g/queue.md`, A1438-1c:
“plan docs/superpowers/plans/2026-11-09-a1438-code-shared-with-cloud.md (Waitron repo) §3a and §4: Cloud installs the pinned package, replaces its own copies of the three signing formats (packages/registration/src/pairing-proof.ts, installation-proof.ts, the access lease) with it, deletes its copies of the three shared test files, and adds the package to Dependabot. No behaviour change: the shared test files already pin both sides.”

**Authority and prerequisite.** The owner allowed adoption on 9 November at 19:57, not this technical plan. Driver-supplied evidence: publisher PR #2748 merged `ae8d1bb9c948539a93e1bc0940db2a1a73054ffa`; `@waitron-io/contract@0.2.9` published 10 November at 15:49:22Z; artifact SHA512 checked. Read-only inspection: artifact `package.json:5–9` allows root exports only. No runtime qualification here.

**Outcome and budget.** One Cloud PR, estimated two active hours; stop at three active hours and tell the watcher. Install exact registry version `0.2.9`, never a source checkout. Reuse existing imports and registry authentication. Preserve wire values, actions, body bytes, key storage, trust acceptance, limits, timeouts, routes, database and refusals. Exclude new protocols, Waitron changes, sign-in-rule adoption, locations, migrations, UI, fiscal work and provider calls.

## Files and ownership

`R` means `packages/registration`. No new production, test, support or configuration files; no whole-file deletions.

- **Production:** modify `R/src/pairing-proof.ts` and `R/src/installation-proof.ts`. Delete shared format implementations; re-export the published root's signing functions, error classes and associated types. Keep `isPairingUuid`, `createLeaseTrust` and its existing key parsing locally, including their acceptance/refusal behaviour (`installation-proof.ts:13–20,69–78`). Neither helper is publicly exported upstream. No private-path imports. Leave `R/src/index.ts:286,289` and consumers unchanged; identical classes preserve `instanceof` handling in `packages/account-http/src/app.ts:69–70` and billing callers.
- **Tests:** modify `R/test/pairing-proof.test.ts`, `installation-proof.test.ts` and `billing-display-proof.test.ts`. Keep fixed-vector assertions and JSON fixtures, operator trust configuration checks, billing projection export assertion and every unmatched security assertion in place. Remove only duplicated checks mapped to Waitron's `packages/contract/src/signing/{pairing-proof,installation-proof,access-lease}.test.ts`. Upstream owns shared format rejection, binding, clock and size rules; these are not identical copies. Driver/watcher settle partial-file retention against the queue's deletion wording before implementation. List every removed/changed assertion and its retained owner under **Changed test checks** in the PR.
- **Support:** no additions or deletions. `scripts/ci-run-registration-shard.mjs:18` discovers test filenames; `rg` found no textual references to these three filenames in `scripts/` or `.github/`. No shard or required-case changes.
- **Configuration:** add the exact dependency in `R/package.json`, regenerate `pnpm-lock.yaml`, and add its allow-list entry in `.github/dependabot.yml`; reuse the daily schedule. No lag machinery or authentication changes.
- **Documentation:** briefly update `R/README.md` under Signed pairing, `docs/backlog.md`'s venue-registration entry and `docs/backlog/venue-registration.md`; link existing installation guidance in `docs/shared-ui-release.md`. Add only this plan; remove stale ownership wording, not production caveats.

**Expected additions/deletions:** production +15/−105; tests +35/−125; support 0/0; configuration +12/−0; documentation including this page +52/−4: about 350 changed lines. Stop for watcher opinion past 525 changed lines.

## Build and verify after clearance

- [ ] Install the pin, then add `Cloud signing exports use installed contract identities` in `R/test/installation-proof.test.ts`: compare both local modules and Cloud's public functions/classes with installed exports by strict identity; invalid proofs retain those error identities. Observe identity failures against old implementations, then add re-exports and observe green. Preserve vectors and trust-map checks.
- [ ] Run `pnpm --dir packages/registration exec node --test test/pairing-proof.test.ts test/installation-proof.test.ts test/billing-display-proof.test.ts`. Then use:

```sh
~/waitron-campaign-shared/test-box-run.sh G <checkout> node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/pairing.test.ts test/installations.test.ts test/billing-display-machine.test.ts
```

Only exit 75 permits `mac-docker-run.sh` fallback. Existing `packages/account-http/test/{pairing,installations,billing-display}.test.ts` own HTTP responses; run them through the same database wrapper with that package directory. Read test counts. CI owns full package suites and workspace typechecking; no local whole-package runs. Require current-head Cloud CI installation using its own `GITHUB_TOKEN` to qualify private cross-repository access.

**Handoff.** The driver commits this page, obtains one Claude plan read, incorporates findings and obtains watcher clearance. Later `finish-branch` requires two Claude run-it angles (cross-repository contract; sign-in/permissions), one fixes read, every current-head CI job green, and locked landing.
