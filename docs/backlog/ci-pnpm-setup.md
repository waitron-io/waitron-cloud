# CI pnpm setup

## Nested package installs (D530)

An offline nested install also failed in [run 41792705294, root partition 4](https://github.com/waitron-io/waitron-cloud/actions/runs/41792705294/job/126450587544).
The translation-vector audit test could not find `undici-types@7.18.2`, although
the initial install reported downloading all 162 packages. The same job passed
on main in run 41499801321 and on the concurrent documentation branch in run
41792656841. Lane G previously recorded that missing tarball in a cache-only
test-box control on 31 October. The same refusal reached
[main again](https://github.com/waitron-io/waitron-cloud/actions/runs/41797930675/job/126466887370).
An empty disposable store reproduces `ERR_PNPM_NO_OFFLINE_TARBALL` before the
audit can check its vector. One control names the same `undici-types` version;
others name different missing packages, depending on which pnpm reaches first.

The audit fixture now copies the parent's installed dependency directories into
its own checkout, so it needs neither cached downloads nor registry access.
Relative links keep workspace imports inside that checkout, and copied dependency
files can change without changing the parent. Run
`node --test scripts/ci-audit-fixture-dependencies.test.mjs` to exercise the real
audit with an empty store and an unavailable registry, plus candidate source and
dependency isolation. Its original setup-status, vector, planner, mismatch and
restoration assertions and deadlines remain. The three original audit cases and
two initial controls pass on Linux. Why the nested install could not find that
package in the store remains unknown; this change removes that store from the
audit's prerequisites. The helper also refuses missing, empty or linked root
dependency directories and linked workspace dependency directories.
The helper enumerates the two workspace roots explicitly. Its exact reviewed
version now has a [package reader declaration](../ci-package-readers.md), because
it copies installed dependencies rather than discovering tracked source. Both
saved trees must match that version; changed and unknown readers keep full
package work. The live refusal control supplies an explicit unknown reader and
retains its original assertions. Missing-target dependency links are refused too.

The remote-access and portal guard fixtures use the same installed copies. Their
twelve report omissions, twenty-nine collection guards and nine portal omissions
retain every denial check and deadline. A setup refusal includes decoded child
output, signal and process errors in the assertion message, so TAP and the
ordinary reporter can show its reason. Cold-store controls exercise an original
denial in each fixture; separate failed-child controls require readable stdout,
stderr, killed-child and missing-executable reasons. Candidate patches remain
binary-safe, including uncommitted non-UTF-8 bytes. The historical package in
[the remote-access failure](https://github.com/waitron-io/waitron-cloud/actions/runs/41804574176)
is still unknown because its Buffer output was truncated. A controlled cold-store
run names `undici-types` 7.18.2; that does not recover the lost historical output.

The two manual diagnostic workflows, `password-derivation-diagnostic.yml` and
`relay-counter-diagnostic.yml`, still install nested checkouts from the offline
store. Their cold-store behaviour is unqualified; they remain outside this fixture
repair. The independent cache-upload stall also remains open.

The package-test and grouped receipt steps now pass the same package token as the initial install.
You need that token when a test installs dependencies in a temporary checkout
and pnpm must fetch a private tarball. The unsharded, grouped and sharded test
steps receive it explicitly; workflow permissions remain `packages: read`.
The same GitHub token also has the workflow's existing read access to repository
contents, Actions and pull requests. The receipt suites now inherit that token;
this change adds no permission or write access.

The grouped receipt step had the same missing binding in
[run 41814030751](https://github.com/waitron-io/waitron-cloud/actions/runs/41814030751/job/126520320891)
and [run 41817007161](https://github.com/waitron-io/waitron-cloud/actions/runs/41817007161/job/126530905441).
Both retained setup-node's placeholder token, and the venue basic mail guard's
nested install refused the private tarball before its assertions ran. The same
cold-store loopback control now covers that step too: the checked-in binding
passes through the real receipt runner, pnpm script and descendant installer,
then loads the package after the placeholder gets a 401. This fixes
the missing credential at that boundary; why those jobs needed a fresh download
after the initial install remains unknown. Keep the original signup/reset
omission checks and all install, test and job deadlines.

In [run 41461747571, job 125332453331](https://github.com/waitron-io/waitron-cloud/actions/runs/41461747571/job/125332453331),
`installation venue guards detect all six omissions` failed before its assertions:
the nested install received a 401 for `@waitron-io/ui-core` 0.1.0. The initial
install had the package token, but the test step retained setup-node's placeholder.
The native `node --test scripts/ci-nested-install-auth.test.mjs` control uses a
fresh store, a loopback registry and a synthetic token. Each test-step binding
first refuses the placeholder with 401, then installs and loads the package with
the configured credential. The registry receives only a synthetic credential. Existing
tests, permission checks, retries and deadlines stay unchanged.

Why that historical job needed another fetch after its initial download remains
unknown. The separate lifecycle proof's checkout failure remains unattributed;
this does not establish that it was another 401. Its failure record now identifies
the old or new release and whether cloning, checkout or installation failed,
with a bounded exit status, signal and process error code. Arguments, paths,
child output and environment values stay withheld. Native CLI controls force
each of the six boundaries to refuse and cover a missing executable and a
signal termination. Keep the next labelled recurrence to identify the underlying
command failure; a passing qualification does not explain the historical cause.

## Bootstrap transport failures and bounded recovery (D154)

Bootstrap setup now gives npm
registry requests 15 seconds with one retry after one second, so a stalled
tarball fetch cannot consume minutes before tests start. A real local `npm ci`
against a held tarball request exceeds 35 seconds under the defaults and fails
in about 31 seconds with these settings, after two attempts. The setup action
receives this policy in every CI job; project installation, auditing and all
test/job deadlines stay unchanged. This is a per-request limit, not a total
bootstrap deadline. In run 38803777952, bootstrap npm reported a five-minute
installation and the account shard was later cancelled before completing.
Its log does not identify the slow request, so do not attribute it to a
particular registry endpoint or to a product test. Preserve bootstrap timing
and npm diagnostics if setup overruns recur. A separate
[merge run 39650584401](https://github.com/waitron-io/waitron-cloud/actions/runs/39650584401/job/119397690795)
refused registration partition 3 before tests: the action's locked pnpm 11.19.0
bootstrap could not verify `@pnpm/exe@9.15.0` signature metadata, reporting
`ERR_PNPM_PNPM_ENGINE_IDENTITY_UNVERIFIABLE` with `terminated`. The pinned
verifier classifies that error as unreachable metadata, rather than a completed
invalid-signature check. A fresh disposable Linux bootstrap with the exact
action lock later completed the switch and printed 9.15.0 with verification
intact; it does not explain the original termination. Capture the failing
HTTP stage and registry response if it recurs, then evaluate bounded recovery
while preserving signature verification. A later successful run is recovery
evidence, not a code fix. The same error class recurred in merge run
[40022323542, backups partition 2](https://github.com/waitron-io/waitron-cloud/actions/runs/40022323542/job/120649947311):
pnpm 11.19.0 refused the switch to 9.15.0 after signature verification of
`@pnpm/linux-x64@9.15.0` terminated. No backup tests ran in that job. Retain
verification and capture the missing HTTP stage before choosing a repair;
neither the underlying cause nor a connection to portal changes is established.
D154 adds a read-only observer to pnpm setup in every Cloud workflow.
It records fixed package-metadata endpoints, HTTP status, interrupted
metadata transfers, child exit or signal, and the final process exit. Each Node
thread has separate limits for normal, failure and child records. It
omits URL credentials, hosts other than the public npm label, queries, headers,
bodies, command arguments and raw error messages. Process and worker identities
distinguish parallel verification requests. A controlled cut-off response
reproduces `terminated` with HTTP 200 and `UND_ERR_SOCKET`; invalid gzip can
also produce `terminated` after a completed wire transfer, so these diagnostics
do not by themselves expose every body-decoding failure or explain the old run.
Undici tarball downloads remain outside its metadata allowlist. The D154
native HTTP milestone adds observation of npm's own HTTP client, including
fixed pnpm package tarball labels, response status, request or response error
stage, client-abort state and completed wire transfers. Real npm controls
reproduce interrupted metadata, refused connections and resets during TCP/TLS
connection setup. Creation-time observation covers npm's asynchronous agent;
response observation preserves Node's automatic draining when no caller handles
the reply. A real response reset emits one failure record. npm's own timeout
records a client abort, which is evidence of cancellation, not its root cause.
A caller can cancel with `.abort()` while waiting for a socket, or exit from
an abort handler before socket cleanup emits an error. The observer records
the `.abort()` event itself with `AbortError`
and no network error code. It keeps one failure record per request and ignores
cleanup aborts after a complete wire transfer. Native controls cover both
missing-error boundaries, partial-response cancellation and completed-response
cleanup without changing the caller's exit or response handling.
The missing diagnostic in [merge run 41170351156, root partition 2](https://github.com/waitron-io/waitron-cloud/actions/runs/41170351156/job/124446923168)
remains unattributed: its npm timeout check did not capture request lifecycle
events. These controls repair a demonstrated observation gap; they do not
establish which lifecycle stage that historical npm process reached.
A synchronous `process.exit()` immediately after `.abort()` can still prevent
Node from emitting the abort event. `AbortSignal` cancellation continues through
the existing error path; these new controls do not qualify its cancellation label.
The bootstrap retry classifier reads stderr, including these diagnostics.
Real npm timeouts remain eligible for bounded retry through npm's own
`FETCH_ERROR` code. A cancellation record alone does not qualify a failure for
retry; integrity, signature and unclassified refusals keep their existing rules.
Other native controls cover cut-off tarballs, HTTP refusals, paused caller-owned
bodies, unhandled errors, redaction and bounded output.
This does not attribute the reset in [merge run 40712695671, root partition 4](https://github.com/waitron-io/waitron-cloud/actions/runs/40712695671/job/122902175152).
That job records npm failure before tests but no request endpoint. The bounded
setup now recovers transient transport failures without waiting for recurrence.
Native diagnostics omit
unknown packages, tarball versions, credentials, queries, headers and bodies;
body decoding after a completed wire transfer remains outside their evidence.
Every workflow pins Node 26 without a package-manager cache, then uses
`scripts/ci-setup-pnpm.mjs` before using or caching pnpm.
The script retains the action's integrity-locked 11.19.0 bootstrap and its
signature-verified self-update to the repository's pinned 9.15.0. You get at most
three fresh attempts, each limited to 30 seconds with two seconds to kill an
unresponsive child and its descendants. Known transport failures and stalled
installs can retry; explicit integrity, signature or identity refusals, unknown
errors and a wrong or unconfirmed final version fail immediately. Each failed
attempt keeps its diagnostic output. Only the confirmed target reaches later
steps through `GITHUB_PATH` and `PNPM_HOME`; a failed command-file write rolls
both files back. The existing npm request budgets
and workflow deadlines remain unchanged. Native controls exercise recovery,
exhaustion, refusal, cancellation, publication and process cleanup; an isolated real install
completes the verified switch and prints 9.15.0. Linux CI qualifies the workflow
wiring and controlled failures. The historical network cause remains unknown;
retain any new labelled recurrence for D154 attribution. Forced termination
of the supervisor itself cannot run its cleanup handlers; cleanup after that
depends on the job runner and is not qualified by the native signal controls.


## Native attempt-count observation (D530)

The 4 November native root run at `c8341a79521981ce8f98509467facbcf1a7d6950`
failed `hang is stopped within each attempt's bound` in
`scripts/ci-setup-pnpm.test.mjs`: the fixture counted two installer executions
instead of three. The run recorded 2986 passes, one failure and 15 platform
skips. The case keeps its 750ms attempt budget and every original assertion.
Its supervisor, observer, lock and test source are unchanged from main
`4a356beee587960632ceca7cf67db8798b5d8d0c`.

A private control using those exact main inputs and one added diagnostic line
passes the original assertion with three installer executions. It does not
reproduce or repair the full-run failure. An unchanged isolated feature run
also counts two attempts; a later main-checkout run passes with three. These
results do not establish a cause. No earlier exact occurrence was found
in the campaign queues or questions; D530 already records a different
descendant-timeout case that counted two rather than three attempts. A shared
cause, scheduling explanation and flaky-test classification remain unproved.
Run `node --test --test-name-pattern='^hang is stopped within each attempt' scripts/ci-setup-pnpm.test.mjs`
to select this case. On recurrence, retain both supervisor attempt labels and
installer-entry records before choosing a repair; the original failing
assertion did not print those records.
