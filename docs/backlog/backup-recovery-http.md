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

## Recovery transport waits and pending actions (D437)

When a recovery request is pending, you cannot send a second inspection,
approval, close or replacement from that controller. Native client and controller
checks with stubbed fetch cover these gates and exact seconds/date retry expiry
for all four actions.
A server failure with a retry wait leaves the write uncertain; expiry sends no
request, and your next inspection reconciles the result without repeating the
write. Account and request changes clear private choices while keeping the wait.
Run `node --test apps/portal/test/recovery-transport-boundary.test.ts` for these
checks. They preserve runtime behaviour and recovery authority; production
recovery, server-side permissions and clock-correction handling remain separate
qualification work.
