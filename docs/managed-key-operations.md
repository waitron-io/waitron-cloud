# Check and rehearse managed encryption keys

Your Cloud database contains encrypted backup keys and queued email payloads, but it
does not contain the keys that protect them. You must restore the database and its
separately held key material together. A healthy database without those keys cannot
deliver pending account mail or recover a retained venue snapshot.

The managed-key check gives you a read-only inventory before you restart workers or
consider retiring a key. It reports key identifiers, dependency counts and validation
states. It never reports a key, encrypted payload or sealed backup value.

## Check the current database

Supply the same `DATABASE_URL`, `CLOUD_BACKUP_MASTER_KEY`,
`CLOUD_EMAIL_ACTIVE_KEY_ID` and `CLOUD_EMAIL_KEYS` that the workers use. Keep these in
your protected environment file instead of putting them in shell history. Then run:

```sh
pnpm keys:check
```

The command exits with status 0 only when the supplied backup master key opens every
stored backup-key version and every pending or processing email can be opened with its
configured key. Status 2 means the database was read successfully but at least one
required key is missing or wrong. Status 1 means configuration or the database check
itself failed.

A report has this shape:

```json
{
  "schemaVersion": 1,
  "ready": true,
  "backupKeys": [
    {
      "venueId": "af8335f8-8362-4d15-9954-0a6f588261f4",
      "version": 1,
      "active": false,
      "validation": "verified",
      "retirement": "blocked",
      "dependencies": { "captures": 1, "points": 1, "managedStreams": 0 }
    }
  ],
  "emailKeys": [
    {
      "keyId": "email-2026-09",
      "active": true,
      "configured": true,
      "validation": "verified",
      "retirement": "blocked",
      "dependencies": { "pending": 3, "processing": 0 }
    }
  ]
}
```

`verified` means the supplied key opened every stored authenticated ciphertext that
currently depends on it. An unused
email key is only `configured` because there is no payload with which to authenticate
it. `unavailable` means the required key is absent, wrong or cannot authenticate the
stored live payload. Treat `ready: false` as a stop: repair the key configuration
before you start a delivery or backup worker.

## Rotate without losing old data

Backup rotation creates a new per-venue key version for new snapshots. Replacement
also rotates this version. Old snapshots and managed streams continue to name their
original version, so keep every version that the report marks `blocked`. The operator
master key remains outside PostgreSQL and protects all of those versions. This command
checks that the supplied master key can still open them; it does not change or delete
the master key.

For email, distribute the new key to every API and worker first. Keep the old keys in
`CLOUD_EMAIL_KEYS`, then change `CLOUD_EMAIL_ACTIVE_KEY_ID` so new messages use the new
key. Restart the processes and run `pnpm keys:check`. Remove an old email key only after
the current database reports it as `eligible` and your retained database backups no
longer need it.

`eligible` is a dry-run result, not a delete operation. Cloud deliberately has no
backup-key deletion command. A database backup can contain dependencies that no longer
exist in the current database, so its matching key set must follow that backup's own
retention.

## Rehearse restart and recovery

Run the focused drill against disposable PostgreSQL:

```sh
pnpm test:managed-keys
```

The drill creates an old-key email and a retained snapshot, rotates both active keys,
constructs fresh worker and catalogue instances, delivers the old message and restores
the old snapshot. It then proves that a wrong backup master key stops before restore
and does not record a false archive-verification failure. It also runs the CLI with
correct and wrong keys and checks that its JSON contains no key material.

For the complete local recovery path through a real Waitron archive and cold restore,
run `node scripts/test-local-backups.mjs` as described in
[Local encrypted backup proof](local-backups.md). That proof loses the original server,
rotates the venue key, and restores the retained snapshot on a replacement. Neither
drill provisions a live key service or proves a paid vault provider.

After restoring an older Cloud database, restore its retained key set into an isolated
environment and run `pnpm keys:check` before starting workers. If the check reports an
unavailable backup version or email key, recover that version from the separately held
key backup. Do not rotate again in an attempt to repair old ciphertext: rotation changes
which key protects new work and cannot recreate a missing old key.
