# Venue connection HTTP boundaries

## Installation deployment qualification

Run `node --test apps/portal/test/installation-transport-boundary.test.ts` to check
that lost, unreadable or refused replies retain your selected row and stop
confirmation for an explicit retry. Pending requests block another read or stop
and selection changes. Server waits remain in force across account changes and
backward clock adjustments until their exact seconds or date expiry. These native
HTTP client and controller checks leave server permissions, local confirmation
and live delivery against the selected deployment unqualified.

## Pairing transport refusals and retry waits (D428)

When pairing transport fails, your code, offered business and inspected venue
remain available for an explicit retry. Native HTTP/client/controller checks
cover refused and unreadable replies, uncertain approvals and success-shaped
bodies carried by refused HTTP statuses. Pending requests cannot dispatch again;
server waits apply through account and request changes, including the exact end
of seconds and date Retry-After values. Pairing measures these waits with elapsed
time so adjusting your computer's clock cannot extend, bypass or revive a wait.
HTTP-date waits use the response Date or the local clock when headers arrive;
reading the body consumes that same wait. Native clock checks and the English and
Spanish browser matrix cover retained choices and explicit retry through expiry.
A retry keeps the existing request proof and binding. Server permission checks,
local confirmation and live deployment remain separate qualification gates;
database suites run in CI.
