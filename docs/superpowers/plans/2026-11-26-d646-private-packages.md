# D646 · Adopt the two Waitron packages at 0.2.46

Cloud's portal, UI smoke fixture and registration service can install the reviewed
0.2.46 packages from one lockfile, including inside a disposable CI guest.
Use one pull request because both upgrades need the same runner support and
publication window. The [release guide](../../shared-ui-release.md) owns the procedure.

## Pin the published releases

- Both archives match the SHA512 digests in #1429 and #1428 and name Waitron
  source `42945494674d75787f28fa0110e38cd913636a3f`. The only changed files inside
  either archive are its README and manifest. The shipped JavaScript, declarations
  and licence files match 0.2.45. Waitron changed two UI test dependencies.
  [Source PR #4070](https://github.com/clintongormley/waitron/pull/4070) ·
  [Publication run](https://github.com/clintongormley/waitron/actions/runs/45058107117)
- Use the bot pins in `apps/portal/package.json`, `packages/ui-smoke/package.json`,
  `packages/registration/package.json` and `pnpm-lock.yaml`. Keep Lit at 3.3.3.
  Add both verified archives to `scripts/disposable-tests/private-packages.py`
  and the corresponding digests to `deploy/disposable-tests/session.py`.
  Keep all historical pins, the exact digest checks and the `ui.tgz` transfer name.
- The existing `scripts/disposable-tests/dependencies.test.mjs` cases each failed
  twice on the respective bot head. Update the current contract fixture and keep
  0.2.45 historical selection for both packages. The exact source assertion in
  `packages/ui-smoke/test.mjs` also failed on #1429. Update its expected source
  to the verified commit and keep the browser assertions. Point the guest proof
  in `deploy/disposable-tests/guest-tools.test.py` at both new archives.
- Re-run the selection file, `python3 -B deploy/disposable-tests/session.test.py`,
  the Chromium UI smoke case and `pnpm typecheck`. Compare Cloud's UUID, public-key
  decoding and key-ID rules with the shared signing format. Run registration's
  `pairing-proof.test.ts`, `pairing-action-proof.test.ts` and `installation-proof.test.ts`
  against the new pin. These cover wire bytes, invalid proofs and Cloud's trust checks.
- Expect about 25 edited package, lockfile and runner lines and 10 edited test
  lines. Record the new releases in `docs/shared-ui-release.md`,
  `docs/backlog/shared-ui.md` and the existing D579 entry in `docs/backlog.md`.

## Qualify the runner and land

Run both Claude whole-branch reviews for the package boundary. Coordinate the
existing installer with the watcher and Lane I's operator. Read back the installed
controller and host recipe. Use a capture of this adoption and both verified archives
for the guest-tools, local-runtime and cancellation proofs in the
[disposable runner guide](../../../deploy/disposable-tests/README.md#run-the-controller-from-the-ci-server).
Check frozen and offline installs, the PostgreSQL job's exit 3, cancellation's exit
143 and guest removal. Verify routing is restored after the window. Finish the
signed-off pull request with current-head CI and list the changed test checks.
Land it, read back exact-merge CI and close #1429 and #1428 with the replacement link.
