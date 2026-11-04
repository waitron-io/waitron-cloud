# Alert preference HTTP boundaries

## Alert-preference deployment qualification

Run `node --test apps/portal/test/alert-transport-boundary.test.ts apps/portal/test/alert-retry-clock*.test.ts`
to check that refused or unreadable replies leave your choices unconfirmed until
you explicitly retry or read the current server state. Pending requests cannot
dispatch again or change your draft. Retry waits use elapsed time through account
and clock changes, so adjusting your clock cannot extend, bypass or revive a wait.
HTTP-date waits use the response Date or your clock when headers arrive; reading
the body consumes the same wait. These checks leave server authority, deployed
browser integration and production mail delivery unqualified.
