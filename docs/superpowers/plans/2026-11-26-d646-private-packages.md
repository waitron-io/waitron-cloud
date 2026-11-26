# D646 · Adopt Waitron UI Core and Contract 0.2.55

Cloud's portal, UI smoke fixture and registration service can install the reviewed
0.2.55 packages from one lockfile, including inside a disposable CI guest.
Use one pull request because both upgrades need the same runner support and
publication window. The [release guide](../../shared-ui-release.md) owns the procedure.
Claude reviewed the plan for the original 0.2.46 pair. On 26 November the watcher
cleared the plan with the newer pair and one whole-branch review.

## Pin the published releases

- Verify the archives against the registry SHA512 digests and the manifests against
  [Waitron publication run 45807265421](https://github.com/clintongormley/waitron/actions/runs/45807265421)
  at `eaba6448d0373d64f110bd8b7c614c57cbd05cc0`. Compare their contents with 0.2.45,
  including the shared signing code and UI controls. Keep Lit at 3.3.3.
- Update `apps/portal/package.json`, `packages/ui-smoke/package.json`,
  `packages/registration/package.json` and `pnpm-lock.yaml`. Add both archive pins
  to `scripts/disposable-tests/private-packages.py` and their digests to
  `deploy/disposable-tests/session.py`. Keep the historical pins, exact digest
  checks and the `ui.tgz` transfer name.
- In `scripts/disposable-tests/dependencies.test.mjs`, check the current and
  repeated contract pins, the historical 0.2.45 pair and refusal of mixed releases.
  Update the expected publication source in `packages/ui-smoke/test.mjs` and all
  three archive references in `deploy/disposable-tests/guest-tools.test.py`.
  Keep the existing browser checks and verify the portal in English and Spanish,
  light and dark, at 390 and 1280 pixels because the published controls change.
- Run the selection and host transfer tests, the Chromium smoke case, the portal
  accessibility tests and `pnpm typecheck`. CI runs the registration wire and
  trust tests. Expect about 25 edited package and runner lines and 10 to 15 edited
  test lines. Update `docs/shared-ui-release.md` and the shared package backlog
  pointers after checking the licences and the 0.2.45 translation abandon credit.

## Qualify the runner and land

Coordinate with Lane I to install the matching controller and host release. Read
back both installed pins and run the guest-tools, local-runtime and cancellation
proofs with the adoption capture. The [operator guide](../../../deploy/disposable-tests/README.md#run-the-controller-from-the-ci-server)
sets the order. Keep 0.2.46 as the watcher-cleared fallback only if 0.2.55 cannot
qualify before 29 November 18:59 UTC. That fallback needs a second update booked
in the same operator discussion, by 30 November 16:11 UTC.

After the whole-branch Claude review and runner proofs, push the signed commits.
List changed test checks in the PR and verify current-head CI before landing.
Preserve sign-off on the squash commit, verify exact-merge CI, then close #1429
and #1428 with a link to the replacement.
