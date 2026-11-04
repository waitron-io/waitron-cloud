# Backup and recovery HTTP boundaries

## Backup catalogue transport refusals and retry waits (D426)

When an older catalogue request loses its connection or receives a service refusal,
your accepted snapshots and recovery choice remain available for an explicit retry.
A current session or permission refusal clears those choices because the catalogue
can no longer confirm your access. Native HTTP/client/controller checks cover initial
loads, pagination, unreadable bodies and retries with the existing page cursor.
Your catalogue retry wait measures elapsed time, so correcting your system clock
cannot bypass it, extend it or revive an expired wait. An HTTP-date wait uses the
response Date header, or your clock when the headers arrive, and includes time
spent reading the response body. The wait survives closing, reopening and account
changes; expiry permits an explicit read and sends no request by itself.
Run `node --test apps/portal/test/backup-retry-clock*.test.ts` for native HTTP checks
and the catalogue retry screen in both languages, themes and viewport widths.
Server authority, deployed browser integration, computer sleep and genuine restore
qualification remain separate gates; database suites run in CI while local Docker
is unavailable.

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
