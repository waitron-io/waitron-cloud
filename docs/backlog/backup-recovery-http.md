# Backup and recovery HTTP boundaries

## Backup catalogue qualification

Run `node --test apps/portal/test/backup-transport-boundary.test.ts apps/portal/test/backup-retry-clock.test.ts`
to check that lost replies preserve accepted choices, permission refusals clear
them and explicit retries keep the page cursor. Retry waits use elapsed time,
include body-reading time, survive reopening and account changes, and send no
request at expiry. These native client and controller checks preserve recovery
permissions; they grant no activation or stop-proof authority. Server permissions,
deployed browser integration, computer sleep and genuine restore or recovery
remain unqualified; database suites run in CI.

## Recovery deployment qualification

Run `node --test apps/portal/test/recovery-transport-boundary.test.ts` to check
that a pending inspection, approval, close or replacement blocks duplicate actions.
A server failure with a retry wait leaves the write uncertain; expiry sends no
request, and your next inspection reconciles the result without repeating the
write. Account and request changes clear private choices while keeping the wait.
Native checks cover exact seconds and date expiry for all four actions.
Run `node --test apps/portal/test/panel-retry-clock.test.ts` to check elapsed retry
waits through clock corrections and time spent reading response bodies. These
client checks leave server permissions and genuine restore or recovery unqualified;
they grant no activation authority or proof that the old server has stopped.
