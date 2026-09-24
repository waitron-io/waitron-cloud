# Customer remote-access setup

Continue the authorised local integration sequence. Help a venue owner find their staff
and public addresses, set a custom hostname and diagnose what remains before access works.
Keep the common case simple: open Remote access on one venue and use its assigned names.

## Customer flow

Show assigned and current names plus existing desired-service and recent health status.
A placement that does not yet exist shows setup pending; never fabricate a usable URL.
Explain that staff HTTPS ends at the venue and public access has Cloud bot protection.
Show LAN DNS instructions using the staff name, a reserved local address and an offline test.
Do not claim the browser can configure the router or verify the LAN from Cloud.

For a custom name, choose staff/public, enter a lowercase hostname, obtain both CNAME
records, create them at the DNS provider, then explicitly confirm the change. Explain
that changing the name interrupts access until the certificate and venue configuration
are ready. Return to the assigned name through the same explicit confirmation. Show
provisioning until fresh health confirms readiness. The existing operator certificate
commands remain responsible for local issuance/installation; live provider automation and
the appliance installer are separate deployment work. The screen labels this local
setup boundary rather than claiming the subscription is live.

## Authority and concurrency

Only current organisation owners with a valid Cloud session, exact origin and CSRF proof
can read or change setup. Rate limits persist in PostgreSQL. Browser inputs cannot select
a gateway cell, peer key, tunnel address, provider or certificate authority.

Reuse RemoteAccessStore DNS checks and hostname mutation. Add an authorization callback
inside its transaction before taking the installation lock, after external DNS waits, to hold owner
membership and recheck the session through commit. HTTP checks authority before DNS too.
Preserve account, session, membership, then installation lock order used by revocation. A revision conflict
requires refreshing; never silently overwrite another change. Never hold DB locks while
waiting for DNS. Bound DNS waits and do not make HTTP calls to a supplied hostname.

Return only display names, revision and service status. No tunnel configuration or keys.
Delayed browser replies must not survive account/venue changes. Treat a lost mutation
response as uncertain and refresh status before offering another change.

## Verification

Real PostgreSQL HTTP tests: owner/non-owner/cross-organisation, CSRF/origin/session,
rate limit, bounded DNS failure, reserved names, conflict, revocation during DNS and
lost reply reconciliation. Existing operator placement tests must remain green.
Controller tests: stale replies, cooldown and uncertain result. English/Spanish real
browser journeys at phone width, light/dark, accessible forms and DNS records; inspect
screenshots. Finish with one isolated run-it review, focused fixes, exact-head CI and land.
