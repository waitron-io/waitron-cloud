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
