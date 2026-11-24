# Service monitoring

Check representative operations from outside the affected cell; track errors, response times,
queued work, backup freshness and capacity.

Built locally: the [monitor](../local-monitoring.md) with bilingual incidents and opt-in alerts,
the public/staff route probe with its cookie and address-policy checks, the
[custom DNS notice](../local-monitoring.md#run-the-monitor), quiet periods and one reminder
([design](../superpowers/specs/2026-10-13-monitoring-quiet-escalation-design.md), both timings off
by default), and the aggregate [operations collector](../operations-status.md). None of it is
production alerting or a recovery guarantee. SMTP uncertain acceptance can still duplicate a
notice.

**Decisions.** The owner approved the full [D103 C39 threshold design](../superpowers/specs/2026-10-22-cloud-monitoring-thresholds-design.md)
on 2026-10-22 around 08:35 for planning only. The
[C39 plan](../superpowers/plans/2026-10-22-cloud-monitoring-thresholds.md) is published for owner
plan approval; implementation is unbuilt. The exact daily schedule, first monitored group and
separate build authority remain gated, and new database work must recheck active reservations.
The [C41 release/upgrade proposal](../superpowers/specs/2026-10-22-cloud-release-upgrade-design.md)
is unapproved and unbuilt; C60 compute is separate. D104's [incident runbook](../incident-response.md)
is a documented procedure and host proposal only; hands-on setup needs separate owner authority,
including any paid service.

**Open:**

- D104: phone provider and independent delivery-failure handling, account and page setup, supplier
  metadata review, live outage and coverage-gap proof. D102: effective provider permissions,
  independent alerts and live qualification ([offline validation](../ses-feedback-qualification.md)).
- Production observation, collection, retained time series, alerting, the terminal-delivery
  cutoff, and repeating the collection receipt and aggregate checks in the selected environment.
- External representative checks and the C39 quiet/reminder, escalation and cohort-pause policy.
- Live DNS, external IPv4-only and translated routing, loopback reachability, the broader policy
  for special-purpose allocations inside global unicast space, production shutdown of probes and
  real database failures.
- Gateway replacement: the [measurements](../gateway-reconnection-measurements.md) are single local
  observations. Waitron needs a scoped automatic appliance trigger and a joint
  outage/active-connection proof; choose and prove the launch recovery target before promising
  availability.
