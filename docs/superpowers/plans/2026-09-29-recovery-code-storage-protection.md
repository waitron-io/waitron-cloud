# Recovery request code protection

**Goal:** A database-only disclosure must not allow offline checking of eight-digit
backup-recovery codes. Keep existing machine proofs, request retries, owner authority,
five-guess limits, deadlines, replacement and history behavior.

**Design:** Follow pairing's key-map configuration and versioned HMAC-SHA256 format,
with independent `CLOUD_RECOVERY_ACTIVE_KEY_ID` / `CLOUD_RECOVERY_KEYS` secrets and
the domain `waitron-cloud/recovery-code/v1`. Authenticate the JSON array of domain,
lowercase request UUID, machine public key and SHA-256(code). Store only
`v1:<key-id>:<mac>`. Keep pairing unchanged; a separate small implementation avoids
changing a second authentication flow. No dependency or wire-format changes.

Missing keys and legacy rows refuse code checks without spending attempts. A wrong
secret for a known ID behaves like a wrong code. Machine start/status retain code
binding, so both require the original key. Browser inspect/approve/replace/close
also require it. Existing signed recovery info/read/restored calls do not check
request codes and retain their existing authority and lifetime.

Migration 028 permits both formats only for an explicit offline upgrade. Stop old
account writers, apply migrations, then run a bounded CLI until it reports zero.
It locks and wraps legacy digests in batches, preserving every other column,
including approved/completed history, expiry and failed guesses. Never accept a
legacy verifier in a handler. Rotation retains old keys for existing rows; do not
replace the secret under an ID. Old database backups need their matching key map.

**Consumer trace:** `RecoveryRequests.machine` creates/checks the row;
`#browser` checks/counts/approves it; HTTP owner replace and close first inspect;
`ReplacementStore` locks the row before recovery and checks public-key freshness;
`history-cleanup` locks/deletes completed request children. The last two do not
read the digest and need no production changes. The SQL constraint and release
migration manifest must accept the new format. Tests/proof workers get independent
fixture keys; new local stacks persist a recovery map only for the account role.
Existing runtime configuration must not be silently regenerated.

**Execution:** Inline, as authorised by the unattended campaign runbook. Node 26,
TypeScript, PostgreSQL, local Docker fixtures only. Existing behavioral assertions
remain; the runtime whole-shape fixture may gain only the new environment fields.

## Tasks

- [x] Add PostgreSQL and HTTP behavioral tests that fail on unkeyed storage and
  missing configuration. Observe the failures before implementation.
- [x] Add `RecoveryCodes`, `recoveryCodeKeysFromEnv`, `upgradeRecoveryCodes` and the
  bounded `recovery-codes-cli.ts`. Wire the request constructor and account option,
  migration/manifest and independent fixture/runtime keys.
- [x] Prove request/public-key transplantation fails, rotation overlap and separate
  process restart work, absent/wrong keys refuse, concurrent wrong guesses stop at
  five, and legacy upgrade preserves pending and completed history. Exercise the
  upgrade CLI, rollback/resume, HTTP responses/audit and sanitized diagnostics.
- [x] Run existing recovery/replacement/continuous-recovery, abuse, history cleanup,
  migration and focused runtime tests. Delete critical guards in a disposable copy
  and observe failing tests. Run typecheck.
- [x] Document rollout, rotation and key retirement; narrow all related backlog
  wording. Complete the Claude run-it review and address its findings.

Delivery follows finish-branch through normal push and exact-head CI, then
land-branch under the shared lock, main/install refresh, owned worktree/branch
cleanup and exact-merge CI read-back.

## Review focus

Check that uppercase UUID proofs retain their existing refusal, swapped machine identities, old-key retries after a
new active key, partially upgraded databases, and expired approved history. These
conditions must preserve binding and history without falling back to a plain hash.
Do not claim logs outside the exercised HTTP/CLI/audit surfaces were inspected.
