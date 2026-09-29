# Pairing-code storage protection

Goal: a database-only copy cannot verify guesses of the eight-digit pairing code.
The authorised D33 scope keeps the wire format, machine proof, local confirmation,
expiry, five attempts, exact retries and installation history unchanged.

Design: store `v1:<key-id>:<HMAC-SHA256>` in code_hash. The MAC input is an
unambiguous JSON array containing a domain label, request ID, installation public
key, local venue ID, environment and SHA-256(code). The intermediate digest permits
an explicit upgrade of legacy rows without recovering codes. No unkeyed fallback
is accepted by request handlers. Keys are supplied outside PostgreSQL through
CLOUD_PAIRING_ACTIVE_KEY_ID and CLOUD_PAIRING_KEYS, or explicit constructor options.
Missing/malformed keys fail closed without echoing configuration. A retained key
ID verifies existing requests; the active key writes new requests. Retain old keys
while their rows need browser or start retries. Machine status/completion do not
need the code secret and retain existing installation recovery semantics.

Upgrade: stop old account workers, apply the additive SQL migration, then run a
bounded upgrade command repeatedly until it reports zero changed rows. It locks
and wraps only legacy code hashes, preserving every other column including prior
approval/result. The new service refuses legacy code checks until upgraded.
Protect old database backups separately: wrapping cannot revoke a leaked old hash.
Do not automatically rewrite keyed rows or silently invalidate pending approvals.

Implementation and verification (inline, owner-authorised campaign):

- [ ] Add PostgreSQL red-first storage, request binding, wrong/missing keys,
  concurrent guesses, rotation and legacy upgrade tests; preserve existing cases.
- [ ] Add the versioned code helper, constraint migration, explicit key injection,
  bounded upgrade API/CLI and HTTP wiring. Trace all code_hash consumers first.
- [ ] Add HTTP and configuration tests, local-stack secret wiring, and upgrade/
  rotation documentation. Keep secret material out of responses and diagnostics.
- [ ] Run focused PostgreSQL/HTTP suites and typecheck; prove critical guards by
  mutation in a disposable checkout. Run Claude security/run-it review once.
- [ ] Finish branch, inspect current-head CI, land under the shared lock, refresh
  main/install, clean only owned worktrees/branches, record exact-merge CI.

Review focus: legacy approvals survive wrapping; no request-transplant of hashes;
missing key IDs do not spend code attempts; wrong secret never approves; keys with
malformed IDs/hex cannot leak into errors. Existing expiry/restart/permission/race
cases remain unedited. Backup-recovery short codes are a separate consumer and
remain out of scope, recorded as a follow-up if still unkeyed.
