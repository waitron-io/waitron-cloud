# Venue connection HTTP boundaries

## Installation deployment qualification

Run `node --test apps/portal/test/installation-transport-boundary.test.ts` to check
that lost, unreadable or refused replies retain your selected row and stop
confirmation for an explicit retry. Pending requests block another read or stop
and selection changes. Server waits remain in force across account changes and
backward clock adjustments until their exact seconds or date expiry. These native
HTTP client and controller checks leave server permissions, local confirmation
and live delivery against the selected deployment unqualified.

## Pairing deployment qualification

Run `node --test apps/portal/test/pairing-transport-boundary.test.ts apps/portal/test/pairing-retry-clock.test.ts`
to check that refused, unreadable or uncertain replies retain your code, offered
business and inspected venue for an explicit retry. Pending requests cannot
dispatch again. Server waits survive account, request and clock changes through
their exact expiry; reading the body consumes that same wait. Retrying keeps your
existing request proof and binding. These native checks leave server permissions,
local confirmation and live delivery against the selected deployment unqualified.
