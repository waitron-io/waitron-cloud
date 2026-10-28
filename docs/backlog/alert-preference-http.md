# Alert preference HTTP boundaries

## Initial alert reads after account changes (D408)

When you change account or sign out, late alert-preference reads cannot replace
current choices, end a newer pending read, clear a saved confirmation or impose
an old retry wait. Native controller tests cover successful reads and refusals,
including returning to the same account. Selecting the current account keeps its
pending read, and a current rate limit still applies after an account change.
Server authority, browser integration and production delivery remain separate
qualification gates.

## Alert-preference transport refusals and retry waits (D429)

If an alert read or save has no usable reply, your choices remain unconfirmed
until you explicitly retry or read the current server state. Native tests exercise
the real HTTP client and controller with unreadable bodies and valid-looking
preferences carried by refused HTTP responses. Pending requests cannot dispatch again or change the
draft. Server retry waits apply through sign-out and account changes, including
the exact end of seconds and date values. Server authority, browser integration
and production mail delivery remain separate qualification gates; database
suites run in CI while local Docker is unavailable.

## Alert-preference HTTP response validation (D415)

Malformed alert replies cannot replace your choices or confirm a save. Native
HTTP/client/controller checks cover initial reads, refreshes and saves, including
broken JSON and lost connections. An uncertain save stays retryable after you
revert your choices; a valid reply confirms the server's choices. Current permission
loss clears the form, and rate limits retain their wait before another request.
Server authority, browser integration and production mail delivery remain separate
qualification gates; database suites run in CI while local Docker is unavailable.
