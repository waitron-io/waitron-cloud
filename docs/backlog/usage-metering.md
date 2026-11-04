# Usage metering

Cloud now records immutable organisation-scoped events for
snapshot storage and transfer, completed installation operations, accepted monitoring
probes and terminal administrative alert outcomes. Bounded reconciliation repairs
interrupted durable-source writes, stable source identities suppress duplicates and
cleanup preserves sources until their events exist. Owner-only portal totals retain
exact decimal precision, show measurement freshness in English and Spanish and state
that continuous-stream bytes and account identity mail are excluded. Byte totals
that round to 1024 use the next unit, up to TiB, in both languages, including negative
totals; larger-than-safe integers keep their exact byte display.
Your usage dates name the month in English and Spanish and keep their original
machine-readable timestamps. A total of one byte, including a negative total,
uses the singular unit; other byte and count formatting keeps its existing rules.
Native formatter and stubbed browser checks cover these displays in both languages,
light and dark, at phone and desktop widths.
`node --test apps/portal/test/usage-format.test.ts` covers these boundaries. Your
installation, probe and alert-outcome counts use your language's number grouping
without losing integer precision, including values larger than JavaScript's exact
number range. Native formatter and stubbed browser checks cover all six count fields
in English and Spanish; byte formatting keeps its separate scale rules. A failed usage
read shows one alert, while a rate-limited read keeps the page countdown. Pending reads
still show their wait message; an idle empty view explains unavailable totals, and a
failed refresh retains earlier totals. Stubbed browser checks cover 503 and 429 replies,
retry and empty states in both languages, light and dark, at phone and desktop widths.
Your heading list groups usage and each venue under “Your venues”, with the four
usage groups nested below “Measured Cloud usage”. Region names, heading text and
visual spacing remain unchanged. The stubbed usage-heading browser check covers two
venues in English and Spanish, light and dark, at phone and desktop widths.
PostgreSQL and browser tests prove retry rollback, tenant isolation and fresh/incomplete
views. This is
observational only. A bounded watch worker now runs in the local deployment, retries
failed passes and exposes stalled progress through existing operations freshness.
PostgreSQL CLI tests cover competing workers, rollback/interruption, restart catch-up,
tenant totals and shutdown. A clean local Compose proof on 2026-09-29 recorded two
organisations automatically, reported all four sources stale after stopping, and
caught up a third organisation after restart; its project containers, volumes and
network were removed. This proves local scheduling, not a production freshness
objective. The extended Compose proof now holds the final source's PostgreSQL row
lock and stops the service with earlier writes still uncommitted. On 2026-09-29,
it exited normally in 9,657 ms within the 15,000 ms Compose grace period, left
committed events and every source timestamp unchanged, then caught up two new
organisations without duplicates. The ten-second transaction deadline remains;
extending both database deadlines in a disposable copy made Compose kill the
worker (exit 137), which the proof rejected. Project cleanup was empty.
Production deployment and monitoring remain open. Next: add
attributable lookup/API, report and compute units when those services exist, measure
provider costs, then define allowances, excess-use and metering-outage policy before
connecting any total to billing or enforcement.

## Usage-read transport refusals and retry waits (D434, D436)

If a usage read loses its reply, your earlier totals remain available during an
explicit retry and after another failure. A successful read replaces them;
permission loss or a changed account or organisation clears them. Native
HTTP/client/controller checks cover unreadable replies, valid-looking totals
carried by refused responses, duplicate reads and exact seconds/date retry
boundaries through navigation. Run
`node --test apps/portal/test/usage-transport-boundary.test.ts`.

Your usage retry wait measures elapsed time, so changing your system clock
cannot lengthen, bypass or revive it. HTTP-date waits use the response's `Date`
when valid, otherwise your clock at receipt; past dates give no wait. The usage
wait contributes its remaining delay to the app countdown; another panel may hold
that countdown for longer. Native clock checks and
English/Spanish browser checks at 390 and 1280 pixels in both themes cover these
boundaries. Run `node --test apps/portal/test/usage-retry-clock*.test.ts`.
The shared countdown also has dedicated English/Spanish browser checks in both
themes at 390 and 1280 pixels: the longer of a usage wait and an alert wait stays
visible until its own expiry. When usage is ready first, you can refresh its totals
without clearing the remaining alert wait. Run
`node --test apps/portal/test/usage-shared-countdown-browser.test.ts` (D444).
Usage and alert retry waits both use elapsed time and contribute their remaining
delay to the shared countdown. Backup catalogue waits also use elapsed time. The
installation, diagnostic, remote, recovery and translation-consent waits now measure elapsed time too. Their request gates and shared countdown keep a live wait through clock corrections and never revive an expired wait. HTTP date waits use the server Date header when available, and reading the response body consumes the original wait. Run `node --test apps/portal/test/panel-retry-clock.test.ts apps/portal/test/panel-retry-clock-browser.test.ts` for native and bilingual browser controls. Passkey, authenticator, account-security, session/logout and email waits now measure elapsed time too (D562). Moving your clock forward cannot bypass a live wait, and moving it backward cannot extend or revive one. The shared countdown and authenticator buttons use the same remaining wait as the request gates. The one-minute session activity throttle also measures elapsed time; session expiry remains the server's timestamp. Successful email requests retain their per-address, per-operation minute-long cooldown through navigation. Account HTTP-date waits use the response Date header when available, and body-reading time consumes the original server wait. Run `node --test apps/portal/test/account-retry-clock.test.ts apps/portal/test/account-retry-clock-browser.test.ts` for native controls and English/Spanish browser checks in both themes at 390 and 1280 pixels. Server authority and production metering remain separate
qualification gates; database suites run in CI while local Docker is unavailable.
