# CI pnpm setup

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
A caller can abort while waiting for a socket, or exit before socket cleanup
emits an error. The observer now records the abort itself with `AbortError`
and no network error code. It keeps one failure record per request and ignores
cleanup aborts after a complete wire transfer. Native controls cover both
missing-error boundaries, partial-response cancellation and completed-response
cleanup without changing the caller's exit or response handling.
The missing diagnostic in [merge run 41170351156, root partition 2](https://github.com/waitron-io/waitron-cloud/actions/runs/41170351156/job/124446923168)
remains unattributed: its npm timeout check did not capture request lifecycle
events. These controls repair a demonstrated observation gap; they do not
establish which lifecycle stage that historical npm process reached.
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
