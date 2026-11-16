# D621: readable verifier image inputs

The third owner-run reports a missing verification module, but the image build's
root import passed. You need the same import to work as image user `1000:1000`.
The watcher requested diagnosis and the smallest fix plan on 16 November at 02:55
in Lane G's questions.md; this plan claims no owner design approval.

**Evidence.** The pinned Waitron `8eed667` build emits the existing import path.
Extracting its archive under the owner handoff's `umask 077` produces directories
`700` and files `600`; under `022`, they are `755` and `644`. A Linux synthetic
import as an unprivileged user reproduces `ERR_MODULE_NOT_FOUND` with the former
modes and passes with the latter. The failed image was already removed, so its
actual modes and the first run's cause remain unconfirmed. Driver receipts are
in Lane G's `receipts/d621-verifier-image-transfer/diagnosis.md`.

- [ ] In `scripts/build-backup-verifier.test.mjs`, extend the existing real
  script/git/tar capture fixture to launch the builder under caller mask `077`.
  At the Docker boundary, require unprivileged traversal of archived source,
  generated `build/` and `verifier/`, and reading of source, release stamp,
  target and entry files. Keep the temporary context root `700` and all existing
  source-exclusion, pin, digest, refusal and cleanup assertions. Observe red.
- [ ] In standalone `scripts/build-backup-verifier.mjs`, set `process.umask(0o022)`
  before staging inputs. The parent's private mask stays unchanged; keep the
  private temporary root and cleanup. Move `deploy/backup-verifier/Dockerfile`'s
  unchanged target-equality check after `USER 1000:1000`. Observe green.
- [ ] Run `node --test scripts/build-backup-verifier.test.mjs scripts/ci-verifier-build-refusals.test.mjs scripts/ci-verifier-source-isolation.test.mjs deploy/test-cloud/integration-verification-target.test.mjs`.
  One bounded image build under caller `077` must pass the existing import and
  target equality as user `1000`. CI owns full suites; no full local P1 rehearsal.
- [ ] Update only `docs/backlog.md`'s provisioning paragraph. Keep import paths,
  exports, Waitron source and target pin unchanged; add no helper, recursive
  chmod, logger or protocol. No provider access or another Amazon run.

**Size:** production about `+2`, tests `+25/-3`, Dockerfile `+1/-1`, docs including
this plan about `+40/-4`, support zero: about 76 changed lines; stop above 114.
After review, landing and exact-merge checks, hand off merged Cloud and unchanged
Waitron with the existing private configuration, $300 cumulative budget, $10
deny-launch backstop, independent deletion and 90-minute teardown. Only the
watcher launches on the owner's word. A pass requires exit 0 and nonempty valid
result JSON satisfying the existing checks; wider P1 qualification stays open.
