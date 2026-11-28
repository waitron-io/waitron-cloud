# D643 public customer menu implementation plan

A phone on mobile data can open a read-only menu at its test venue’s assigned or custom HTTPS name. After switch-off, a fresh request gets 404 within one minute. Connected and Hosted qualify, including trials. The watcher assigned Cloud’s work on 25 November. [Customer-menu design](https://github.com/clintongormley/waitron/blob/bd5d2dbf1976ede08efc2ebaf0e01b9063aaf884/docs/superpowers/specs/2026-11-24-customer-menu-design.md) · [Joint design](https://github.com/clintongormley/waitron/blob/bd5d2dbf1976ede08efc2ebaf0e01b9063aaf884/docs/superpowers/specs/2026-11-25-customer-menu-public-access.md)

**Test cut, 25 November 17:20.** Cloud forwards the box’s cache headers. Pages and data have at most 60 seconds of total freshness, including upstream age. Keep the content-named asset lifetime. Cloud caching, including photos, is due before production. During takeover the withdrawn route can briefly refuse TLS or return 421. An explicit venue block stays until lifted.

## PR 1a. Venue block and private authority

Build now. Reuse `readGuestMenuRelease` in the private account worker, with opt-in `test-venue-levels` and both test Compose files. Admit eligible non-blocked venues. Bound authority reads to four in flight with a short wait inside one second. Make the owner block and test switch work without `GUEST_ORIGIN` or a saved menu. Change the account app and server, `account-http/src/{guest-menu,remote-access}.ts`, and portal `remote-{types,controller,screen}.ts` and `locale.ts`. The reader tests eligibility, trials and blocks. `account-http/test/guest-menu.test.ts` tests the owner check. `apps/portal/test/guest-menu-browser.test.ts` tests the control. Estimate 120 code and 80 test lines.

## PR 1b. Disabled gateway

Build now with a synthetic TLS box and an injected path matcher. Change `public-gate.ts`, `gateway-cli.ts`, `config.ts` and `public-gate.test.ts`. Leave routed menu paths at 404 by default. Refuse enablement with signed metering before network startup. Count menu traffic separately from availability and keep the browser challenge off menu paths. Serve readable 404, 429 and 503 pages.

Match Host and TLS name to the signed route. Allow only GET and HEAD, verified with the staff name upstream. Allow framing on menu pages. Forward approved headers and stream bytes without cookies. Recheck the block and signed route when upstream headers arrive. Start with four forwards per venue, 16 globally, five seconds of upstream inactivity and 2 MiB per reply. Allow a short wait for a forward slot and hold it until the reply finishes or closes, with a slow-reader deadline. Test admit, refuse and read failure here. Estimate 145 code and 100 test lines.

## Disabled gateway redirect follow-up

A synthetic box can redirect a visitor to the published menu’s default
language. The browser follows the 302 on the public hostname so its address
bar shows the language URL. The 28 November 04:46 watcher note supplies the
route contract. Stock gateways still start with live menus disabled.

In `packages/remote-access/test/public-gate.test.ts`, add the root, menu and
language paths to the loopback fixture’s page matcher. First show a valid 302
fails today. Check the relative Location, 60-second cache cap, upstream Age
and Vary, and that a new public request reaches the target page. Check refusal
for destinations outside the public menu, including one with a backslash.
Check that a block at the second authority read suppresses the 302.
Run `pnpm --dir packages/remote-access exec node --test test/public-gate.test.ts`
and observe the valid redirect assertion fail before implementation.

In `packages/remote-access/src/public-gate.ts`, handle a 302 from a page after
rechecking route and authority. Require a Location shaped as `/`, `/<address>`
or `/<address>/<language>`, with only letters, digits and hyphens in segments.
The menu matcher must admit it as a page and it must be outside the availability
paths. Send an empty 302 with Location, the existing page cache policy and
Vary, `nosniff` and `no-referrer`. Use the existing 503 for a 302 outside the
contract. The browser’s new request takes the normal authority path. Run the
gate test file and `pnpm typecheck`. Mention the verified relative redirects
in the D643 backlog entry. Estimate 20 product and 45 test lines.

## PR 1c. Pair and enable

Plan from A1637 once its listener and paths are on Waitron main. Admit query strings on the three page routes for the box to remove with a relative 302. Keep assets and photos query-free. Use the exact listener paths, port 8443 and photo sizes from A1637. Check request and HAProxy connection limits with four phones on the same venue Wi-Fi opening the photo menu in one minute. Prove mobile publish and switch-off, block, takeover, asset continuity, outage and till responsiveness under load. The owner reconnects the promoted box and chooses Allow sharing if Remove blocked the legacy copy. Enable on unmetered test gateways. The dashboard’s Online link belongs to A1639. Estimate 45 code and 75 test lines. Each cut aims to open within three hours of active work.

## PR 2. Retire the hosted copy

After paired proof, close old publication, remove `/m/<venue>` and its copy controls, then reserve a migration to clear pages and keep blocked rows in the same table. Update Remove’s automatic takedown and `guestMenuShared` in `installations.ts`. Check `proxy.amazon.cfg`, `bootstrap.mjs`, both runtimes, `server-cli.ts`, `server.ts`, `app.ts`, `guest-menu.compose.yaml`, `.env.example` and the language preference and match modules. Remove signed copy actions jointly after Waitron #4266. Update the test guides, backlog and integration contract. Estimate 160 code and 100 test lines.
