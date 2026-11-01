# Cost-mail reconciliation investigation

Related investigations: [reset-mail capture](../backlog.md#portal-reset-mail-boundary-reporting) and
[Mailpit fixture startup](../backlog.md#cloud-cost-mailpit-fixture-startup).

## Cost-mail reconciliation refusal observed during D262

[PR #467's cost job](https://github.com/waitron-io/waitron-cloud/actions/runs/40201247616/job/121192744128)
fails `genuineEmailQueueRetryAndBilingualMailpitDeliveryReconcileWithoutRawExport`
at the measurement close check in `scripts/cloud-cost/mail.mjs`, called from
fixture line 65. The original generic error cannot distinguish invalid state
from disagreement between the mailer and the independently observed SMTP replies.
The following signup/recovery mail case passes. The cause remains unknown;
D262's heading fix is merged in [PR #467](https://github.com/waitron-io/waitron-cloud/pull/467).

Close errors now retain the first fixed failure label, the invalid-state flag
and both count sets. You can distinguish an empty run, delivery disagreement,
malformed SMTP, timeout, cancellation and closing during delivery without
exporting message bodies, addresses, delivery IDs or raw transport errors.
Native tests reproduce these diagnostic paths with generated SMTP traffic and
prove later cleanup preserves the first failure. They do not identify the
historical refusal. Three inspected failed main runs have passing mail jobs.

### Linux reproduction qualification, 1 November 2026

You can run the unchanged two-case fixture on the authorised Linux test box:

```sh
node scripts/test-postgres.mjs exec node --test --test-timeout=120000 \
  scripts/cloud-cost/fixtures/mail-conformance.test.mjs
```

At Cloud revision `0345c2146b53501365faed720b7413a25fab9cd2`, both cases pass
without skips. The queue/retry case takes 2.185 seconds and reconciles four
attempts: one refused, three accepted and one retry. The signup/recovery case
takes 2.205 seconds and reconciles three accepted operations. The original
failure took 4.446 seconds; this passing run does not explain that difference
or establish a repair. The existing 20 controls in
`node --test scripts/cloud-cost/mail.test.mjs` also pass on Linux and macOS,
including the bounded close-error diagnostics.

The complete conformance test, local mailer, email outbox and dependency lock
match historical failed head `7076a50886d4ef5d908b318529a7decfada21563`
byte for byte. The mail observer has since gained diagnostics, while migration
and PostgreSQL setup code have other changes. This run executes the fixture
directly; it does not repeat the historical conformance preparation, runner
scheduling or complete environment. Neither original assertion nor deadline
changes. The test-box copy is removed after the run.

Keep the cause open. On the next labelled recurrence, use the close error's
first reason and independent counts to locate the refusal. A timeout, protocol
failure and disagreement after an accepted reply need different reproductions.
Reproduce the reported boundary before changing delivery, then fix it test-first.
Preserve measurement guards, accounting and deadlines. Do not repeat these
passing baselines without new evidence. This investigation remains separate
from reset-mail capture and Mailpit fixture startup.

Return to the [backlog index](../backlog.md).
