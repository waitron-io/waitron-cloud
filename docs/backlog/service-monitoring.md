# Service monitoring

Check representative operations from outside the affected
cell; track errors, response times, queued work, backup freshness and capacity.
The public HTTPS probe refuses any `Domain` attribute on its challenge cookie,
including empty and bare forms that some browsers ignore. Real TLS fixtures
fixtures reproduce the former false healthy result and check that refusal stops
before cookie replay. The host-only control and actual public gateway journey
still pass. Run `node --test packages/remote-access/test/probe.test.ts` without
PostgreSQL. This qualifies local protocol validation, not production monitoring.
The probe also checks the last `Path` attribute before replaying the cookie.
Native HTTPS cases reproduce false healthy results from overwritten root paths
and no-break spaces that broad whitespace trimming wrongly removes. Chromium
checks confirm the refusal and valid root/ordinary-whitespace controls. Rejected
cookies never reach availability; the genuine gateway challenge still passes.
This corrects local monitoring, not production qualification.
Immediately deleting `Max-Age` values now refuse before replay. The probe
follows Chromium's last-attribute precedence and 1,024-byte value limit,
including signed zero. Real HTTPS regressions and independent Chromium
controls cover deletion, replacement, malformed values and whitespace.
Positive/session cookies and the genuine gateway journey still pass.
Path selection also ignores values over 1,024 bytes before choosing the last
effective attribute, matching Chromium. Real HTTPS regressions and independent
Chromium controls cover the size boundary, replacement, whitespace and equals
signs. An earlier non-root path still refuses before replay, and a valid root
still succeeds. The final effective `Expires` now also refuses before replay
when its parsed date has passed. Real HTTPS cases and independent Chromium
controls cover legacy date forms, invalid dates, duplicate and oversized values,
server clock differences and valid `Max-Age` precedence, including saturated
signed values. Session cookies and the genuine gateway challenge still pass.
Cookie-part whitespace now uses only ASCII space and tab. No-break spaces
around the cookie name/value or required `Secure`, `HttpOnly` and
`SameSite=Strict` tokens refuse before replay. Real HTTPS regressions preserve
ordinary spaces, tabs, mixed case and unrelated attributes. Independent
Chromium controls reject malformed Secure cookies and retain valid controls.
The probe now requires the final effective `SameSite` value to be `Strict`.
A later weaker, empty or invalid value refuses before replay, even when an
earlier attribute says Strict. Real HTTPS regressions and independent Chromium
controls cover precedence, ASCII whitespace, case and oversized values.
Secure and HttpOnly flags now accept values, matching Chromium, so a valid
protected challenge no longer produces a false unhealthy result. Values over
1,024 bytes are ignored; missing effective protection still refuses before
replay. Real HTTPS and independent Chromium controls cover values, duplicates,
ASCII whitespace and the size boundary. These are local protocol checks;
production observation remains unqualified. Root `Path` attributes now accept
ASCII spaces and tabs around `=`, matching Chromium, without requiring another
literal `Path=/` attribute. Real HTTPS cases and independent Chromium controls
cover replacement, ignored oversized values and missing or invalid paths.
The last effective path must still be `/`; refused cookies never reach availability.
Domain-name recognition now trims only ASCII spaces and tabs, avoiding false
unhealthy results from unrelated names containing no-break spaces. Real HTTPS
regressions preserve refusal of genuine Domain attributes, including empty/bare
forms and real/lookalike pairs. Chromium controls confirm that the unrelated
names leave protected cookies usable; bare/empty refusal is the probe's policy.
Configured asynchronous probe connection resolvers now share the probe's
cancellation wait and overall deadline. The probe rechecks cancellation before
invoking a queued resolver and before starting TLS or HTTP work. A resolver
that never returns cannot keep the probe waiting after cancellation or timeout.
Native trusted TLS/HTTPS cases cover cancellation boundaries, pending and
rejected resolution, the unchanged deadline and successful deferred resolution.
Live DNS and production shutdown still need separate qualification.
If a probe result cannot be stored, the runner stops starting targets or
delivering further results. It waits for already-started probes and writes
before reporting the first failure, so the caller can close shared resources.
Native ordering tests cover pending probes, concurrent writes, later success
or failure, and an error reporter that throws. Production shutdown and real
database-failure qualification remain separate.
The staff TLS check now flushes its handshake and releases its connection after
certificate verification, even if the peer keeps its write side open. Native
child-process regressions reproduce the former successful probe that could not
exit, and verify completion with finished TLS 1.2 and 1.3 server handshakes.
Existing certificate, trust, hostname, cancellation and deadline checks remain.
Native child-process checks also cover timeout and cancellation while the
staff handshake and public HTTPS response remain unfinished, both before
response headers and during the body. Each probe reports the expected failure,
and its process exits while the peers keep their write sides open. Removing
any of the four failure cleanup operations makes the checks fail. Production
shutdown qualification remains open.
The [D103 C39 threshold design](../superpowers/specs/2026-10-22-cloud-monitoring-thresholds-design.md)
separates existing local detection from proposed production operator alerts and
opted-in venue mail, with worked outage and backup timelines. The owner approved
the full design on 2026-10-22 around 08:35 for planning only. The separate
[C39 implementation plan](../superpowers/plans/2026-10-22-cloud-monitoring-thresholds.md)
is published for owner plan approval; implementation is unbuilt. The exact daily
schedule, first monitored group and separate build authority remain gated. New
database work must recheck active reservations and the inventory after migration
043. Production observation and phone delivery still need independent qualification. No production alerting or recovery
guarantee follows. The [C41 release/upgrade proposal](../superpowers/specs/2026-10-22-cloud-release-upgrade-design.md)
is published, unapproved and unbuilt; C60 compute remains separate.
D104's [incident runbook](../incident-response.md) now records
sole-owner phone response, private investigation/access boundaries, bilingual
public updates, verified closure and launch drills. It recommends Cloudflare
Pages Free with Direct Upload and a directly usable public `pages.dev` fallback
outside Waitron's AWS. This is a documented procedure and host proposal only:
phone provider/independent delivery-failure handling, account/page setup, supplier
metadata review and live outage/coverage-gap proof remain open. Hands-on setup
waits for the owner's return on 3 November; ask before any paid service. D102's
SES feedback, suppression, alerts and live qualification remain open.
Optional quiet periods and one still-open reminder are implemented with both timings
disabled by default. Each incident opening captures its original recipients and fixed
database deadlines. The portal remains immediate; brief incidents recover silently.
Local PostgreSQL and independent-process tests cover concurrent delivery, current
authority/evidence, late accepted-opening recovery, replacement/suppression/reopening,
protected bounded cleanup and rollback of a second 100-recipient batch. Encrypted mail
retains English/Spanish rendering and retries use one durable notification identity.
A populated 36-to-37 rehearsal proves interrupted migration rollback, repeated/concurrent
retry, unchanged old account/factor/relay state and both pre-upgrade and post-upgrade
backups. Restored deadlines/recipients remain fixed and wrong/missing email keys refuse
delivery. SMTP uncertain acceptance can still duplicate sends. The
[design](../superpowers/specs/2026-10-13-monitoring-quiet-escalation-design.md) and
[plan](../superpowers/plans/2026-10-13-monitoring-quiet-escalation.md) record the scope;
the local packaged install, restart and rebuilt upgrade each use all 37 migrations
and leave no project containers, networks, volumes or image. C39's quiet/reminder,
escalation and monitoring-cohort policy is approved for planning. The
[implementation plan](../superpowers/plans/2026-10-22-cloud-monitoring-thresholds.md)
awaits plan approval; implementation, enablement and deployed external checks remain open.
The [local monitor](../local-monitoring.md) now records missing contact, stale snapshots
and failed verification for configured test installations. The portal shows incident
evidence and stale monitoring; owners can opt in to English/Spanish email alerts.
Alert preferences can be saved only after a choice changes from the last
confirmed reply. A confirmed save disables Save again; an uncertain save stays
retryable, even after reverting the choices. Pending requests, rate-limit waits
and lost account access keep their existing restrictions.
Durable transition records prevent repeated scans from enqueueing duplicates, with
live ownership/preference checks before delivery and recovery notices for prior
recipients. Queued notices use the current email language. Locked installations and
failed observations defer their next check while other venues continue. SMTP uncertain-acceptance duplicates remain possible. A separate bounded
functional probe now derives current authorised placements, solves the real public
challenge, verifies staff TLS/hostname trust and persists revision-bound evidence
with certificate validity while refusing private production targets. Address-policy
regressions also refuse non-public IPv4 embedded in IPv4-compatible and 6to4 IPv6
addresses and deprecated site-local IPv6, while retaining public embedded targets.
Teredo and local NAT64 prefixes retain their existing refusal. Separate IPv4 and
IPv6 block lists now let direct public IPv4 answers pass the address policy without
matching the mapped-IPv6 refusal. Native regressions cover public addresses, both
ends of every existing refused IPv4 subnet, adjacent allowed addresses, malformed
and mismatched inputs, and mapped-IPv6 refusal. External IPv4-only routing remains
unqualified; the address-policy checks do not establish network reachability.
IPv4-translated `::ffff:0:0:0/96` addresses now apply the same embedded IPv4
refusal as compatible and 6to4 addresses. Native regressions cover loopback,
private and reserved endpoints in hex, dotted, expanded and scoped forms;
public embedded endpoints retain their existing classification. Removing
translated-prefix detection fails those public controls. Actual translated
routing remains unqualified.
Otherwise-unhandled addresses in IANA's reserved `::/8` range now refuse,
including `::1:7f00:1` and translated-prefix lookalikes. Native regressions
cover hex, dotted, expanded and scoped forms and the range boundary. Existing
public embedded-IPv4 exceptions and other prefixes keep their classification;
seven reserved lookalike controls now require refusal. These checks qualify
address filtering only. The probe now also refuses reserved `fe00::/9`
addresses. Native checks cover both ends, its midpoint, expanded, dotted and
scoped forms, neighbouring refusals and preserved public IPv4/IPv6 decisions.
Removing or narrowing the subnet fails the new checks while the original policy
tests pass. The filter also refuses IANA's reserved `4000::/3` range.
Native regressions cover both ends, its midpoint, expanded, dotted and scoped
forms, with existing decisions outside this range preserved. Removing, narrowing
or shifting this subnet fails the new checks. The probe also refuses the seven
adjacent reserved ranges from `6000::/3` through `f800::/6`, ending at
`fbff:ffff:ffff:ffff:ffff:ffff:ffff:ffff`. Native regressions cover each range's
boundaries, midpoint and expanded, dotted and scoped forms. Each missing,
narrower or shifted subnet fails these checks; public addresses and existing
decisions outside these seven ranges retain their classification. The former
`6000::` acceptance check now requires refusal. The probe also refuses the
five lower reserved ranges `100::/8`, `200::/7`, `400::/6`, `800::/5` and
`1000::/4`, including the discard-only and dummy allocations in `100::/8`.
Native regressions cover boundaries, midpoints, expanded, dotted and scoped
forms. Removing, narrowing or shifting each new subnet fails these checks;
embedded public IPv4 and other address decisions retain their classification.
The former `100:1::1` and `1000::1` acceptance checks now require refusal.
The probe also refuses the returned 6bone range `3ffe::/16`, including its
former Teredo allocation. Native tests cover both ends, the midpoint and
uppercase, expanded, dotted and scoped forms. Removing or narrowing this
refusal fails the tests; other address decisions retain their classification.
See the [IANA global-unicast registry](https://www.iana.org/assignments/ipv6-unicast-address-assignments).
Actual routing, loopback reachability and the broader policy for special-purpose
allocations inside global unicast space remain unqualified. See the
[IANA address-space registry](https://www.iana.org/assignments/ipv6-address-space).
The monitor rejects
late results after hostname changes, replacement or revocation, treats stale evidence as
unknown, and records deduplicated route-failure, certificate-expiry and recovery
transitions independently from installation contact. The local two-venue gateway proof
now persists real observations while breaking one venue route and the whole gateway,
proves recovery, stale/invalid-certificate handling, current control contact, portal and
Mailpit evidence, cross-venue isolation and delivery deduplication, and emits a versioned
timing receipt. The [paired gateway comparison](../gateway-reconnection-measurements.md)
now preserves key and endpoint while replacing a gateway with a 30-second-old
peer handshake. Its unchanged-peer controls recovered in 105.912 and 105.845 seconds;
one peer-originated ping recovered in 19.189 seconds, and explicit peer removal/re-addition
plus a ping in 4.297 seconds. Each result requires fresh trusted HTTPS, the intended
response body, an unchanged certificate and newer handshakes at both ends. The
versioned receipt includes empty cleanup and CI refusal checks. These are single
local observations, not deployment targets. Waitron still needs a scoped automatic
appliance trigger and joint outage/active-connection proof; choose and prove the
launch recovery target before making an availability promise. The portal now shows
separate redacted public/staff evidence and certificate warnings in English and Spanish.
Opted-in owners receive bilingual remote
incident and recovery messages; delivery rechecks route authority, and opt-out or
revocation suppresses queued mail. Current incident and observation tables are bounded
current-state projections; terminal delivery links follow the explicit cleanup cutoff.
The local worker-scale receipt now separates scheduling from polling, runs scheduling
once a minute, bounds monitor/email claim batches at four and batches encrypted alert
insertion in groups of 100. On an Apple M5 Pro with 18 logical CPUs, its 1,000-venue/200-recipient
fixture reduced monitor processing from 7,030 ms with 1,001 sweeps to 2,335 ms with one,
queued the bounded incident fan-out in 24 ms and reduced delivery backlog lag from
1,558 ms to 477 ms. A 103-recipient PostgreSQL test enforces two inserts per table.
Locked venues, restart completion and shutdown fencing remained intact. A Docker-free
worker-loop regression now pauses scheduling, requests shutdown and proves that the
schedule finishes without claiming another batch. Removing the post-schedule shutdown
check in a disposable copy makes it fail with four unexpected claims; restoring the
check passes. Runtime code and every earlier worker-loop assertion are unchanged. These
are local measurements and regression checks, not capacity promises. The aggregate operations command now surfaces
the current worker queues and evidence projections through JSON, a readiness exit code
and bounded-label Prometheus metrics. An opt-in local Compose collector now runs
the same inspection on a bounded schedule, exports collection timestamps and failure,
and suppresses expired or failed samples. It checks the full migration ledger
before each inspection and uses read-only transactions. Production collection,
retained time series and alerting remain open. The 2026-09-30 local
[collection receipt](../receipts/2026-09-30-operations-collection.json) proves healthy/degraded
changes, migration-digest refusal, database outage/recovery, restart and read-only
write refusal, with 26 label combinations and empty project cleanup.
Next: choose the terminal-delivery cutoff, repeat the receipt and aggregate checks in
the selected deployment environment, and implement and qualify external representative
checks and the planning-approved C39 quiet/reminder, escalation and monitoring-cohort
pause policy under its [plan](../superpowers/plans/2026-10-22-cloud-monitoring-thresholds.md).
Separate plan/build authority, schedule/cohort decisions and enablement gates remain open.
