# Venue connection HTTP boundaries

## Installation HTTP replies and stop confirmation (D416)

When an installation reply is malformed, your existing venue rows and stop
confirmation remain available for an explicit retry. Native client/controller
tests cover service, overview and redacted monitoring evidence. A stop reply must
confirm revocation for the same installation, venue, organisation and business;
a valid reply keeps the selected row's display context and offered action.
Permission refusals and retry waits retain their existing handling. Server
permission checks and live delivery remain separate qualification gates.

## Installation transport refusals and retry waits (D433)

When an installation read or stop has no usable reply, your selected row and
stop confirmation remain available for an explicit retry. Native HTTP client
and controller checks cover lost replies, unreadable bodies and refused statuses
carrying success-shaped data. Pending requests block another read or stop and
selection changes. Server retry waits survive account changes and backward clock
adjustments through the exact end of seconds and date values. Runtime and existing
assertions are unchanged; server permissions and live delivery remain separate
qualification gates. Database suites run in CI during the local Docker outage.

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
database suites run in CI during the local Docker outage.

## Pairing HTTP replies and binding checks (D414)

Malformed business lists cannot supply a pairing choice, and malformed inspection
or approval replies cannot replace your accepted view. Native client/controller
tests cover valid replies naming another request, venue, organisation or business,
plus approval replies that still await approval. A refused reply retains your
code and choice for an explicit retry; writes carry the existing request proof.
Server permission checks and local confirmation remain separate qualification gates.

## Installation replies after account changes (D398)

Native controller tests hold installation-list and stop replies while you change
accounts, switch away and back, or sign out. Old successes and refusals leave the
current rows, organisation, stop confirmation, pending work, feedback and cooldown
unchanged. Selecting the same account keeps its pending request, and the current
account can still load and stop its offered installation. These tests control
HTTP replies. The earlier incomplete signature-metadata response remains
unexplained; setup now uses [bounded verified attempts](ci-pnpm-setup.md).
Server permission and revocation checks still belong to mandatory CI.
