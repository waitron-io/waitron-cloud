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

Cloud follow-up: use a labelled recurrence to reproduce and fix the demonstrated
cause, test-first. Keep measurement guards, accounting and deadlines intact.
Do not rerun an unchanged red branch.
Real PostgreSQL/Mailpit reproduction waits for local Docker or a separately
qualified CI diagnostic change. This is separate from reset-mail capture and
Mailpit fixture-startup failures recorded above.

Return to the [backlog index](../backlog.md).
