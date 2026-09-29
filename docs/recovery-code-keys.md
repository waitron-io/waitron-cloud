# Protect recovery request codes when you store them

An eight-digit recovery code can be guessed from an ordinary hash. Cloud stores a
keyed verifier instead: checking a guess requires a secret held outside PostgreSQL
and outside database backups. Use an independent secret, separate from pairing,
email, rate limiting, backup decryption and installation signing.

Give the account worker `CLOUD_RECOVERY_ACTIVE_KEY_ID` and `CLOUD_RECOVERY_KEYS`.
The second value is a JSON object mapping key IDs to 32-byte secrets encoded as 64
hexadecimal characters. IDs contain 1–64 ASCII letters, digits, underscores or
hyphens. Generate each secret with a cryptographic random generator and deliver it
through private runtime configuration:

```dotenv
CLOUD_RECOVERY_ACTIVE_KEY_ID=recovery-2026-09
CLOUD_RECOVERY_KEYS={"recovery-2026-09":"<your independent 64-hex-character secret>"}
```

The example is a placeholder. The Node API accepts the same `{activeKeyId, keys}`
shape as the fourth `RecoveryRequests` argument or `createAccountApp.recoveryCodeKeys`.
Omitting the option reads the environment; `null` explicitly disables code checks.
No pairing or backup master key is used as a fallback.

A missing key refuses request start/status and browser inspect, approve, replace
and close without spending guesses. HTTP returns `temporarily_unavailable` with
status 503. A wrong secret under an existing ID is indistinguishable from a wrong
code: browser checks spend one of the five attempts, and machine checks refuse the
binding. Restore the exact secret before retrying. Configuration errors omit supplied
values. The existing signed recovery info/read/restored operations do not check the
request code; they retain their own approval, expiry and revocation checks.

## Upgrade existing requests without losing their history

Stop every old account worker first. Apply the release migrations, including
`028_recovery_code_protection.sql`, then give the upgrade command your private
recovery key map and a database login allowed to update `backup_recovery_requests`:

```sh
pnpm db:migrate
node --env-file=.env packages/backups/src/recovery-codes-cli.ts --once
```

Each pass locks and wraps at most 100 legacy digests and prints only a count:

```json
{"upgraded":3}
```

Repeat until it prints `{"upgraded":0}`, keeping old writers stopped. Then start
new workers with the same keys. The command waits for locked rows rather than
reporting a false zero. Database statements have a ten-second limit and connecting
has a five-second limit; a failed pass rolls back its updates. Resolve the database
or lock problem and resume. Already keyed rows remain unchanged.

The command changes only `code_hash`, including on approved, expired and completed
requests. It preserves IDs, machine keys, owner and operation links, deadlines and
failed-attempt counts. Pending codes and completed-request retries still work after
the upgrade with their original identity and code. Expired pending requests stay
expired. New workers refuse legacy code checks until you upgrade them.

The migration permits the old format solely for this explicit conversion. An old
worker can still write it, so mixed old/new workers are not a supported rollout.
Stop a straggler and run another upgrade pass before resuming traffic. Old database
backups still contain guessable hashes; protect or retire them under your backup
policy. Conversion cannot undo an earlier disclosure.

## Rotate with overlap

First distribute the new key to every account worker while retaining the old key
and active ID. Then change the active ID everywhere. New requests use the new key;
existing rows name their original key and keep working while both keys are present.
Restarted workers need the same map. Never replace the secret behind an existing ID.

Keep old keys while any retained request needs start/status or browser retries,
including approved and completed requests. Removing a key refuses those checks;
it does not delete recovery history or undo approvals. Follow the existing history
cleanup policy before retirement. This change chooses no new retention period and
does not rekey stored verifiers, which cannot recover their original digest. Restore
the matching key map alongside a database backup.

## Local stacks

A new local stack writes an independent `recovery` key map into its private
mode-0600 `runtime.json`. Only the account role receives it. Existing configuration
is preserved. Before restarting an existing stack, stop its account service and
add a `recovery` object with the `{activeKeyId, keys}` shape to that private file,
using a new random secret. Retain every other field and mode 0600. Pass that exact
map to the upgrade command, migrate and convert the database, then restart the
account service. Do not delete the configuration volume to add a key.

## What the checks establish

The version-1 verifier is HMAC-SHA256 over a JSON array containing
`waitron-cloud/recovery-code/v1`, the lowercase request UUID, machine public key
and SHA-256(code). The row stores `v1:<key-id>:<mac>`; comparison uses constant-time
byte comparison. Both identity fields are authenticated, so a verifier copied to a
different request or machine does not match. The signed wire proof is unchanged,
including its lowercase UUID requirement.

The PostgreSQL and HTTP tests exercise storage, identity binding, concurrent guesses,
expiry, restart, rotation, absent/wrong keys, owner approval and legacy conversion.
CLI errors, HTTP responses, captured application console output and audit events are
checked for code/key disclosure. These checks do not audit an external proxy's logs.
Database-only guessing protection does not cover an account worker compromised
along with its external secrets.
