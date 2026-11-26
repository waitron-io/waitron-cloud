# D646 · Adopt the two Waitron packages at 0.2.46

Cloud's portal, UI smoke fixture and registration service can install the reviewed
0.2.46 packages from one lockfile, including inside a disposable CI guest.
Use one pull request because both upgrades need the same runner support and
publication window. The [release guide](../../shared-ui-release.md) owns the procedure.

## Pin the published releases

- Both archives match the SHA512 digests in #1429 and #1428 and name Waitron
  source `42945494674d75787f28fa0110e38cd913636a3f`. The only changed files inside
  either archive are its README and manifest. The shipped JavaScript, declarations
  and licence files match 0.2.45. Waitron published these packages from #4070,
  which updates the UI test tools axe-core and Playwright. GitHub lists no separate
  release notes for either package. The shared signing code is byte-identical.
  [Source PR #4070](https://github.com/clintongormley/waitron/pull/4070) ·
  [Publication run](https://github.com/clintongormley/waitron/actions/runs/45058107117)
- Use the bot pins in `apps/portal/package.json`, `packages/ui-smoke/package.json`,
  `packages/registration/package.json` and `pnpm-lock.yaml`. Keep Lit at 3.3.3.
  Add both verified archives to `scripts/disposable-tests/private-packages.py`
  and the corresponding digests to `deploy/disposable-tests/session.py`.
  Keep all historical pins, the exact digest checks and the `ui.tgz` transfer name.
- The root job failed two cases on each bot head in
  `scripts/disposable-tests/dependencies.test.mjs`. Both heads lack runner pins.
  The contract fixture on #1428 still expects 0.2.45. Make the current and repeated
  contract cases accept 0.2.46. Keep historical selection of the full 0.2.45 pair
  and refuse a capture with both versions of either package. Keep existing refusal cases.
- The UI smoke job on #1429 also failed the source assertion in `packages/ui-smoke/test.mjs`.
  Set its expected source to the verified commit and keep the browser assertions.
  Point all three archive references in `deploy/disposable-tests/guest-tools.test.py`
  at the new versions. Each PR's summary reported its failed jobs.
- Re-run the selection file, `python3 -B deploy/disposable-tests/session.test.py`,
  the Chromium UI smoke case and `pnpm typecheck`. CI runs registration's wire
  vectors and Cloud trust checks with the new pin.
- Expect about 25 edited package, lockfile and runner lines and 10 to 15 test lines.
  In `docs/shared-ui-release.md`, update the pins and publication source, verify
  licences against that source, and credit the translation abandon action to 0.2.45.
  Update the release pointer in `docs/backlog/shared-ui.md`.

## Qualify the runner and land

The CI lag check allows 0.2.45 through 29 November 18:59:52 UTC and 0.2.46 through
30 November 16:11:38 UTC. If the operator window threatens the planned update,
take the registry dates and the remaining CI work to the watcher. Run both Claude
whole-branch reviews for the package boundary. Coordinate the existing installer
with the watcher and Lane I's operator. Use a capture of this adoption and both
verified archives for installed pin readback and the three proofs in the
[disposable runner guide](../../../deploy/disposable-tests/README.md#run-the-controller-from-the-ci-server).
Sign off each Lane J commit with `git commit -s`. List changed test checks in the
pull request and verify current-head CI before landing. Preserve sign-off on the
squash commit, read back exact-merge CI and link #1429 and #1428 to the replacement.
