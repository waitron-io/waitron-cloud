# D643 public customer menu implementation plan

A phone on mobile data can open a read-only menu at its test venue’s assigned or custom HTTPS name. After switch-off, a fresh request gets 404 within one minute. Connected and Hosted qualify, including trials. The watcher assigned Cloud’s gate and retirement under the [joint design](https://github.com/clintongormley/waitron/blob/bd5d2dbf1976ede08efc2ebaf0e01b9063aaf884/docs/superpowers/specs/2026-11-25-customer-menu-public-access.md) at 15:24 on 25 November. Production and ordering are outside this test cut.

**Joint design update, 25 November 17:12.** The watcher chose forwarded cache headers with at most one minute for pages and data and an authority check on every request. The test cut accepts a brief TLS refusal or 421 while the route is withdrawn. Remove withdraws the route. A separate venue block stays until lifted. Revisit page storage at the gateway only if box measurements call for it.

## PR 1. Gate and paired delivery

After watcher clearance, including how the older A951 contract applies, build the private authority read and disabled gate against a synthetic TLS box and injected path matcher. Fail the focused cases in `packages/remote-access/test/public-gate.test.ts` before implementing in `public-gate.ts`. In `gateway-cli.ts`, one optional authority URL enables menus. Unset returns 404 on routed hosts. Refuse menu enablement with signed metering before network startup. Count menu requests separately from availability reports and publish only on unmetered gateways until trial usage can exclude menu bytes.

The unexposed test account listener reuses `readGuestMenuRelease` through `account-worker.mjs`, `runtime.mjs` and both test Compose files. In `test-venue-levels` mode, it admits eligible venues unless blocked, with four reads in flight and a bounded wait inside one second. The gateway checks every reply after buffering and rechecks the signed route. `remote-access/test/guest-menu.test.ts` covers trial and block admission.

Keep the owner block and test switch available without `GUEST_ORIGIN` or a stored copy. Update the account app and server, `account-http/src/{guest-menu,remote-access}.ts`, and portal `remote-{types,controller,screen}.ts` and `locale.ts`. Verify the owner check and control in `account-http/test/guest-menu.test.ts` and `guest-menu-browser.test.ts`.

### Pair before opening PR 1

Wait for Lane D’s Structure and Lane K’s published view, paths and queries, port 8443 listener and tunnel, largest rendition and Online link. Match Host and TLS name to the signed route. Forward only GET/HEAD to its tunnel address, using the staff hostname for Host and TLS verification. Allow framing on menu pages. Pass approved headers and binary bytes, with no cookies. With a route, off, missing, ineligible or blocked gets 404, and upstream or authority failure gets 503. A withdrawn route can refuse TLS or return 421.

Start at 120 requests/source/minute, four forwards per venue, 16 globally, five seconds of inactivity and 2 MiB per response. Return 429 at gate saturation. Check those bounds and HAProxy’s earlier per-source connection limits with K’s photo menu and shared addresses. Forward the box’s cache headers with at most 60 seconds of total page/data freshness, including upstream age. Preserve the content-named asset lifetime.

Prove mobile publish/off, a block, takeover, asset continuity and outage over HTTPS. The owner revokes the old box, connects the promoted one and chooses Allow sharing if Remove blocked a current legacy copy. Check a busy till under flood with K. Estimate 250 code and 165 test lines, including the private read and independent control missed by the joint estimate. Aim for three hours of active work to open the PR.

## PR 2. Retire the copy

After paired proof, remove `/m/<venue>`, its listener and copy-only portal controls. Close the old publish endpoint before a new migration clears saved pages and preserves blocked rows. Keep the live block. Remove signed copy actions jointly after [Waitron #4266](https://github.com/clintongormley/waitron/pull/4266). Update the [backlog](../../backlog/guest-menu.md), integration contract and test guides. Estimate 140 code and 100 test lines, under three hours to open the PR.
