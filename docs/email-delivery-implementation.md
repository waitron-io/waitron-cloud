# Reliable account email

Your signup or reset request should survive a process stopping before it sends the
email. Save the pending message in the same PostgreSQL transaction as its request.
Save password-change notifications with the password and session changes too.

## Delivery contract

- Requests return after committing, without contacting a mail provider. A queue write
  failure rolls back the operation. Recovery keeps its generic accepted response for
  ineligible addresses; those addresses do not receive queued messages.
- Encrypt recipients and tokens with AES-256-GCM and an explicitly supplied key ring.
  Bind ciphertext to the message ID, kind and key ID. Keep keys outside PostgreSQL;
  retain old keys until their pending messages finish. Never silently generate a key
  at application startup. Verification tables continue to store token hashes only.
- A worker claims one due row at a time using a database lock that skips rows another
  worker is claiming. Commit a 60-second lease before sending; increment attempts at
  claim time so crashes count. Reclaim abandoned work after the lease expires, and
  fence completion by the claim ID so an old worker cannot overwrite its replacement.
- Try at most eight times, delaying retries by 30 seconds, then doubling up to 15
  minutes. Link messages expire with their tokens; notifications expire after seven
  days. Check request consumption, account eligibility and credential generation
  immediately before delivery. Expired or invalidated links are discarded.
- Delivery is at least once within the retry/expiry limits. A provider accepting mail
  just before a crash can cause a duplicate. The worker stops waiting after 20 seconds; the production transport must also
  cancel its underlying operation within that deadline. A link can expire or be consumed in transit;
  completion always rechecks its validity.
- Record status, attempts, failure counts and fixed failure codes. Erase encrypted
  payloads when messages reach a terminal state. Provider acceptance is not proof of
  inbox delivery. Production bounce handling, alerts and metadata retention remain
  follow-ups with the SES adapter.

## Implementation and proof

1. Add failing PostgreSQL tests for transactional enqueue, retries, expiry, competing
   workers, abandoned claims, stale workers, encrypted payloads and key rotation.
2. Add migration 005, the queue and worker, then wire signup and recovery into it.
   Preserve their existing account/session/permission and concurrency assertions.
3. Run the queue through Mailpit, including a separate process that restarts delivery.
   Provide local worker and status commands using explicit database/key configuration.
4. Update API documentation and backlog, run focused checks, then finish the branch.

The Cloud web adapter still needs abuse controls and an assessment of response timing;
removing provider latency does not make database paths constant-time. Waitron files,
SES provisioning and public routes remain outside this implementation.

## Run the local worker

Use the same key ring for the account backend and the worker. Generate a key once
and save it in your ignored `.env`, alongside `DATABASE_URL` for your local migrated
Cloud PostgreSQL database:

```sh
node --input-type=module -e 'import { randomBytes } from "node:crypto"; console.log(JSON.stringify({"local-v1": randomBytes(32).toString("hex")}))'
```

Copy the JSON output into `CLOUD_EMAIL_KEYS` and set
`CLOUD_EMAIL_ACTIVE_KEY_ID=local-v1`. Do not generate a new key at each start: queued
messages encrypted under a lost key cannot be delivered. Keep key material out of
source control, logs and database backups. Production secret storage and backup-key
recovery need deployment configuration before using this beyond local development.

Apply migrations with `node --env-file=.env packages/registration/src/migrate-cli.ts`.
Start capture and delivery from the repository root:

```sh
pnpm mail:up
pnpm mail:worker
```

The worker polls once a second when idle and finishes its current attempt on SIGINT
or SIGTERM. It sends only to the local Mailpit adapter, which refuses production mode.
You can process at most one due message with `pnpm mail:worker --once`, or print a
JSON summary with `pnpm mail:status`. Database/configuration failures exit nonzero
with a fixed diagnostic; restart after correcting the cause. Provider failures are
saved for retry. The worker does not run migrations automatically.

An empty queue produces:

```json
{"counts":{"pending":0,"processing":0,"sent":0,"expired":0,"cancelled":0,"failed":0},"attempts":0,"failures":0,"oldestPendingAt":null}
```

`sent` means the transport accepted the message, not that it reached an inbox.
`attempts` counts claims, including claims abandoned by a crash. `failures` counts
observed send/decryption failures; a crash can increase attempts without increasing
failures. Counters cover retained rows, not lifetime totals. `last_error` on a row is
a fixed code; it may remain after a successful retry. Terminal rows retain metadata
but erase the recipient and token ciphertext.

## Use it from the account backend

```ts
const outbox = new EmailOutbox({
  activeKeyId: process.env.CLOUD_EMAIL_ACTIVE_KEY_ID!,
  keys: JSON.parse(process.env.CLOUD_EMAIL_KEYS!),
});
const signup = new SignupStore(pool, outbox);
await signup.request('owner@example.test'); // { status: 'accepted' }
```

Construct `PasswordRecoveryStore(pool, outbox)` the same way. Only the worker takes
a `SignupMailer & PasswordRecoveryMailer`. The old direct-mail store constructor
and signup `delivery_unavailable` result are removed: provider failures belong to
background delivery. Existing in-flight request tokens remain usable after migration,
but migration cannot reconstruct unsent messages from token hashes. Request a fresh
link if an older request was never delivered.

To rotate keys, first make the new key available to every worker while retaining the
old one, then change the backend's active key ID. Keep each old key until no pending
or processing rows reference it, including when restoring an older database backup.
Missing keys and failed authentication of ciphertext produce `payload_unavailable`
and use the normal retry limit. Repair configuration before those retries expire;
terminal messages cannot be replayed after their payload has been erased.

The implementation uses Node's [authenticated encryption APIs](https://nodejs.org/api/crypto.html#class-cipheriv)
and PostgreSQL's [row locking with SKIP LOCKED](https://www.postgresql.org/docs/18/sql-select.html#SQL-FOR-UPDATE-SHARE).
The latter allows a worker to skip a row another worker is claiming.
