# Bound management history

The Cloud management database keeps retry results and operational history so a lost reply does not repeat a sensitive action. Keeping every terminal row forever creates a different problem: tables and indexes grow even when the number of live customers does not.

Use the history cleanup command to remove old transient records after you have chosen the retention cutoffs for your deployment. The command has no built-in retention periods and performs a dry run unless you explicitly apply the policy.

## Create a policy

Put exact cutoff timestamps in a JSON file:

```json
{
  "cutoffs": {
    "sessions": "2026-01-01T00:00:00.000Z",
    "signupRequests": "2026-01-01T00:00:00.000Z",
    "passwordResetRequests": "2026-01-01T00:00:00.000Z",
    "webauthnCeremonies": "2026-01-01T00:00:00.000Z",
    "pairingRequests": "2026-01-01T00:00:00.000Z",
    "registrationOperations": "2025-10-01T00:00:00.000Z",
    "emailDeliveries": "2026-01-01T00:00:00.000Z",
    "backupJobs": "2026-01-01T00:00:00.000Z",
    "recoveryHistory": "2025-10-01T00:00:00.000Z",
    "backupTombstones": "2025-10-01T00:00:00.000Z"
  },
  "chunkSize": 100
}
```

These timestamps are examples, not recommended retention periods. Choose them from your legal, security, support and customer-deletion policies. Omit a category when you have not made that decision. The command rejects future dates, dates without an explicit timezone and chunk sizes outside 1 through 1,000.

## Preview and apply

Apply the current migrations, set `DATABASE_URL`, then preview the policy:

```sh
pnpm db:migrate
pnpm history:cleanup -- --policy ./history-cleanup.json
```

The JSON receipt reports `eligible`, `blocked`, `deleted` and `hasMore` for each enabled category. `blocked` counts rows retained by a dependency rule, such as an open incident or backup-job reference; it does not count rows temporarily locked by a worker. A dry run always reports zero deletions and leaves the database unchanged.

When the counts match your policy, apply one bounded chunk per category:

```sh
pnpm history:cleanup -- --policy ./history-cleanup.json --apply
```

Repeat the same command until every category reports `hasMore: false`. Keep the policy and receipts with your operational change record. If a live worker holds an eligible row, cleanup skips it and a later run can collect it.

An applied deletion cannot be rolled back after the transaction commits. Restore the management database from its normal backup if you applied the wrong cutoff. Always keep the first run as a dry run and review it before adding `--apply`.

## What each category removes

- `sessions` removes ended or expired management sessions after WebAuthn ceremony and authenticator enrolment references are gone. Authenticator history has no approved deletion policy yet, so its referenced sessions remain blocked even after confirmation or cancellation.
- `signupRequests` and `passwordResetRequests` remove consumed or expired token rows, but not while their encrypted email is pending or processing.
- `webauthnCeremonies` removes consumed or expired five-minute challenges.
- `pairingRequests` removes completed or expired matching-code requests.
- `registrationOperations` removes completed or expired connection requests and old installation replay results.
- `emailDeliveries` removes terminal outbox metadata and its service-alert delivery link. It never removes pending or processing mail, or the delivery link for an incident that is still open.
- `backupJobs` removes completed jobs. Pending, running and failed jobs remain available to workers or explicit retry.
- `recoveryHistory` removes closed, expired recovery operations after their approved request and completed replacement reference. An incomplete replacement blocks deletion.
- `backupTombstones` removes database metadata for objects that the backup worker already deleted. Any recovery or backup-job reference blocks deletion, so include `backupJobs` with a suitable cutoff when old completed jobs should be removed first. Current backup points are outside this category.

- `relayAdmissionCounters` removes only expired recipient/grant counters and their
  empty windows, using PostgreSQL time and the admission lock. The chunk size counts
  both counters and windows. It never removes live budgets, messages or replay
  records. Include an explicit cutoff when you want idle relay schemas cleaned;
  normal admission also prunes expired rows before reserving a budget.

The command does not delete current incident, monitor or probe rows. Those tables keep one current row per venue, route or incident kind. It also leaves installation revocations, hostname changes and security audit data alone because their retention needs a separate policy.
