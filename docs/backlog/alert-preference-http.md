# Alert preference HTTP boundaries

## Alert-preference transport refusals and retry waits (D429)

Your alert retry wait measures elapsed time, so a system clock correction cannot
lengthen, bypass or revive it. An HTTP-date wait uses the response's valid `Date`
header, or your clock when the headers arrive, and includes time spent reading
the body. Account changes preserve the remaining wait; an expired wait contributes
nothing to the shared countdown. Run
`node --test apps/portal/test/alert-retry-clock*.test.ts` for native HTTP checks and
English/Spanish browser checks in both themes at phone and desktop widths.

If an alert read or save has no usable reply, your choices remain unconfirmed
until you explicitly retry or read the current server state. Native tests exercise
the real HTTP client and controller with unreadable bodies and valid-looking
preferences carried by refused HTTP responses. Pending requests cannot dispatch again or change the
draft. Server retry waits apply through sign-out and account changes, including
the exact end of seconds and date values. Server authority, browser integration
and production mail delivery remain separate qualification gates; database
suites run in CI while local Docker is unavailable.
