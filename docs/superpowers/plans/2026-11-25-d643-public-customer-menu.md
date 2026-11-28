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
language paths to the loopback fixture’s page matcher and send root requests
to the fake menu responder. First show a valid 302
fails today. Check the relative Location, 60-second cache cap, upstream Age
and Vary, and that a new public request reaches the target page. Check refusal
for a destination with a backslash, the availability page and a menu address
the matcher refuses. Each case exercises one separate rule.
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

After D621 pairs the designated test box to the shared Test Cloud, check that
it runs Waitron `c894f87` or later. The LAN check gates this code pull request.
The public rehearsal repeats the check on the shared Amazon Test Cloud using
`compose.amazon.yaml` in step 2 below, with the owner’s phone on mobile data.
[A1637 contract](https://github.com/clintongormley/waitron/blob/c894f87f4ec4573f567fd3a1db2c6e5538a50c8c/docs/superpowers/plans/2026-11-28-h-a1637-public-customer-menu.md) · [Box listener](https://github.com/clintongormley/waitron/blob/c894f87f4ec4573f567fd3a1db2c6e5538a50c8c/apps/server/src/customer-menu-public.ts) · [Cloud redirect](https://github.com/waitron-io/waitron-cloud/commit/b73fee23d5a17bcf81bf2a2c28ee90e3e07ce2b0)

1. In `packages/remote-access/src/public-gate.ts`, classify the raw path before
   the first `?` without decoding or normalising. Keep Cloud availability and
   challenge paths reserved even with queries. Admit GET and HEAD for `/`,
   `/<address>` and `/<address>/<language>`. An address matches
   `[a-z0-9][a-z0-9-]{0,62}` and cannot end in a hyphen. A language matches
   `[A-Za-z0-9-]+`. Pass page queries intact for the box’s relative 302.
   Under `/_customer-menu/`, admit flat filenames in `assets/` using letters,
   digits, dots, underscores and hyphens, excluding `.` and `..`. Admit
   `favicon.ico`, `favicon.svg`, `apple-touch-icon.png` and
   `photos/v1/<64-lowercase-hex>.<jpg|png|webp>/<square|display>/<x>-<y>-<zoom>.webp`
   with canonical decimal integers. Reject asset and photo queries in Cloud.
   The box checks exact files and recipes.
2. In `packages/remote-access/src/{gateway-cli,config}.ts`, wire the matcher to
   the signed tunnel address at 8443 with the staff TLS name and Host. Reuse
   both authority checks with private GET to
   `http://10.79.0.3:3445/guest-menu/<signed venue ID>`. Use the gate’s
   cancellation, a one-second deadline and `redirect:'error'`. Only 204 allows.
   A 404 denies. Other results produce 503. Keep forwarding opt-in via
   `GATEWAY_LIVE_GUEST_MENU=1`. Before network startup, refuse it with
   `NODE_ENV=production`, outside test venue mode or with signed metering.
   In `deploy/test-cloud/{runtime.mjs,compose.yaml,compose.amazon.yaml}`, wire
   the flag only to the test gateway. Pass the existing account switch and
   test venue mode through the LAN layout. The private authority port stays unpublished.
3. First fail `packages/remote-access/test/public-gate.test.ts` on a page query.
   Check all three page shapes, exact query bytes and relative 302, the asset
   boundaries and signed venue authority. Test the eligibility reader’s answers
   once at that reader. A 204 allows, a 404 denies, and a redirect, other failure
   or timeout returns 503.
   Check production refusal beside signed metering refusal. Extend
   `deploy/test-cloud/{runtime,deployment}.test.mjs` for separate gateway opt-in
   and private port wiring. The page-query check now expects 302. The LAN
   render now passes the account flag to the account service. Run the focused
   cases and `pnpm typecheck`.
4. Use a synthetic menu to check assigned and custom names, a query redirect,
   and the venue block on the paired LAN setup. Switch sharing off in Waitron
   and confirm a fresh request gets 404 within one minute. Record status, elapsed
   time and how many requests one photo-menu open uses from the 120-per-minute
   limit per address.
   For the [shared Amazon Test Cloud](../../test-cloud.md#configure-a-separate-https-test-name)
   rehearsal, repeat the checks on the owner’s phone using mobile data. Before
   enabling beyond that single-phone rehearsal, qualify upgrade, takeover,
   outage, four phones sharing Wi-Fi, and sale and till image timing.
   Update `docs/backlog.md` and `docs/test-cloud-service-controls.md`.

Allow 65–95 product and 95–130 test lines. Dashboard work stays with A1639.
Hosted retirement, gateway caching and production rollout are later work.

## PR 2. Retire the hosted copy

After paired proof, close old publication, remove `/m/<venue>` and its copy controls, then reserve a migration to clear pages and keep blocked rows in the same table. Update Remove’s automatic takedown and `guestMenuShared` in `installations.ts`. Check `proxy.amazon.cfg`, `bootstrap.mjs`, both runtimes, `server-cli.ts`, `server.ts`, `app.ts`, `guest-menu.compose.yaml`, `.env.example` and the language preference and match modules. Remove signed copy actions jointly after Waitron #4266. Update the test guides, backlog and integration contract. Estimate 160 code and 100 test lines.
