# Protect pairing codes when you store them

An eight-digit code is small enough to guess from an ordinary hash. Cloud stores a
keyed verifier instead: you need both the database row and a separate secret to
check a guess. Keep that secret outside PostgreSQL and outside database backups.
Use a different key from your email, rate-limit, backup and installation keys.

Supply `CLOUD_PAIRING_ACTIVE_KEY_ID` and `CLOUD_PAIRING_KEYS` to the account worker.
The second value is a JSON object mapping key IDs to 32-byte secrets encoded as 64
hexadecimal characters. Generate each secret with a cryptographic random generator
and deliver it through your private runtime configuration. IDs contain 1–64 ASCII
letters, digits, underscores or hyphens. For example, your secret file contains:

```dotenv
CLOUD_PAIRING_ACTIVE_KEY_ID=pairing-2026-09
CLOUD_PAIRING_KEYS={"pairing-2026-09":"<your independent 64-hex-character secret>"}
```

The example value is a placeholder, not a usable key. The Node API accepts the same
shape as the second `PairingStore` argument or `createAccountApp.pairingCodeKeys`.
Pass `null` to explicitly disable code checks. Omitting the option reads the two
environment variables. A missing key refuses start, inspect and approval; machine
status and completion still use their existing signed proof and approvals. Missing
keys do not spend guessing attempts. A wrong secret under the right ID is
indistinguishable from a wrong code and spends an attempt, so restore the exact key
before retrying. Configuration errors never include the supplied key material.

## Upgrade existing requests without losing approval

Stop all old account workers before upgrading. An old worker cannot read the new
verifier format and must not create new unprotected rows. Apply migrations through
your normal migration login, then give the upgrade command your private key
configuration and a database login allowed to update `pairing_requests`:

```sh
pnpm db:migrate
node --env-file=.env packages/registration/src/pairing-codes-cli.ts --once
```

Each pass locks and upgrades at most 100 legacy rows. It prints only a count, such
as `{"upgraded":3}`. Repeat until `{"upgraded":0}`, with old writers still stopped,
then start the new account workers. A blocked database operation fails after ten
seconds; fix the lock or connection problem and run the pass again. A failed pass
rolls back as one transaction. Already keyed rows are left alone, so the command is
safe to resume after losing its reply.

The upgrade wraps the old digest with the active key and the immutable request
binding. It changes only `code_hash`: expiry, attempt counts, pending Cloud
approval and completed results remain intact. Until a legacy row is upgraded, new
code checks refuse it. Signed status and completion retain their existing rules.
The migration accepts both storage formats solely so you can perform this explicit
upgrade; HTTP never falls back to comparing an unkeyed digest.

Old backups still contain their old hashes. Protect or retire those copies under
your backup policy. This upgrade cannot undo a disclosure that already happened.

## Rotate without interrupting pending requests

First distribute the new key to every account worker while retaining the old key
and old active ID. Then change the active ID everywhere. New requests use the new
key; existing rows name their original key and continue to verify during overlap.
Restarted workers need the same complete key map. Never replace the secret behind
an existing ID.

Keep an old key as long as you need start or browser retries for rows that name it,
including completed rows. Removing it refuses those code checks; it does not erase
approvals, registrations or installation history, and signed status/completion
remain available. Use the existing history-cleanup policy before retiring such
keys. This change chooses no new retention period and does not rekey existing
verifiers, because the stored MAC cannot recover the original digest. Restore old
keys alongside any database backup whose code checks you need to preserve.

## Local deployment

A newly bootstrapped local stack stores an independent `pairing` key map in its
private mode-0600 `runtime.json`, alongside the other external secrets. Only the
account role receives this map. Existing local configuration stays unchanged.
Before restarting an existing stack, stop its account service and add a `pairing`
object with the same `{activeKeyId, keys}` shape to that private file, using a fresh
random key. Keep its mode at 0600 and retain every other field. Supply that exact map
to the upgrade command described above and upgrade the database before restarting
account workers. Do not delete or regenerate the configuration volume to add a key.

## Verification boundary

The version-1 verifier is HMAC-SHA256 over a JSON array of the domain label
`waitron-cloud/pairing-code/v1`, request UUID, installation public key, local venue
UUID, environment and SHA-256(code). UUIDs are lowercase. The stored form is
`v1:<key-id>:<mac>` and comparisons use constant-time byte comparison. Binding the
MAC to the request prevents transplanting a stored verifier to another request.

The PostgreSQL pairing tests exercise storage, concurrency, expiry, restart,
rotation and upgrade; HTTP tests cover refusals and secret-free responses/audit
events. This protects against database-only disclosure. It does not protect a
compromised account worker that can read the external keys. Backup-recovery request
codes use a separate store and are outside this pairing change.
