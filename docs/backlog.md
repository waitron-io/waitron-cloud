# Waitron Cloud backlog

## Disposable test slots and repository runners (D592)

The owner-approved [design](superpowers/specs/2026-11-06-disposable-test-server-design.md) and [plan](superpowers/plans/2026-11-06-disposable-test-server.md) govern the bridge work. The coupled manual slot, automatic recovery and coordinated restart checks are [qualified on the private bridge](https://github.com/waitron-io/waitron-cloud/pull/1061#issuecomment-6706129609).

Complete the same-source hosted retry for [ordinary pull-request typechecking](../deploy/disposable-tests/README.md#run-the-first-ci-canary). Finish the [D599 ordinary-user and four-then-six measurements](superpowers/plans/2026-11-07-waitron-runner-capacity.md), including browser/heavy work and guest memory excluding cache; retain the shared canary probe, contributor approval and accepted public-repository limits. Automatic pickup, frozen transitive guest packages and permanent-host reproduction remain open. D570’s EC2 proof and D591’s selection work stay separate.

## Keep the private shared UI release current (D579)

The [approved release plan](superpowers/plans/2026-11-06-simple-private-ui-release.md)
still needs a newer-version automatic dependency PR covering both consumers and
its authenticated CI install. Read the first scheduled check after publication,
including its reason if no update is needed. With the manual `0.2.1` update
already installed, proving a newer-version PR needs a later Waitron release.
Review the actual generated PR before claiming that path is qualified. The
[release guide](shared-ui-release.md) records publication and manual qualification.
The package stays private; existing authenticated install and image paths remain.

## Shared storage-test seed downloads (D585)

The [storage archive acquisition and cancellation record](backlog/storage-cache-fixture.md#every-seaweedfs-archive-fetch-and-a-controlled-copy-proposal-d530-4)
tracks D585: native startup, ten test seed hooks and conformance share bounded
acquisition. Native startup retains one attempt, with a 30-second deadline
covering headers and body. Conformance retains three attempts, a 120-second
total budget and 30-second inactivity. HTTP refusals preserve each caller’s
existing error and retry policy. The Dockerfile now invokes the shared command
inside its existing Node image, with three temporary attempts inside 30 seconds
and ten-second inactivity. Architecture digests and extraction remain required.
The `storage-tools` build target isolates that boundary for checks; full
application image preparation qualification remains open.

## Admin listener shutdown and paced replay (D581)

The exhaustion fixture drains probe data before closing its owned listeners.
The [socket regression and limits](backlog/storage-cache-fixture.md#admin-owner-probe-draining-d581)
cover a disconnected peer that previously prevented shutdown. Historical CI
client attribution and the separate paced-replay checkpoint failure remain open.

At checkpoint admission, failures retain the failed socket's count of fully
validated forwarding requests through worker serialization. Run `node --test
scripts/cloud-cost/checkpoint-socket-diagnostics.test.mjs` to reproduce a real
connection reset after a completed request: the count is zero, but measurement
still refuses. Counts outside 0–1,000,000,000, private values and accessors refuse.
An interrupted mutation body can also leave zero once validation unwinds; zero
does not prove an idle socket. A reset during inventory reports only the
measurement stage, without a socket count.
Five ordinary official-writer macOS probes pass; with a padded 512 KiB LIST reply,
two of five stop-at-idle probes instead record `client-error / ECONNRESET`, zero
forwarding requests, equal successful counters and writer exit zero. This is a
controlled native reproduction, not attribution of the historical paced replay.
Replay shutdown now gracefully half-closes previously used storage sockets and
waits for their peers to close before signalling the writer. It checks again for
requests admitted during that drain. Fresh connections remain available for their
first request. A peer closing with unfinished headers and interrupted replies
still refuse. Silent partial headers are not qualified by the transport.
The drain shares the existing two-second force-stop budget during finish and
collection; waiting for a peer cannot postpone that timer.
Run `node --test scripts/cloud-cost/litestream-idle-retirement.test.mjs
scripts/cloud-cost/replay-stream.test.mjs` for socket, restore and collection
controls. The padded official-writer Linux probe records nineteen reset refusals
with writer exit zero and one force-collected stop, then passes all twenty with
graceful retirement. This repairs that measured
shutdown ordering; the older CI traces cannot establish every historical cause.
A request reusing a half-closed socket can reach storage before its reply refuses.
That race, the separate native LIST investigation and requests starting after the
final drain remain open. The diagnostic idle-action count includes drain attempts
before signalling; it does not prove that the writer was signalled. No existing
assertion, accounting check or configured deadline value changes.

Official 0.5.17 macOS controls also reproduce the native LIST's
`response-pipeline / ERR_STREAM_PREMATURE_CLOSE` signature in three of three
trials: all 213 reply bytes reach the counter, both HTTP messages are complete,
and the writer exits zero. The control deliberately postpones downstream
response completion by 100 ms after the body passes through. It establishes a
possible ordering, not the natural cause of the historical 743-byte refusal.
One refusal snapshot has equal four-attempt counters and another pending
request; two include extra refused work.
Do not transplant replay's socket retirement into this smoke: all three native
trials refuse at retry-sequence validation, and two need forced collection.
A passive pre-signal idle wait still permits a later LIST cancellation in all
three trials. The ledger reports unknown cost; the control's additional demand
for full reconciliation fails. A generated writer alone passes the proposed drain, but that
change fails 15 of 92 existing shutdown checks; restoring the implementation
passes all 92. Keep the current acceptance guard and absolute two-second stop
budget.

The same official 0.5.17 controls on Debian 13 reproduce all three delayed
LIST cancellations with writer exit zero. Socket retirement fails all three
trials at retry-sequence validation and needs forced collection in each.
Passive idle still permits a later LIST cancellation in all three trials;
the ledger retains unknown cost. These controlled Linux results confirm the
counterexamples, not the historical cause. Next, establish a background-work
completion boundary without treating one idle observation as completion.

Native runtime profiles now identify the background task in that controlled
case. On Debian 13 and macOS, each of three official 0.5.17 trials still has
one Store maintenance task inside `EnforceSnapshotRetention` after the database
stop acknowledgement. Three other maintenance tasks are waiting between turns.
The held task can continue listing lower levels after an idle observation;
waiting for its whole turn after stop reaches the existing three-request guard
in all six profiled trials. The writers exit zero. These results identify the
controlled task, not the natural cause of the historical 743-byte refusal.

Retesting the same three held-LIST orderings on Debian 13 with the official,
checksum-verified 0.5.18 release leaves this boundary open. Both releases still
acknowledge database stop with a held LIST; signalling cancels the partial reply,
and releasing it to idle still permits a later cancelled level-1 LIST. Waiting
through the final level passes on each release. This one comparison does not
qualify a drain for the full smoke; the cost experiments remain pinned to 0.5.17.
The existing native-monitor characterization also fails its unchanged
“runtime stop must finish active snapshot-retention storage work” assertion
on both releases, while its release-before-stop control passes both. The 0.5.18
after-stop profile still contains `Store.EnforceSnapshotRetention` calling
`DB.EnforceSnapshotRetention`; an upstream stop-order change does not close this
controlled database-stop case.

Completing that same held retention sequence before requesting stop passes
three controls on each platform. Both independent counters pair every LIST,
all four maintenance tasks then wait between turns, and no request enters the
after-stop subset. The original two-second trial budget still covers release,
completion, stop and exit. This is an experimental ordering control, not a
readiness rule for the full smoke: its final sale and concurrent maintenance
still need qualification. No runtime implementation, acceptance guard, existing
check or deadline changes. Next, reproduce this boundary in the real smoke
without assuming that a temporary idle transport means maintenance is finished.


The real SQLite proof now runs official Litestream 0.5.17 against synthetic
Waitron sales. After the writer and all covering writes stop, the negative
control replaces stored objects with the captured one-sale recovery point and
reads every retained body back. All twelve restore attempts find one sale and
SQLite `ok`; the rehearsal refuses at restore validation despite nonblocking
unknown accounting. Its paired retained-write control cuts the reply, restores
both sales and passes SQLite and fiscal checks. Run the stack conformance cases
`lostFinalWriteFailsFunctionalRestoreDespiteNonblockingAccounting` and
`committedWriteWithCutoffReplyRestoresSuccessfully` for this controlled proof.
The initial x86 run passes both cases; wider shared-consumer qualification remains.

Three genuine native-smoke cases each change one observer record while restoring
both sales with SQLite and fiscal checks and removing owned resources. The
replication case reported a byte discrepancy of 742 instead of -1 in
[PR1050's cost job](https://github.com/waitron-io/waitron-cloud/actions/runs/42332288959/job/128281835882).
Its cause stays in D530. Capture the synthetic proof before asserting its exact
discrepancy; keep that assertion.

Real bucket-control billing remains unknown
and cannot qualify merely because both transfer counters agree. Run `node --test
scripts/cloud-cost/schema.test.mjs scripts/cloud-cost/local-receipt.test.mjs
scripts/cloud-cost/meter.test.mjs scripts/cloud-cost/storage-meter.test.mjs` for
these boundaries.
Measured local inputs also need their original replay and stream records. The
exporter compares every supported value, unit, source, observation time and
cadence, and refuses an unrelated or invented measurement. Individually valid
meters that overflow when combined finish with unknown accounting and no receipt;
the original observations remain available. The generated archive
journey finishes with its original observations and no receipt because billing
and storage-history coverage remain unknown. Its real Debian control retains
all 11 requests, the restored sale, privacy and owned cleanup.
Your current generated stream runs also finish without a new measured receipt:
setup and cleanup control billing stays unknown. The clean unit fixture supplies
known billing to exercise the export contract; it does not qualify real billing.

## Cloud backup box identity (D451)

Generated recovery accepts only its own captured archive, drains and closes the
source writer, authenticates with the stored node recovery key, and uses Waitron's
prepared runner and real restore hooks. Wrong keys, changed bindings, expired
permissions and replaced destinations refuse. Clock observations are synthetic;
the actual observer and admission checks still validate them, with the release's
generated timestamp and no external clock request. This does not qualify production
time sources.

**Still open under D79:** the genuine full-backup readback pairs both real servers,
then ordinary native restore refuses `restore.hook_failed` for `fiscal-verifactu`
with `sif.allocation_invalid`, before the container verifier runs. Preserve that
refusal: restoring without allocation authority must not activate a fiscal server.
The approved [non-activating verification contract](superpowers/specs/2026-10-18-backup-verification-without-fiscal-authority.md)
and its [Cloud implementation plan](superpowers/plans/2026-10-21-cloud-backup-verification.md)
own this remaining qualification. The [compatibility plan](superpowers/plans/2026-11-01-replay-allocation-compatibility.md)
records the bounded fixture and route amendments. No fiscal implementation,
immutable row, historical result or deployment authority changes here.

## Retrospective review qualification (D535)

Continue the remaining assigned application-source reviews and fix real findings
on current main. Test-addition and maintenance pull requests are excluded by the watcher's
6 November decision. Real provider behaviour remains unqualified.
`node --test apps/portal/test/stale-signout-focus-browser.test.ts` checks that
an old failed sign-out leaves a newer page's focus and pending request alone.

Child exit reports retain known operating-system signals and publish the value
that was checked. Joint-fixture setup reports retain the operation that crossed
the budget before a stage change and cover initial directory refusal. Historical
Linux failure causes, mixed registry-error handling and enclosing CI job budgets
remain separate limits.
The interrupted-LIST control identifies its producer outcome; the matching
storage-observer outcome remains unqualified in that scenario.
Venue-refresh handler checks preserve the original cases, while their matrix
and outer deadline control have the limits described below.
Delayed passkey and authenticator fixtures stop adding their artificial pause
once a request has been recorded. Their sampled duplicate controls and open timing
and session-list cleanup limits are described below. The stale-draft and script
recovery notes also distinguish delayed-handler scope from outer wait bounds.
The JavaScript-disabled fixture retains ordinary and delayed screenshots separately.
Both reload fixtures also retain their reachable handler variants separately.
The live-status and landmark fixtures keep ordinary and delayed captures separately.
Their notes describe the missing-signal controls' outer refusal checks.
The recovery-width fixture also keeps each reachable handler capture separately.
The pending-session sign-out fixture retains ordinary and delayed captures separately.
The recovery-choice fixture also keeps its ordinary and delayed captures separately.
The sign-out failure fixture keeps normal and delayed captures separately too.
The recovery-session fixture also retains each ordinary and delayed capture.
Collect it with `RECOVERY_SESSION_RECEIPT_DIR` set to a fresh directory when you run
`pnpm --dir apps/portal exec node --test test/recovery-session-browser.test.ts`.
Check all 32 filenames independently: the browser assertions passed all 33 cases
before the repair while only sixteen files survived. Delayed captures add
`-delayed`; the sixteen historical names remain unchanged. Separate names retain
both runs without promising different pixels or stable image bytes. Every original
behavioral assertion, expected value, observation and deadline remains unchanged.
The delayed fixture publishes its route only after the artificial pause, so
recorded omission checks fail all sixteen delayed cases. Before that correction,
both cases passed with the observation removed. Restoring the observation passes
both cases; the ordinary and delayed recovery assertions remain unchanged.
The missing-signal title describes its observation timeout and early return,
before failure-message and retry checks.
Its four-second outer race does not independently prove the exact configured
three-second observation boundary. Real recovery authority, other engines, behavior
under load and general cleanup bounds remain unqualified. One historical ordinary missing-signal
sample exits after 3.6 seconds; its parent needs stopping at 150 seconds after the
120-second test timeout. These samples do not establish a general cleanup limit.
The session-check retry fixture keeps all 34 ordinary, delayed-handler and
delayed-clock captures under separate names. Collect them with
`SESSION_CHECKING_RECEIPT_DIR` set to a fresh directory when you run
`pnpm --dir apps/portal exec node --test test/session-checking-retry-browser.test.ts`.
Check the filenames independently: all 70 browser cases passed before the repair
while only sixteen capture files survived. The sixteen ordinary names stay the
same; delayed handlers add `-delayed`, and delayed clocks add `-clock-delayed`.
Separate files retain each run without promising different pixels or stable image
bytes. Every original session, protected-field, retry, cooldown, clock and deadline
assertion remains unchanged. The two missing-signal titles name their timeout;
the controls return before retry checks, and their four-second race does not independently pin the
configured three-second observation boundary. These are Chromium fixtures with
stubbed HTTP; real authentication and behavior under load remain unqualified.
The translation-refresh fixture also retains all 33 reachable captures separately.
Set `TRANSLATION_REFRESH_RECEIPT_DIR` to a fresh directory when you run
`pnpm --dir apps/portal exec node --test test/translation-refresh-pending-browser.test.ts`.
Check the filenames independently: all 68 browser checks passed before the repair,
but only sixteen files survived. The sixteen ordinary names stay unchanged;
delayed captures add `-delayed`, and the reachable missing-signal ready capture
adds `-missing`. Separate files preserve each run without promising different
pixels or stable image bytes. Every original behavioral assertion and deadline
remains unchanged. The missing-signal subtest names its observation refusal;
it returns before the pending-state assertions. Its five-second outer race does
not independently pin the configured four-second observation boundary. A refused
observation releases the held gate, so the later read checks can complete while
the original observation still fails. The unread consent state masks deletion
of the consent button's installation-pending condition on both parent and head;
that separate coverage gap remains open. These Chromium checks use stubbed HTTP;
backend behavior remains unqualified.
The installation-refresh fixture keeps all eighteen reachable captures separately.
Set `INSTALLATION_PENDING_RECEIPT_DIR` to a fresh directory when you run
`pnpm --dir apps/portal exec node --test test/installation-pending-browser.test.ts`.
Check the filenames independently: all 73 browser checks passed before the
repair, while only sixteen files survived. The sixteen ordinary names stay
unchanged; the two English light phone delayed captures add `-delayed`.
The missing-signal case returns without a capture. Separate files preserve each
run without promising different pixels or stable image bytes. Both recovery
and account checks release a held refresh when handler observation refuses;
the observation still fails and later checks can complete. Every original
assertion, expected value, observation and deadline remains unchanged.
The delayed and missing-handler controls cover only the English light phone
case. The five-second outer race does not independently pin the configured
four-second observation boundary. These Chromium checks use stubbed HTTP;
real server authority and general cleanup bounds remain unqualified.
See [the diagnostic qualification and open work](backlog/retrospective-reviews.md).

The hostname Enter fixture keeps all nine reachable captures separately. Set
`REMOTE_ENTER_RECEIPT_DIR` to a fresh directory when you run
`pnpm --dir apps/portal exec node --test test/remote-hostname-enter-browser.test.ts`.
Check the filenames independently: all ten browser cases passed before the
repair, while only eight files survived. The eight ordinary names stay unchanged;
the English light phone delayed capture adds `-delayed`. Separate files retain
each run without promising different pixels or stable image bytes. The handler
that answers without recording returns without a capture; its title names the
observation timeout. It returns before the request, pending-state and no-apply
assertions. Every original behavioral assertion and deadline remains unchanged.
The four-second outer race checks bounded refusal without independently pinning
the configured three-second observation boundary. These Chromium checks use
stubbed HTTP; real server authority and general cleanup bounds remain unqualified.
All five sampled pending-review duplicate mutations were caught, once by a later
count. The final rate-limit duplicate assertion has no later request count;
its mutation coverage remains unqualified.
Capture retention also remains unqualified in the sibling fixtures
`authenticator-setup-enter-browser.test.ts`, `passkey-enter-browser.test.ts`,
`passkey-add-keyboard-browser.test.ts`, `session-list-activity-browser.test.ts`
and `public-challenge-script-fallback-browser.test.ts`. This review did not run
those siblings; the filename pattern alone does not establish a lost capture.

The passkey-refusal fixture preserves every original assertion and deadline.
All six journeys run in English and Spanish, light and dark, at both widths;
the missing-handler control runs once in English, light mode, at 390 pixels.
The held reply lets pending-state checks run before completion, but deleting
the hold still passes in sampled runs before and after PR #599. A check that
always detects a missing hold remains open. Stubbed Chromium checks do not qualify
real authentication, database behavior or general cleanup bounds.

## Worker shutdown during polling and error reporting (D459)

**Open.** Qualify production shutdown, database failures, cancellation and provider
behavior beyond the local fixtures, plus explicit database pool cleanup. Native
polling, pending schedules and late error reports have shutdown controls;
real-command checks cover the cases named in
[the worker shutdown detail and remaining limits](backlog/worker-scheduling.md#worker-shutdown-during-polling-and-error-reporting-d459).

## Historical CI observations without a recorded recurrence

Keep D126, D129, D131, D198, D262, D311, D335, D349, D457, D574 and D583,
D152's isolation-command refusal and D507's old cache-upload stall together.
The 31 October to 6 November retained failure-history review found no matching
recurrence for these observations. This does not explain their causes or prove
that they cannot recur. D152's replication failures and D507's cache-miss budget
qualification remain separate below. A new matching failure joins its existing
investigation, with the original assertions, limits and cleanup checks preserved.

Lane J's local `receipts/d593/sweep-inventory.json` retains every original entry,
its source revision and its investigation links. The matching failure records
and review limits are in `receipts/d593/recurrence-review.json`. Use those records
to find the original evidence before choosing a repair.

## How to keep this file honest

- Delete finished entries after checking main, the named pull requests and the code.
  Name the delivery pull requests in your commit body; keep each remaining open point
  as a short entry.
- For an entry longer than about ten lines, keep its title, status and one to three
  sentences here. Move the full detail to an area file under `docs/backlog/` and link it.
- Remove proof-of-work such as test counts, run IDs, signed commits and measurement
  narratives. Keep what is still open and why; receipts belong with the delivery.
- Keep owner decisions you still cite under `Decisions and deliberate limits`.
  Never remove a recorded decision with finished work.

## Decisions and deliberate limits

The owner changed the acceptance rule on 6 November: functional rehearsal checks
still fail, while cost-accounting problems are reported with named gaps in every
mode. The [accounting-gap plan](superpowers/plans/2026-11-06-cost-accounting-gaps.md)
sets out that change. It replaces the proposed retry, uncertain-read cap and
maintenance-completion gate. Sales, uploads, stop, restore, SQLite and fiscal
integrity, cleanup, request caps and deadlines remain required. An unknown figure
stays unknown, and a run with gaps cannot replace a published cost figure.

- Email resend waits belong to each address and operation (owner, 2026-10-25).
  Correcting an address allows an immediate send; returning to it keeps its wait.
  A server Retry-After still blocks every address for that operation.
  This also means a refusal in another operation cannot transfer or clear that wait.


## Installation deployment qualification

**Open.** Qualify server permissions, local confirmation and live delivery against the
selected deployment.
See [the native installation boundaries](backlog/venue-connection-http.md#installation-deployment-qualification).

## Pairing deployment qualification

**Open.** Qualify server permissions, local confirmation and live delivery against the
selected deployment.
See [the native pairing boundaries](backlog/venue-connection-http.md#pairing-deployment-qualification).

## Alert-preference deployment qualification

**Open.** Qualify server authority, deployed browser integration and production mail
delivery.
See [the native alert boundaries](backlog/alert-preference-http.md#alert-preference-deployment-qualification).

## Translation-consent deployment qualification

**Open.** Qualify server authority, deployed browser integration and translation
release checks. See [the remaining consent qualifications](backlog/translation.md#translation-consent-deployment-qualification).

## Signup and password-reset HTTP acknowledgements (D423)

**Client and local server qualification complete.** Signup and password reset
require the exact success status and acknowledgement; signup also requires three
nonblank identifiers. Browser journeys preserve uncertain results for an explicit
retry in both languages, themes and widths. Real HTTP checks cover the 15-second
header and body deadline; local Mailpit checks cover server authority and session
revocation. Production provider delivery remains with D102's owner-only enablement
gate. See [the acknowledgement boundaries and runnable checks](backlog/account-http-boundaries.md#signup-and-password-reset-http-acknowledgements-d423).

The historical [PR #669 storage failure](https://github.com/waitron-io/waitron-cloud/actions/runs/40716310898/job/122914999702)
was a prematurely closed LIST response during Litestream shutdown. D530 owns its
cause investigation; successful delivery of these client tests does not repair it.

## Current state

Updated 2026-10-22. The repository has a pnpm workspace and internal PostgreSQL
registration state, internal password sessions, session-backed Cloud approval and an
email-verification signup backend that creates the first organisation and business.
Cloud password recovery and an encrypted PostgreSQL email queue are implemented
internally, with a retry worker, authenticated TLS SMTP delivery and Mailpit for local
email capture. SMTP capture tests select by subject and recipient because concurrent
database fixtures share the inbox. The account HTTP API now provides signup, login, session activity,
logout and recovery with shared request limits, Origin/CSRF checks and bounded
network handling. The bilingual account portal now covers signup, sign-in, sign-out
and password recovery, served by that API with real browser and Mailpit tests.
The account venue overview groups one organisation at a time, shows business context,
connection/service state and separate latest/verified snapshot capture times. Verified
snapshots older than 48 hours are labelled out of date. Owners can browse paginated snapshot history, verification and retention details, including
protected copies. The local durable worker now verifies real Waitron restores, retries failures and
cleans expired snapshots and abandoned captures. The local monitor now persists contact,
snapshot and remote-route incidents, shows stale checks as unknown, and queues opt-in
bilingual alerts with permission and current-route rechecks.
Live provider/sender configuration and public deployment remain open.
No public cloud service is deployed. This file owns cloud product and platform work;
Waitron's backlog owns the on-prem application and its side of the integration.

Start with the [product discussion](product-and-platform.md). The
[launch evidence boundary](launch-evidence.md) separates the completed local milestone
from the provider, policy and live tests still required before public exposure. The
[inherited inventory](reference/2026-08-29-cloud-services-inventory.md) holds the wider
candidate list and previous commercial reasoning. Remote access and backups are the
agreed initial services. The first integration milestone is complete locally; the
production release scope remains open.

**D88 / published #265 access extension, reconciled 2026-10-24:** the owner requires `.local`
for venue devices and public menus, online bookings/orders and table-QR ordering
with the Cloud step soon after go-live, not go-live itself. The [hosting design](superpowers/specs/2026-10-21-cloud-hosted-venue-design.md),
[conditional outline](superpowers/plans/2026-10-21-cloud-hosted-venue-design.md) and
single [public access/A951 contract home](waitron-integration-contract.md#public-access-and-a951-proposed)
record the scope. Close D88's duplicate design-approval gate: the approved production
design settles per-venue gVisor runtimes on shared machines, country cells, cold
recovery, Spain/Paris, per-action automation, per-cell releases and quiet-hour moves.
The owner's 24 October decisions put accounts/sign-in/recovery in-country with one
owner per customer per country, no invitations or manager accounts. Global keeps
the operator console and apex routing, optionally billing. Country billing is a
recommendation for later design; global reporting needs later privacy/data scope.
Future owner transfer must be country-scoped verified transfer/recovery, without a
second owner or automatic support takeover. No D88 owner question is ready now;
P6/D115 owns runtime/build delivery with P1/P3/P4/P7, A951 and D101 dependencies.
Production local build/rehearsal authority stands; this reconciliation adds none.
Reliability promises and pricing await measurements at launch. A1018's design,
both examples and retained defaults are approved at Waitron
`060966c2b3e9203acf0849042814997307cae463`; exact formats, compatible A947
amendments, separate A1018 build authority and runtime proof remain open.
G owns P3/P4 plan revisions and priority-5 single-owner lifecycle; production
section 4 names the changed dependencies. A951 owns the lasting Waitron tunnel/certificate client; its accepted
implementation and landing pin remain required. The [D123 scoped review](waitron-integration-contract.md#a951-cut-a-contract-review-2026-10-23), [D130 helper response](waitron-integration-contract.md#a951-helper-and-routing-response-2026-10-23-d130) and [D136 routing response](waitron-integration-contract.md#a951-routing-revision-2-response-2026-10-23-d136)
retain their scopes: exact helper accepted for isolated T3 with matching E acceptance
at Waitron `4fbb76eaf`, routing edition proposal-2026-10-23.2 accepted by G with
E's matching record still required, and the original 83-byte empty manifest unchanged.
The [D132 appliance response](waitron-integration-contract.md#a951-appliance-response-2026-10-23-d132)
still accepts no full appliance artifact or executable pair. The [D560 mapping response](waitron-integration-contract.md#a951-g1-hostcustody-mapping-response-2026-11-02-d560)
returns immutable `cloud-a951-g1-host-custody-v1` / `proposal-2026-11-02.1`.
E's [matching intake](https://github.com/clintongormley/waitron/blob/9b2adbf7dbe9ef2b29eaff22eda352129bba1b32/docs/developers/cloud-connection.md#g1-mapping-acceptance-2-november-2026-d560)
accepts its exact publication digest for isolated engineering planning only.
The mapping preserves closures, 256 lifetime trust entries within each 64 KiB
safety cap, the shared 256 KiB journal, four-store crash reconciliation and
separate role-local progress. Complete appliance acceptance and both executable
consumers remain NONE. The owner parked the earlier D582 protocol work on
6 November. D582-S first runs the existing two-venue remote proof, then connects
a real browser to a box through the existing gateway, with manual setup allowed.
The proof's backup worker now keeps database copies inside its own writable
temporary parent. The test gateway now serves the real external browser path,
including trusted password sign-in and automatic app and tunnel restart. The
existing signed certificate status action can discover a lost request ID,
including a stale predecessor, without exposing a CSR or certificate. Joint
reboot, renewal, revocation, offline sales, signed tunnel provisioning and
connected-machine isolation checks remain open. Deployment of the lasting
gateway remains open too. The parked
[D582 Cloud build plan](superpowers/plans/2026-11-05-a951-cloud-tunnel.md)
assigns the approval receiver and one-use Permit ledger, registration/node
mapping, public root/origin/peer policy and separate issuer custody to Cloud.
E owns local permission decisions, provisioning, private keys, client and native
confinement. The accepted responsibility split does not accept the missing
approval channel, revised full appliance or complete signed corpus; those must
precede affected adapters. The first target is one fixed box with opt-in test
staff access on Debian 13. Exact host pins and runtime proof remain G7 work.
E also records D136 routing revision 2 acceptance at the linked pin solely for
isolated T4 fixtures; the original 83-byte production manifest is unchanged.
G2 actual A947 authority, G3 client limits, G4 independent customer upstream,
G5 movement, G6 diagnostics/privacy and G7 runtime evidence retain their
path-scoped gates. G4/G5 are outside the first target. No tunnel or consumer is
qualified by the plan. Admission stays CLOSED and `.local` independent.

**D101 data protection, approved design and published build planning:** the owner
approved the complete D101/D88 data-protection engineering design from PR283
(`9701cd2359d69f0a3e8960b761754cf492aac745`) on 2026-10-22 around 08:30 **for build
planning only**. The [Cloud design](superpowers/specs/2026-10-22-cloud-data-protection-design.md)
and [implementation roadmap](superpowers/plans/2026-10-22-cloud-data-protection.md)
use [A980 section 2](https://github.com/clintongormley/waitron/blob/96a1129e385447e9b9a6dc545673009953a2c551/docs/superpowers/specs/2026-10-22-a980-data-protection-design.md#2-the-data-map)
as the single application map. Planning covers the service/supplier register and
annexes, country/credential/outbound controls, support/KMS, exit/purge and handoffs;
the owner approved the roadmap and authorised slice 1 on 2026-10-22. On
2026-10-23 the owner authorised local slices 2–5, with SQL-free slices 2/3 first
and slices 4/5 taking an actually available migration slot. Slices 6–12 remain
unauthorised. Slice 2 publishes the [purpose/supplier register](cloud-data-processing-register.md)
and [five draft agreement annexes](cloud-processing-annexes.md): stable IDs,
separate Cloud-own purposes, explicitly unqualified supplier evidence and all six
open lawyer questions. The register, annexes, design and roadmap reuse
[adviser confirmation P8](https://github.com/clintongormley/waitron/blob/2a4443a2ba01676e51fdb119a82d224f9d1cece7/docs/compliance/2026-11-06-adviser-questions.md#for-the-privacy-specialist)
for product repair, venue support, replacement remote transport and Cloud-own
security roles. The old relay question Q57 is retired; use the 6 November English
list, which replaces the 5 November Spanish batch. P8 is still awaiting legal
confirmation. These are unsigned drafting records, not legal or provider
qualification. Slice 3 adds the SQL-free [country decision function](country-policy.md):
exact qualified destination matching, positive policy revisions and evidence-only results.
The production Spain default has no qualified flows. Slice 4 adds the disabled
[venue lifecycle journal](data-lifecycle-journal.md): fixed UTC deadlines,
idempotent requests, venue revisions, expiring worker claims and bound outside-call
intent/uncertainty. PostgreSQL checks include process death at four boundaries,
same-revision claim takeover and unchanged migration history. The version 8
upgrade receipt covers the actual 044-to-047 candidate, separate pre-upgrade and
populated-journal backups, retained deadlines and stale-worker refusal. The
original billing and venue-authority proofs remain pinned to their delivered
trees with their original strict checks. Recording a request
grants no service or deletion authority; no customer route or effects worker is
enabled. Resubscription still needs a future retained-data check and activation
adapter. Slice 5 has a source-based
[implementation plan](superpowers/plans/2026-11-04-cloud-country-flow-enforcement.md)
for durable country bindings, late-grant reconciliation and separate account/venue
mail purposes. The reduced first task adds internal stored-policy admission
([guide](country-policy.md#check-a-stored-venue-binding-inside-a-transaction));
`flow-authority.test.ts` checks synthetic destinations and lock waits against
PostgreSQL. Product adapters do not call it yet. Placement/credential enforcement remains unbuilt; production
assignment, provider retirement, destructive-retention coordination and mail retry
semantics remain explicit gates. The retention and mail worker integrations stop
until their existing behavioral guarantees have a compatible design. The
later exit adapter must preserve priority for an earlier verified delete, perform
independent status lookup and qualify finer deadline comparisons if another
producer writes timestamps beyond millisecond precision. The
outbound AI refusal and explicit synthetic loopback transport are implemented
locally; later runtime controls remain **unbuilt**. One venue approval permits at most **24 hours**
of support access, shorter where practical and fresh approval to extend. **Paris
`eu-west-3`** is the approved extra encrypted backup destination, subject to service,
contract and recovery qualification; Spain data/logs/keys remain in `eu-south-2`.
The approved exit/retry/concurrency rules retain full download, fixed UTC 90-day
read-only recovery, earlier verified deletion and all-copy evidence without fiscal
row changes. O1 is answered. AI stays disabled until separately privacy-reviewed
eligibility rules, positive/refusal examples and documented limits receive owner
acceptance. All six lawyer questions, KMS deletion-waiting policy, exact provider/entity/
access-location evidence, D102 email qualification and runtime proof remain open.
The published plan records the reviewed roadmap; local build authority for slices
2–5 leaves every legal, provider, shared-contract and enablement gate in place. This does not approve broader D88 hosting/isolation/shared contracts,
spending, deployment, provider resources or contracts. The C39 monitoring design
remains approved for planning only, subject to the production deployment and
monitoring designs' corrections. The [alerts plan](superpowers/plans/2026-10-22-cloud-monitoring-thresholds.md#global-constraints)
keeps the exact daily UTC backup schedule, first due slot and first monitored
group subject to owner approval before enablement.
D102's [feedback and suppression design](superpowers/specs/2026-11-01-ses-feedback-design.md)
was approved for authenticated private-queue intake on 2026-11-01. The owner
subsequently authorised the local code and tests (D565), accepting Stockholm
`eu-north-1` and Paris `eu-west-3`, with Stockholm as the configured default.
The [implementation plan](superpowers/plans/2026-11-02-ses-feedback-implementation.md)
sets out attempt binding, shared suppression, private feedback intake and separate
provider qualification. Task 1 now validates immutable, independently qualified
purpose/resource/SMTP bindings and bounded one-recipient event envelopes. Native
synthetic checks cover refusals and classification; they prove no effective AWS
publisher authentication or live delivery. Task 2 adds durable, one-recipient
attempt bindings, retained key commitments and shared suppression lookup under a
transaction lock for each country/provider account/region. Migration 049 retains
all 48 previous ledger entries. Task 3 applies parsed feedback in one transaction,
deduplicates transport and semantic events, and preserves blocking evidence after
payload erasure. Local process-death checks cover both sides of commit. Missing
retained keys leave feedback retryable; unknown bindings never guess a recipient.
Task 3 retains the original recipient across later policy or configuration
revisions when its country, provider account, region, purpose and configuration
set still match. The owner approved this late-feedback rule on 5 November.
Any revoked retained key still closes feedback and admission across its entire
scope; revocation cannot be undone and has no supported recovery path yet.
The owner accepted that full stop for this task. Production remains blocked on
a separately approved key-retirement and recovery design, including whether an
unrelated revoked key should exceed the design's required-key refusal.
Task 4 adds optional trusted SES admission to both send paths. Account authority
and relay control, message and authority locks precede shared suppression; workers
recheck claims and deadlines after waits and commit each original-recipient attempt
before transport. Synthetic fixtures cover blocked handoffs, admitted sends,
rotation, replaced claims and current reset and alert authority. Migration 050
retains the first 49 ledger entries and maps explicitly scoped local blocks to
shared recipient references without inventing provider events or assigning old
unmapped rows to a country. Unconfigured local capture retains its existing gate.
Retained-key lock waits now receive a final authority-deadline check before commit.
The legacy relay gate remains global across country settings. Task 7 distinguishes
block lifetimes so a later unscoped re-add cannot revive old country mappings,
and refuses clearing a legacy row mapped to another scope.
Before production wiring, qualify retained-key failures that leave relay work
queued until its original expiry and occupy capacity until the claim lease ends.
Task 5 adds qualified SES configuration-set and opaque attempt headers to both
TLS adapters. Account delivery passes its committed admission, retains the original
RFC Message-ID and binds a separately parsed provider acceptance ID only to that
attempt. Early feedback keeps the first provider binding; a conflicting receipt
emits a fixed operational diagnostic without replaying accepted mail. Malformed
optional metadata does not change acceptance. A late receipt cannot settle a
replacement claim. The internal standalone relay adapter and separate receipt
settlement keep the local-proof worker's outcome contract and startup gate.
The opt-in account loader reads a bounded binding file and recipient keys, but
Spain's trusted policy still has no qualified email flows. A supplied file cannot
qualify itself; recognised public and VPC SES endpoints refuse unqualified SMTP.
TLS transport requires authentication even when AUTH is not advertised; a named
pipe configuration refuses without blocking startup.
Task 6 has an internal one-message queue intake seam. Local PostgreSQL checks
require committed feedback before deletion, retain malformed and conflicting
messages, and replay a failed acknowledgement without a second durable effect.
A shutdown observed before processing or after commit leaves the message for replay.
Its internal SQS adapter signs requests for the validated queue and region, with
one message per receive, a ten-second poll and sixty-second visibility. A shared
fifteen-second request deadline covers credentials, receive and delete; shutdown
or close aborts pending transport work. Local stand-ins check these boundaries,
fixed diagnostics and malformed replies, not provider permissions or encrypted
redrive. CI's lock reader now retains and validates pnpm deprecation warnings;
its literal graph counts include the new SDK dependency. Unknown fields still
refuse parsing. Database acquisition, lock waits and processing now share a five-second
deadline. Transaction-local PostgreSQL limits also bound a stalled commit;
failed connections are discarded and a connection returned after expiry cannot
start feedback work. Local checks cover cumulative statements, deferred commit,
disconnection and safe replay without premature deletion or partial writes.
The worker now admits at most two concurrent operations and exposes aggregate
health from both consumer slots. Readiness requires fresh successful polls and a
fresh trusted operational sample; a failed or overdue slot, stopped consumer,
changed configuration revision or observed drift closes readiness. The report
includes its producer timestamp, keeps commit freshness separate from acknowledgement, reports queue age and
dead-letter count, and emits only fixed failures and aggregate fields. Its
35-second freshness limit is conservative and can report stale during a long,
otherwise valid two-slot batch. It is not an alert threshold. Local stand-ins and PostgreSQL checks cover these states;
collecting authenticated provider samples remains unwired. The standalone
consumer now requires explicit opt-in, qualified trusted settings and retained
recipient keys. It stays outside normal services and uses one shared worker
with two consumer slots. Connection establishment and pool cleanup each have a
five-second limit; cleanup shares the twenty-second shutdown grace. A process
deadline remains armed until natural exit so a retained driver handle cannot
extend shutdown. Local command tests exercise SIGINT/SIGTERM, lock waits,
restart acknowledgement, death after commit and a provider stand-in's poison
redrive after five receives. Exact replays of persisted binding conflicts remain
unacknowledged without changing the store's transport-duplicate result. One-shot
completion reports stopped, and cancelled queue calls add no failure code while
earlier genuine failures remain visible. The command reads optional bounded operational
samples and emits aggregate JSON; it does not collect provider metrics or
qualify encryption, IAM or real dead-letter transfer. A pending pool request
is discarded when it returns. Task 7 adds internal manual reconciliation through
actual operator session, CSRF and platform-permission checks. Immutable requests
retain the actor, reason code, scope, revision and keyed prior evidence. A private,
expiring provider observation is bound to that operation. Provider stand-ins cover
BOUNCE and COMPLAINT removal and an independent final query outside database locks.
Both stores clear in one transaction only while authority and evidence remain
current. Partial provider removal, another scope's mapping, unmapped local blocks,
new feedback or expiry during a database wait keeps suppression. Completed outcomes
survive lost acknowledgements; pending work needs fresh evidence after restart.
Migration 051 retains the first 50 ledger entries and adds block-lifetime mappings
without changing historical attribution. Old feedback deduplication survives
clearing, new blockers can apply again, and no old mail, attempt or token is revived.
An unscoped decision stays marked for its lifetime and defeats a pending clear.
Old local rows keep unknown origin, since earlier mappings cannot prove how they
began; they remain blocked through this interface. Finished operations and known
unreconcilable local evidence cannot start provider work. Every admitted provider
attempt retains immutable intent and result rows, including the original removed
reasons across another query or a lost acknowledgement. An unfinished intent remains
uncertain. This internal interface starts from an existing Cloud block; provider-only
removal is not qualified here.
Task 8 adds a closed offline policy-document validator for exact SES/SNS sources,
private Standard encrypted queues, redrive bindings and separate SMTP, consumer,
health, operator and key-administrator identities. Synthetic refusal checks cover
broader permissions, drift and second-country sharing; they establish no effective
AWS access or live configuration. The [qualification guide](ses-feedback-qualification.md)
records the normalized document profile, later supervision/schema/health/shutdown
handoff and queue/evidence/backup/key inventory without choosing retention.
Stockholm is the configured default; Paris remains an explicitly qualified option.
These current rules supersede historical Paris-only and date-based enablement
wording. Operator permission provisioning, production provider acquisition/removal
and enablement remain open. Additional event types are not qualified;
`Rendering Failure` still refuses. AWS resources,
spending, credentials, production access and live mail remain unauthorised for this
build; the owner's existing DNS setup grants none of those permissions. D101's
legal, retention and supplier gates, C39's alert thresholds and D104's independent
alert route remain open; a second country needs its own approved provider-account
policy. D68 is landed, including
`b8ff5555c996c5dec1086be49f7d046018bd3187`, but does not price hosting. D79's local
backup verification includes migration 043 and the complete same-run recovery proof.
Snapshots remain unavailable in the delivered deployment and plan enforcement stays
off until release qualification. Recheck active migration reservations before new
database work; D101 slices 1–3 are SQL-free and slice 4 adds the lifecycle journal.

## Launch platform work, in priority order

Ordered at the owner's request on 2026-10-22. The order follows what stops the first real
venue using a paid service. Each area gets its own design session with the owner, in this
order. Remote access matters most because Waitron's customer-facing features wait on it
(Waitron A951, A1013, A508, A509, A1012).

1. **Production deployment — DESIGNED AND APPROVED (2026-10-22).** The
   [design](superpowers/specs/2026-10-22-cloud-production-deployment-design.md) was approved by
   the owner for building and rehearsing locally; opening AWS accounts, spending money and
   production schema changes need a separate go-ahead (its section 12). Its section 3 replaces
   the statements in C39, C41 and the hosting proposal that put the owner's approval on every
   step. The build is [seven plans](superpowers/plans/2026-10-22-cloud-production-deployment.md),
   each written when its turn comes: P1 can start now; P3 waits for the migration slot.
   P2 now provides the [AWS layer](aws-infrastructure.md): independent global and Spain
   roots, three-zone primary cells, encrypted cold copies, separate key authority,
   scoped workload permissions, ingress, DNS and infrastructure signals. Its offline
   pinned checks produce complete version 1 references for each exact cell and validate
   the unchanged handoff schema. Integration checks run each independent root in its
   own container under the original command and container deadlines. CI separates
   three guard-test shards from the full plan and formatting checks, keeping every
   test file and the original job limits. These are mocked
   plans, not a deployment. Account/state
   custody, populated secrets, actual service and collector permissions, recovery and
   provider availability still need their separately authorised qualification.
   Very deeply nested source remains subject to Python's limits; no exact boundary
   or exception name is qualified.
   State qualification must cover first initialization at an absent key under the exact
   conditional list policy, separate bootstrap-key creation and later deployment-role
   refresh. Database recovery grants still belong to P7's qualification.
   The owner approved gVisor for P6 and running Spain from Paris for P7 on
   2026-10-23. P6 still waits for P1/P4 and the accepted Waitron handover contract
   (A1018); P7 still waits for P3. Neither answer grants live/provider authority.
   Cloud agrees the [revised A1018 direction](waitron-integration-contract.md#handover-between-local-and-hosted-machines-a1018)
   at Waitron `d9252ac34f2b7e946e1154dd5af1a443c2c39ad4`, including the owner’s
   15:37 correction: after controlled or emergency takeover M2 alone handles AEAT.
   Copied and later-returned originals retain their generating fiscal identities;
   M1 returns missing originals, all received outcomes and uncertainties without
   AEAT contact. The rejected emergency predecessor ownership hold is removed;
   temporary per-chain apply pauses and domain filing-case holds remain. Fresh
   target chains, fiscal-only return and the visible business gap stay. This
   supersedes #312’s M1 filing assignment and #300’s external stop proof. Waitron
   owns one short revised owner design question; formats, actor bridge, A947
   fiscal-only transfer amendments, authorised A1034 test-service receipts, build
   authority and all eight scenario/direction runtime checks remain open. Country rebuild and action status
   supply no venue declaration or activation authority.
2. **Production monitoring, alerting and the status page — DESIGNED AND APPROVED (2026-10-24).**
   The [design](superpowers/specs/2026-10-24-cloud-monitoring-alerting-status-design.md) was
   approved by the owner for building and rehearsing locally; the paging, outside-machine and
   Anthropic accounts, and any spending, need a separate go-ahead (its section 16). It changes
   C39 and D104 where its section 3 says: the owner is paged after an AI investigation or at
   15 minutes, by a text then a phone call; the status page updates itself; an on-prem box
   going quiet never pages. Cloud's [report receivers and private reader](box-error-reports.md)
   have synthetic local checks only. Waitron's opt-in, staff form and sender, and the
   triage agent remain open. D101's AI gate still has to be opened
   for the investigator's inputs before it runs in production. Waitron work it needs: the
   error-report opt-in and sender, the "report a problem" form, the "can trade" check and the
   updater honouring a held version.
   Local PostgreSQL measurement at one million synthetic reports used 586 MiB including
   indexes; the latest hold comparison took 343 ms on the x86 test box. See the
   [volume measurements](box-error-reports.md#measure-storage-and-reads-before-sizing-a-service)
   for the command, fixture and limits. Assess
   matched-window error shares after real reports exist: lifetime totals from
   reporting boxes can delay young-release holds or inflate ratios when other errors
   disappear. The [receiver contract](box-error-reports.md) has synthetic evidence only.
   D104's [owner setup checklist](incident-setup.md) now gives the Cloudflare Pages
   Free/Direct Upload steps, independent `pages.dev` fallback and two phone-provider
   options with prices checked on 4 November 2026. The incident runbook follows the
   approved automatic updates, text then call and press-1 acknowledgment. The
   [local generator](incident-setup.md#generate-a-bundle-locally) produces one post.
   Dated public incident history, verified-health wording, account setup, publisher,
   phone adapters, supplier review, spending approval and outage/delivery/coverage
   drills remain open; the checklist
   creates no account or operational service.
3. **Billing — DESIGNED AND APPROVED (2026-10-29).** The
   [design](superpowers/specs/2026-10-29-cloud-billing-design.md) sets three levels
   (registered, connected, hosted), trials, SumUp cards and Stripe direct debit, failed
   payments, emergency hosting by a venue manager, and Cloud's own Veri\*Factu invoices.
   The [build plan](superpowers/plans/2026-10-29-cloud-billing.md) orders ten slices. Slice B's calendar, trial and charge rules and slice C's country-local billing store are built. The store keeps scoped event receipts, business anchors and opaque payment methods, per-venue levels and independent trials, hosted days, frozen prices and charge lines, payment observations and actual paid history. Migration 045 preserves all 44 older SQL files and existing rows. The upgrade proof interrupts and retries the real migration, checks consumer startup gates, and restores separate old and populated new backups. Restored retries, prices, payments, trials, hosted days and events retain their facts; five deliberate database guard omissions are caught, including coverage retained by a later successful payment after the first is refunded. Hosted paid-period dates are bounding summaries; future billing views must use the exact hosted-day allocations. Slice D's pure service floors, effective trial levels and continuous grant windows are built and tested. Translation requires level 2 in those rules, and a gap between trials ends the setup grant. The country authority reader and billing-event transition now qualify opt-in generations and atomic setup invalidation, including raw billing commands and elapsed trials. Registration and pairing qualify enrolled-venue lock order and legacy completion; historical clients still work without the new table, while damaged current authority refuses access. Installation consumers now read venue authority after authenticating proofs. Fresh and saved replies, explicit setup and account lists qualify current levels, complete venue locking and scope changes during waits. Snapshot admission, explicit same-location reprovisioning, retained expiry and publication after object waits qualify enrolled venue levels, generation changes, revocation and concurrent copies of one capture. Capture grants now authenticate before policy and compare permission generation and storage destination after provider waits; those checks and installation replies after expired trials, late transitions and unobserved gaps qualify in CI. Managed streams check storage destinations after provisioning and pointer reads, reject installations moved during permission waits, and accept explicit reprovisioning with the same input after an upgrade while keeping keys, reader identity and observed recovery data. Their database tests retain downgrade, trial-change and revocation checks. Stream regression checks cover explicit reprovision after expired trials, late extensions, conversion to hosted trials and unobserved gaps, while preserving recovery keys, reader identity, observed data and neighbouring venue setup. Independent omission probes exercise the expiry, setup-clearing and reprovision branches. The machine adapter authenticates before metadata or policy work; HTTP checks cover enrolled levels, signed observations and proof, lease, key and permission changes during provider waits. Recovery HTTP delivery now compares the admitted permission generation and storage destination after provider waits, including stream reader identity. Its new checks cover snapshot and continuous recovery, owner status, catalogue and close at level one, and proof, membership and operation changes during provider work, with independent guard omissions qualified in CI. Replacement regression checks cover snapshot and continuous proposals, activation and completed-result replay at enrolled venue levels, owner inspection after downgrade, and proof or session expiry during resource waits. Independent omission probes retain those authority and expiry boundaries. Replacement HTTP regression tests cover both sources: current admission and completed replay, retained owner inspection and close, proof/session/owner/binding refusals and the existing machine response fields. The direct storage adapter now binds each writer to its permission mode and per-venue generation. Explicit venue mode upgrades private state to version 2, retires legacy writers even at an equal revision, and preserves recovery readers and data. New storage checks cover mode changes, same-organisation neighbours, missed downgrade round trips, restart, provider waits and country-policy outages; independent omissions test the physical writer refusals. The storage regression checks also exercise actual writer refusal after expired trials, late extensions, conversion to hosted trials and unobserved gaps, and reject a reader grant after a permission round trip during its file-lease wait. Temporary credentials retain their 900-second requested lifetime and existing 901-second returned-expiry bound, with the native provider expiry proof kept separate. Remote route exports, scheduling and forward-status reports now share an exact venue-scoped eligible set for active and incoming placements, with forward reports enabled or disabled. Regression checks cover same-organisation siblings, level-one refusals despite stored setup, explicit reprovisioning after upgrade, original bindings and complete venue locking during waits. Gateway restart retains the signed ten-minute authority limit. Remote account status now reads venue levels, masks withdrawn access and retains explicit reprovisioning. Database checks cover DNS, signing and certificate waits, proof-first staff certificate reads, refreshed setup after installation waits, and legacy batch/report exclusion for enrolled venues. Private route job digests include configuration revisions even without a reporting gateway, so restoring the same route cannot revive an old signing job. Independent omission probes cover these admission and publication guards. First enrolment is now serialized with legacy remote batches through sorted organisation and venue parent locks. The captured venue set is reused after the wait, including reporting exports, scheduling and forward-status reads and writes. Database checks cover first enrolment, installation-lock ordering, unrelated-cell progress and captured placements; independent omissions challenge the guards. Direct remote admission now rechecks the original venue and installation key under the installation lock after policy waits, then reads setup before allowing further work. Added checks cover provisioning, DNS instructions, certificate admission, cleared setup during a move wait and unrelated-cell progress. DNS changes and certificate publication now retain the admitted installation venue and public key across external waits. Added database checks cover key and venue changes without a revision change, retain environment, revision and revocation refusals, and require unchanged identities to succeed. Independent omissions challenge each retained identity component. Additional remote-report checks cover forged signatures, mapping and route revisions, current reporter identity after waits, sibling isolation and status before cleanup. Six independent guard omissions must be caught by those checks in CI. Translation batch hooks now separate permission from spending admission, recheck permission after provider accounting and retry waits, and retain an already paid valid result without starting review. Native checks cover denial, restoration, cancellation and callback failures. Translation admission and workers now consume venue authority; new database checks cover level-one refusal, retained results, queued-job progress and downgrade round trips during provider work. Database omission checks qualify admission, provider callbacks and the admitted permission generation. The explicit test-mode worker now skips production jobs without changing their rows or bodies, so they cannot block eligible test venues. Added database checks cover queued and interrupted work, and separate omissions challenge both selection paths. The account HTTP app now passes its selected mode into translation admission. New HTTP checks cover enrolled levels, production refusal, independent consent and setup, retained paging and replay, ownership and proof refusals. Policy-wait tests cover lock order, revocation, key and venue changes, expired leases and withdrawn consent; independent omissions challenge HTTP mode propagation and post-wait authentication. Relay approval, message admission and SMTP handoff now read basic venue eligibility before installation locks, while retaining the independent owner, consent, origin, grant, allowance and operator-stop checks. New checks cover each level, policy waits through direct and HTTP entry points, fresh admission, retained account debits and rejected configuration. Same-organisation translation checks reject forged selectors and keep jobs bound to the authenticated installation. The dedicated test runtime now validates and forwards the explicit venue mode, keeps the legacy modes unchanged, drops provider inputs and selects the local storage, trust and private controller paths. Native tests cover each runtime role and invalid combinations. New database and captured-mail checks cover signup and password reset across venue transitions, unchanged queued mail and relay authority, and unavailable address and translation routes at all three levels; independent omissions challenge signup and reset admission in CI. Worker commands now pass the explicit venue-level mode to their service checks and refuse conflicting or invalid settings before database work. A separate version-2 service receipt runs nine fixture groups and retains the older free/paid proof. Each complete receipt now has its own eight-minute CI job, preserving every assertion and the 330-second child and 360-second test limits. The grouped receipt runner can overlap two independent suites, retains its serial default and still runs every selected suite after a failure; controlled scheduling tests catch extra workers, serial execution, lost failures and invalid counts. Its storage group executes the direct cases once while keeping the discovered package wrapper. A single bounded file queue covers the groups without multiplying their file concurrency. The new guard runner requires independent passing baseline and restored runs around an exact named assertion failure; its controls reject empty or omitted tests, setup failures, timeouts, ambiguous mutations and undetected changes. Version 7 has a separate strict receipt format and pinned revision parser. Actual CI qualifies all 17 guard omissions, including two pure and fifteen database cases and the exact-candidate upgrade/recovery proof, including old and populated restores and physical stale-writer refusal. Independent queued-job consent remains required in venue mode; a new regression check and deliberate omission qualify its restoration. The independent CI jobs in [PR #750](https://github.com/waitron-io/waitron-cloud/pull/750) qualify the preserved 255-case legacy matrix and the 360-case nine-group venue matrix at the same head. The legacy test took 139 seconds and the venue test 283 seconds; keep measuring fixture runtime before adding work. Opt-in per-file and per-case timings now identify the service group and source line without exposing paths or test names; CI also records its CPU and memory limits. The seed-batching experiment did not make the proof fit and is removed. The two independent receipts retain all cases, strict fields and head/tree bindings. The measured between-run variability remains a profiling follow-up. A qualification also reported a bound-verifier cleanup refusal followed by live-child cascades. Fixed controller refusals now retain their failed boundary and bounded Docker exit details through the cleanup error, without daemon text, paths or request values. The parent absence check records its boundary; other controller exceptions retain only the parent removal boundary. Callers that print the error can see these details, including Node test reports; the production catalogue still records only `cleanup_uncertain`. The unchanged invalid-archive case and all 47 original bound-container cases pass on the Linux test box; this does not reproduce or explain the historical failure. Use the next instrumented occurrence to distinguish discovery, ownership inspection, removal and absence confirmation before changing cleanup behavior. Ownership fences, verdicts and time limits remain unchanged. Each receipt keeps the approved 330-second child cutoff, its own 360-second test limit and an eight-minute CI job. Both jobs must pass independently at the same head. An earlier release qualification was blocked by a [pinned Node fixture image pull](https://github.com/waitron-io/waitron-cloud/actions/runs/41160662631/job/124417317872) returning an authentication refusal before conformance tests. The underlying registry cause remains open. A later qualification also hit an HTTP 502 while fetching the legacy Node canary image, followed by six missing-image prerequisite failures. [PR #816](https://github.com/waitron-io/waitron-cloud/pull/816) added bounded recovery to that isolation-test acquisition path before resources are created; its controls retain immediate authentication refusal, the three-attempt cap and the shared 120-second budget. The [image acquisition investigation](backlog/cost-image-acquisition.md#isolation-test-node-image-d530) owns that delivered recovery and the unresolved registry outage cause. On repeated CI runs, the test that removes catalogue safeguards in disposable copies exceeded its unchanged three-minute limit. Its fourteen independent guard checks now use two separate checkouts, with the original assertions and deadlines. An isolated Linux comparison drops from 141 to 77 seconds. The [catalogue guard runtime investigation](backlog/snapshot-guard-runtime.md) records the measurements and remaining CI variability. Older upgrade and service assertions remain. Every selected current-head CI job remains the final release gate; production enforcement stays off. Slice J's installation-authenticated billing display now has a plan and a shared contract agreed with Waitron lane B, including state/period combinations, error mappings, five example replies and trusted account/signup destinations. Its pure display projector now uses accepted charge settlement and exact hosted-day allocations, keeps unpaid gaps visible, selects stored trial and lapse facts without inventing transitions, and derives the civil day from an explicit calendar. Its package exports and fixed signing vector are built. The authenticated country reader now derives scope through the stored installation, rechecks current authority after parent-lock waits, reads accepted attempts and exact hosted allocations in one transaction, and selects one effective published price without writing billing or installation state. The separate HTTP endpoint requires the stored installation proof and lease, applies the shared budgets and bounded body read, and keeps billing separate from service configuration. Automatic omission probes cover accepted settlement, unpaid day gaps, scope changes during a wait, revocation and trusted account destinations. The read shares its legal-business parent among display readers while retaining billing-writer exclusion. Real database, HTTP, socket and guard checks qualify the provider; joint Waitron consumer qualification remains open. Long-history read latency and batching historical charge queries still need a measured check before production enablement. Pre-connection public prices and the production billing calendar retain the owner questions raised by lane B. Billing remains internal: production prices, payment collection, invoices, allowances, enforcement and deployment need their later slices and owner gates. The [D568 emergency display and code proposal](waitron-integration-contract.md#emergency-hosting-display-and-code-proposed-d568) answers A1188 part 1 and A1018’s four Cloud questions without extending billing display version 1. It incorporates Lane B’s eight part 1 amendments and remains proposed until Waitron agrees the exact emergency-read revision. Lane A agrees with the four A1018 answers; its amendments now require a permitted person in the copy, a destination key in both the chart and M1’s local node record, valid operation IDs and settings/image compatibility. Hosted enrolment must name the node-record writer, and environment-backed settings with null file digests still need a compatibility design. The inspected unpublished Slice 5 pin must be reconciled with its reviewed result before joint formats and tests. Separate signed facts and on-demand code reads, cached-link freshness, code issue dates and the unqualified hosted authentication, resource and membership-key bindings are specified there; no endpoint, P6 or emergency billing is built by that text. Slice A's [sandbox receipt](billing-provider-test.md) records an unattended SumUp card charge and Stripe SEPA success, failure and dispute notifications. The reported SumUp sandbox fee was €0.25 on €10; the live saved-card rate, live-account enablement and production settlement timing remain unqualified. Prices and allowance
   sizes wait for measurement (the design's §11). Billing cannot go live before the
   Waitron company exists to issue invoices, and that billing software needs its own
   declaración responsable.

   Slice E's [plan](superpowers/plans/2026-10-29-cloud-billing.md#slice-e-allowances-and-remote-access-traffic) is implemented for explicit test/UTC use. Immutable monthly configuration and held, spent or released reservations serialize account and venue budgets, preserve the original operation and month on replay, and retain spent units after uncertain calls. Relay admission commits one spent unit with its queue row. Translation holds items with the job, spends under its current lease and records actual invocation dates; a durable pending-call count prevents another batch or lease takeover from erasing uncertainty. Existing owner, consent, origin, grant, lease, stop, policy and money-cap checks remain independent. Account and worker commands forward the options only when explicitly enabled. There are no production allowance sizes, provider credentials remain excluded from the dedicated test runtime, and production enforcement stays off.

   Signed remote traffic binds reporter, process, configuration and published route identity. The durable spool retains exact pending reports and counters; ingestion commits one source receipt and paired byte event, with exact replay after a lost acknowledgement. Private writer leases bind Linux boot, PID namespace and process start time, so a restarted or reused PID cannot retain a crashed writer’s lock. Unknown or live writer identity still refuses recovery; a retained gap prevents recovered bytes from claiming continuous coverage. Country publication journals both route channels and explicitly empty intervals. Operational probes cannot become user traffic, and missing intervals or unfinished calls cannot prove an unused trial. The existing owner usage summary and its four reconciliation sources remain unchanged. The three rendered traffic scenarios execute once through the discovered Docker wrapper with its private network-administration capability. Actual rendered HAProxy and PostgreSQL fixtures check independently measured bytes, real TLS probes over three controlled dates with zero usage, real user requests over three dates in each venue's stored trial, lost replies, foreign scope and killed-gateway gaps. These controlled-clock checks do not qualify live calendar behavior or a production gateway.

   Migration 048 appends the allowance and traffic schema after main's lifecycle migration 047. All earlier SQL and receipt modes 1–8 retain their meaning. Version 9 qualifies the exact 47-to-48 upgrade: interrupted rollback, concurrent and repeated migration, complete consumer ledgers and separate old and populated backup restores. Matching external keys preserve backup holds, both configuration revisions, held/spent/released reservations, unfinished calls, reporter identity and durable gaps. Pending and older spool replay retains the exact traffic ledger without adding bytes or resetting identity. Historical proof wrappers execute their original installed releases. The retained-job upgrade assertion preserves every original field and additionally requires the new pending-call count to be zero.

   The official guard wrapper independently removes two trial rules and fourteen database, service and traffic guards, requires their specific wrong outcomes, then restores and reruns each case. A spent-state omission must refund two units; a final lease omission must make one real provider call after takeover; operational counter substitution must turn real probes into forbidden ledger events. Two independently installed candidates divide the fourteen cases into equal batches under the original deadlines; both finish before cleanup, and exact coverage and original result order remain mandatory. Strict controls reject setup errors, missing or duplicate cases, skips, incomplete batches and undetected faults. Run the guard and recovery commands in the [registration guide](../packages/registration/README.md#monthly-allowances-in-test-fixtures) on a Docker-capable host. Provider accounts, production sizes, clock-drift/calendar qualification, enablement, live recovery and later billing slices remain separate work. An unconfirmed spent call deliberately keeps later trial evidence incomplete; it is never replayed to manufacture confirmation. Concurrent direct spool calls refuse under the exclusive-writer contract; runtime and child operations use their existing queues. Non-Linux reuse of a different live PID and an interrupted recovery lease remain conservative refusals rather than authority to discard evidence.
4. **Terms, the data processing agreement and service promises.** These are needed before
   the first customer, paid or not, and a lawyer is needed for each, so the questions should
   go out early. The [launch evidence](launch-evidence.md) requires "lawyer-reviewed terms",
   and the D101 design lists six open lawyer questions. Missing: terms of service, the data
   processing agreement with each venue, and the promises Cloud makes about how quickly a
   venue is recovered, how much data a failure can lose, and uptime.
5. **Single-owner account lifecycle.** Each customer organisation has one Cloud account
   owner in its country, with no invitations, manager accounts or concurrent second owner
   (owner, 2026-10-24). Two countries mean two accounts. Design verified country-scoped
   handover that replaces exactly one owner and immediately revokes the former owner's
   access, plus unfinished-transfer and lost-owner recovery protections against abuse.
   Exact endpoints, evidence and recovery policy remain separately scoped here; no automatic
   support takeover or operator, fiscal or activation permission follows from ownership.
   The [revised P3 plan](superpowers/plans/2026-10-22-cloud-global-country-split.md)
   records the boundary and coordinated follow-ups; this lifecycle is not built or approved.
6. **Support and the operator console.** Time-limited support access is built but unused:
   "Nothing uses this primitive in production yet"
   ([support grants](temporary-support-grants.md)). Missing: a way for a customer to ask for
   help, a help desk or support process, an operator console for the owner, and an audit
   trail of what Cloud staff did.

Production email (D102: bounces and complaints) is already tracked and is not repeated here.

## Isolated replay ownership fixture refusal (D294)

**Open; historical cause unknown.** Recorded Linux CI passes all twelve controller
cases, including ownership loss after the worker-deadline case. Current native
diagnostic checks also pass. Neither result explains the historical refusal;
collect an instrumented recurrence before changing the ownership check.
See the [reproduction commands and diagnostic boundary](backlog/isolated-replay-ownership.md).

## Isolated replay result-boundary refusal (D297)

The altered-worker result controls have refused before reaching the result they
were meant to check. The historical cause remains open. Current diagnostics retain
the first transport refusal through the actual worker and host, and the current
Linux host group passes all thirteen cases. Use the
[reproduction commands and next-failure evidence](backlog/isolated-replay-result-boundary.md)
to identify a recurrence before changing request or shutdown behavior.

## Diagnostic download qualification

**Open.** Qualify server redaction, genuine browser downloads and production-network
behaviour. Native refusal and retry checks already pass.
See [the remaining checks](backlog/diagnostic-download-http.md#diagnostic-download-qualification).

## Usage deployment qualification

**Open.** Qualify server authority and production metering before you use totals
for billing or enforcement. See [the remaining usage qualifications](backlog/usage-metering.md#usage-deployment-qualification).

## Native storage admin fallback exhaustion (D506)

**Open.** Admin test listeners and HTTP-derived gRPC choices now stay below the native
service-port range; paused-child controls reproduce the old S3 refusals.
Historical port owners, the progress-control timeout, default native admin
listeners, admin-worker functionality and other programs' bind races remain unqualified.
D584 narrows the exhaustion starting range so the 101 owners and the parent’s
additional 100-port check stay below 32768. The original upper edge fails a
controlled reproduction; the historical CI draw is unknown. Future failures print
the actual candidate and first attempted port, with every predicate retained.
See [the controls and unresolved failures](backlog/storage-cache-fixture.md#native-storage-admin-fallback-exhaustion-d506).

## Repository licence

The root `LICENSE` is copied byte for byte from Waitron's Elastic License 2.0 text.
All eleven workspace and root manifests identify it with `SEE LICENSE IN LICENSE`.
Waitron's separate grants are not included. The owner and watcher control the repository's
visibility; this change does not switch it or alter settings and workflows.

## First working milestone

**Open; the combined milestone is local evidence only.** Repeat the venue connection,
remote access, backup, replacement and gateway checks against the selected deployment
before launch. Live providers, deployment and secret custody, database recovery,
final-write handover and automatic appliance setup remain open; see the
[milestone requirements and remaining qualification](backlog/first-milestone.md).

## Fiscal allocation registry

Cloud no longer runs the obsolete fiscal allocation registry. Waitron generates
time-based codes; its caller removal landed in
[Waitron PR2228](https://github.com/clintongormley/waitron/pull/2228) at
`2297688a6bbaa29eaa11cbee283681d388efd069`. The
[removal design](superpowers/specs/2026-10-29-remove-fiscal-registry-design.md)
and [implementation plan](superpowers/plans/2026-10-29-remove-fiscal-registry.md)
record the boundary. The workspace package, account and installation HTTP routes,
portal journey and live cost producer are removed. Old document links receive the
ordinary translated missing page; old API calls return `404 not_found` with the
same host, query and security checks as other missing routes.

Migration 038, its dormant tables and stored rows remain unchanged. Registration
owns the seven retained schema tests and the digest/ledger-position check. Removal
regressions compare every dormant table and the migration ledger before and after
old calls and free/paid/free plan changes. Shared account, session, recovery and
mail assertions remain. Live CI keeps nine packages, 30 logical shards in 29
jobs and all six receipt suites, including all six portal shards. Saved historical
manifests and cost receipts remain historical evidence; their parsers and positive
receipt-selection checks remain. The [registry reference](fiscal-allocation-registry.md)
preserves the withdrawn contract and its old anchors. No outside journal, custodian,
registry signing service or registry enablement work remains in the Cloud product.
Destructive retirement of stored records or shipped migration history still needs
a separate owner decision. Ordinary backup verification and local recovery keep
their existing authority checks.

**Maximum-hour lease fixture timing.** Full main CI `39247738663` failed
`staff-certificates.test.ts` before its production-installation HTTP 403 check:
the issuer refused a fixture built from two clock reads. Advancing only lease
construction by one millisecond reproduces `invalid_proof` through real PostgreSQL.
The fixture now derives expiry from one issuance timestamp; its permanent advancing-clock
case verifies the signed lease lasts exactly 3,600,000 ms and retains the HTTP 403.
The outage proof's live retired-key control had the same two-clock construction.
Its complete PostgreSQL/SeaweedFS/HTTP journey also reproduces the refusal under
that clock control and passes after the same correction, retaining key-removal,
expiry and revocation checks. Both corrections leave production code, existing
assertions and individual deadlines unchanged. CI did not record its clock values,
so the exact historical timing remains unproved.
A two-millisecond advancing-clock experiment also reproduces the issuer refusal
in expired leases built from separate clock readings. The `relay-messages.test.ts`,
`relay-operator-stop.test.ts` and `captures.test.ts` fixtures now derive both times
from one reading. Each existing HTTP refusal test advances the clock during
synchronous lease construction and restores it before making requests, preserving
all expiry, permission, HTTP assertions and deadlines. A Docker-free probe executes
the four actual construction blocks with the real issuer and verifies that each
signed lease lasts 3,599,999 ms and is expired. The staff revision/revocation
fixture also uses one timestamp under the same clock control, retaining every
HTTP, revision and revocation assertion. PostgreSQL and HTTP journeys are
qualified by CI while local Docker is unavailable. The historical CI clock values
remain unknown.

**Relay worker counter fixture timing.** CI `40266435807`, registration shard
4/5, refused the initial operator-stop submission with `relay_counter_expired`:
the counter ended at `1792987200000`, and the final database check observed
`1792987200001`. Worker fixtures now start their unchanged one-hour counter
window from PostgreSQL's setup timestamp, keeping handoff and stop checks
independent of the wall-clock hour. Nine Docker-free cases execute the actual
fixture configuration and counter calculation across that boundary, including
an application clock two hours ahead or behind. Production expiry, limits and
all existing worker assertions remain unchanged. Use current-head CI for the PostgreSQL worker journeys while local Docker is down.

**Short lease fixture timing.** The capture object-write and installation-lock
fixtures, and the replacement provider-grant fixture, derive expiry from one
issuance timestamp. A Docker-free advancing-clock probe executes their actual
construction statements with the real issuer and verifies signed durations of
100, 250 and 600,000 ms. All existing refusal assertions and waits stay unchanged;
GitHub CI qualifies the PostgreSQL journeys while local Docker is unavailable.

## Translate all: approved design, implementation still open

See [the retention cadence and native transport checks](backlog/translation.md#retention-cadence-and-additional-http-boundaries)
for completed local qualification and the production limits it retains.

The design and 24-task plan are owner-approved; Tasks 1–21 are implemented.
Keep translation off until the remaining Cloud, joint Waitron and release checks,
owner-only quality trials after 2026-11-02, and commercial and production decisions
are complete; preserve the approved cap, admission, consent and paging rules in the
[translation requirements and open work](backlog/translation.md).
The separately scoped [owner's demo-menu trial](../packages/translation/README.md#try-the-owners-demo-menu)
still needs the server-only key, its live provider result and the joint Waitron handoff;
ordinary-client refusal and public privacy, supplier and release work remain open.

## Initial focus

**Open; local building only.** Launch first in Spain on AWS and keep routine customer
journeys self-service. Qualify remote access, replacement recovery, hostnames, cell
movement and outage behaviour against the [requirements and deliberate limits](backlog/initial-focus.md).

## Free services for open-source Waitron

**Open; production enablement is not approved.** Offer address lookup and transactional
email to open-source Waitron users with a Cloud login, without a paid subscription.
The owner’s test-box trial has an explicitly injected signed address route;
Waitron’s joint screen proof and live Google trial remain open; the
[private key-file provider](address-lookup-trial.md#inject-the-private-provider) has synthetic
removal/replacement checks. Qualify providers,
storage rights, address quality, account allowances, abuse limits and the joint
Waitron integration against the [requirements and open work](backlog/free-services.md).
Evaluate mobile notifications separately.

## Decisions in progress

**Open; individual decisions and qualification gates still apply.** Keep the customer,
staff-access, residency, cell, provider, package, usage, Waitron-boundary, server-lifecycle
and recovery choices together in the [decision table](backlog/decisions-in-progress.md).
The table preserves the agreed direction and identifies what still needs a decision,
implementation or production evidence.

## Platform work to scope

- **Remote fixture startup failure still needs attribution.** Merge conformance run
  `39906100584` on `a0404ad26282fadd30676266dd23c3ba439e1c4e` failed only the
  `false-availability` case in `remote-waitron-conformance.test.mjs`, after the
  unchanged 30-second readiness deadline. The same case passes locally through
  `node scripts/test-postgres.mjs exec node scripts/cloud-cost/conformance.mjs --only remote-waitron-conformance.test.mjs --pattern false-availability`.
  Both gateway and browser readiness probes now retain a fixed transport, TLS, HTTP, response-shape or
  command phase without printing response bodies, keys or raw errors. Capture that
  phase on recurrence before choosing a fix. This diagnostic change does not
  identify or fix the historical failure. The two-second request timeout,
  30-second startup deadline and all original gateway and browser journey checks remain.
  A separate browser fixture refusal in [PR594's cost run40536958436](https://github.com/waitron-io/waitron-cloud/actions/runs/40536958436/job/122305238271)
  occurred during the gateway's `docker start`, before any browser phase. The command
  wrapper now retains a fixed command category, failure reason, exit code or signal,
  and output byte counts capped at one MiB per stream. Arguments, paths and output
  contents stay private. Native child-process checks cover exit, signal, missing
  executable, output limit and the unchanged 30-second timeout. Existing browser
  refusal labels and all journey, ownership and cleanup checks remain unchanged.
  Capture the next labelled failure to identify the startup cause; these controls
  do not explain the historical Docker delay. Local Docker qualification stays
  parked until 3 November; current-head CI runs the genuine gateway journeys.

- **LAN test Cloud with free and paid organisations.** The dormant PR7 proof
  runner and [source-bound evidence assembler](test-cloud.md#assemble-the-local-evidence-before-release-qualification)
  combine genuine free/paid pairing, captured account mail, paid archive
  verification and non-activating recovery, continuous recovery, snapshot fallback,
  remote isolation/withdrawal, same-run snapshot credential expiry and matching
  four-volume rollback. Free-service fixtures stay separate from unavailable
  Waitron relay/translation journeys. The fixed project is `waitron-cloud-test`;
  protected Waitron containers are never adopted.

  The recorded Linux journey at `31c3f8343795d9d2ed340cd20fa7eeb2534cbcbf` passes
  both combined cases without skips in 1,083.6 seconds. Both original pairings
  exchange freshly after rollback; all 533 resource readings pass the original
  limits. Independent cleanup finds all 539 recorded owned container IDs absent
  and protected Waitron unchanged. A separate exact-source free-service run passes
  seven groups and 255 tests without skips. The assembler checks their source,
  image, generated-asset, recovery, withdrawal, resource and cleanup bindings.
  These measurements retain their original source identity after rebasing; they
  do not qualify the current release image. Historical failure diagnostics remain
  in the [test Cloud guide](test-cloud.md), with unresolved causes still unknown.

  Whole-branch review found additional proof-runner gaps. Cleanup now uses run
  ownership labels and recorded resource IDs, preserves foreign resources sharing
  a project name, and retains verifier state after a failed stop or scope read.
  Controlled Linux checks cover owned cleanup, foreign resources, stop refusal
  and actual Compose ownership rendering. Whole-run cancellation now drains cleanup
  during command gaps. The proof and deployment CLI share a stable admission lock
  and refuse orphan owner-labelled resources. Cloud source measurements execute
  host-supplied code, include tracked plus-named inputs and refuse unsupported
  paths. The assembler requires the pinned client, ordinary fiscal refusal,
  restart observations, remote peer and resource-measurement method. Private JSON
  failures use a fixed error. Current-head CI still gates this dormant branch;
  none of these controlled checks qualifies a release or enables deployment.

  **Open:** the owner-authorised **Cloud/Waitron release driver**, after this
  dormant proof branch finishes, owns published-image upgrade and rollback
  qualification. It must bind immutable published Cloud and Waitron digests to
  their exact source, compiled verifier target/module manifest and generated
  assets, name a supported old/new release pair, prove its real schema upgrade
  and old-consumer refusal, then restore the matching database, configuration,
  storage and gateway state and prove both original pairings still exchange.
  See the [release-driver handoff](test-cloud.md#release-driver-handoff).
  Publication remains `unqualified`; complete-integration and shipping flags stay
  false. Final complete receipt, current-release resources and later reviewed LAN
  deployment remain required. Snapshots stay unavailable, plan enforcement and
  deployed translation stay off, address providers stay disabled, and no image
  publication, account, provider resource or spending is authorised here.

  Other open maintenance remains separate: keep organisation writes in the plan
  setter, since shared policy readers that update their organisation can deadlock
  while upgrading locks. Qualify a consistent route view across the two export
  reads and production-scale processing before promising uninterrupted movement
  or larger capacity. Qualify recovery from definitive daemon rejection without
  clearing uncertain verifier journals. Same-CA in-volume renewal, continuous box
  supervision and the coordinated image/schema and volume-to-volume rollback
  deployment path remain open. The existing Waitron venue is quarantined: use
  disposable venues and leave its running containers and data untouched.


- **Translation worker lock-probe timing is now independently exercised.** The
  existing review-totals case put a PostgreSQL lock probe inside its fake HTTP
  response while the real client allowed 100 ms. A controlled 150 ms probe on
  landed base `050084752f1c57b00183582a2d16d33b0555f5e8` produces a provider timeout
  and three requests instead of the expected two. The probe now runs at the
  worker's provider-call boundary before starting that same HTTP deadline, with a
  deliberate 150 ms database delay. The original done/review totals, NOWAIT lock
  check and exact two-request assertion remain; both provider calls are probed.
  The earlier unexplained observations remain separate unless their exact trace
  matches this reproducer. No provider retry policy, production code or deadline
  changed.
- **Password-login recovery-row expiry setup.** The recovery-row test now starts
  its unchanged 500 ms challenge expiry after acquiring the row it will hold.
  A deliberate 650 ms setup delay reproduces the earlier missing-lock assertion
  with the old ordering and passes with this precondition. The 550 ms held-row
  wait, lock observation, zero sessions, one spent attempt, unconsumed recovery
  code and 30-second test deadline remain unchanged. No authentication code or
  policy changes. [Run 39112504573](https://github.com/waitron-io/waitron-cloud/actions/runs/39112504573)
  did not capture expiry/setup stages, so its exact historical ordering remains
  unproved. Capture those stages if the same assertion fails again; do not extend
  its authority window or test deadline to hide a failure.
- **Local package validation must avoid concurrent full-package groups.** Four
  two-file-worker groups overlapped during D79 and the registration control CLI
  exceeded its unchanged five-second command bound. A landed-base phase probe
  completed every node/root/package command in under 700 ms after reducing the
  overlap; acknowledgement-to-close took at most a few tens of milliseconds.
  This does not prove the cause of the earlier nine-minute stall. Run local full
  package suites sequentially with two file workers and retain the five-second
  assertion. Capture process/phase timings if it fails under that arrangement.
- **Local registration run stalls after earlier failures.** In the test-plan
  review checkout at `cc99eef378bd9db2716a2325cd07fbe491ab06c9`,
  `node scripts/test-postgres.mjs exec pnpm --dir packages/registration test`
  emitted failures and left its sole `relay-control.test.ts` child alive for more
  than nine minutes despite the 30-second test timeout. The driver stopped that
  recorded child. An isolated run of the same command on landed base
  `f56b4c8595ed3cb81d0931352c0bac2880648e18` reproduces PostgreSQL
  `out of shared memory` within seven seconds; it was stopped after that observed
  failure. This proves a baseline resource failure, but not the cause of the
  nine-minute child stall. Neither interrupted run is a pass.
  The review's default-concurrency account suite also emitted failures. Complete
  registration/account suites passed all 679/382 tests with two file workers on
  the corrected PR2 branch. PR3 passes 679/384 and runs full packages sequentially. Capture the full output of both default-concurrency commands,
  without piping it through `head`, and diagnose failure cleanup and resource
  contention. Preserve every assertion and deadline; do not treat a rerun as a fix.
- **Operating cost.** You can compare the running platform and per-venue usage
  with the [offline calculator](cloud-cost-calculator.html) and
  [model explanation](cloud-cost-model.md). They show priced subtotals at zero,
  1, 10, 100 and 1,000 venues, with editable assumptions, English and Spanish,
  light and dark themes, and layouts for 390 and 1280 pixels. The complete bill
  remains unknown. The nightly generated-storage warning compares byte-seconds
  only. Blank inputs and missing billing terms stay named gaps;
  neither a priced subtotal nor a successful verification command means the
  service has a complete or provider-validated operating budget.
  The [approved design](superpowers/specs/2026-10-14-cloud-cost-model-design.md)
  and [implementation plan](superpowers/plans/2026-10-14-cloud-cost-model.md)
  define this evidence boundary.

  **Public inputs and arithmetic.** The [resource inventory](cost-model/inventory.json)
  covers required capabilities, runtime roles, alternatives and excluded future
  products. The [price snapshot](cost-model/prices.json) records dated Spain,
  Stockholm and global rates, their exact sources and billing dimensions.
  Missing regional prices, minimums and rounding rules stay unknown. The
  calculator uses the same validated model in Node and the browser. It prices
  whole gateway/database capacity steps and aggregate request tiers, preserves
  startup and idle work when sales are zero, and simulates calendar archive
  growth. Month-one and later-retention storage are alternative windows, never
  added into one month. Resource size, capacity, future growth, traffic mapping
  and low/base/high sensitivity remain assumptions. Daily and monthly archives,
  continuous-stream retention and noncurrent versions remain distinct.

  **Accepted local samples.** The [joined evidence](cost-model/local-driver-evidence.json)
  preserves each experiment's source revision, clock, scope and limitations:

  - The [stream receipt](cost-model/measurements.json) replays all 207 selected
    sales through the pinned Waitron sale writer, preserving its normal fiscal
    integrity checks. It observes startup, accelerated workload, 1,200.009
    seconds of idle traffic and a successful native restore. Copied source size
    is 19,546,112 bytes; fresh-venue database growth is 700,416 bytes. All 342
    physical requests reconcile between independent counters, including setup,
    observer, restore, cleanup and eight failed attempts. Retained byte-seconds
    have explicit lower/upper bounds. This short unversioned experiment observes
    neither a full trading day nor a scheduled snapshot/compaction boundary.
    A separate three-sale original-cadence control exposes batching sensitivity;
    its different duration/background work cannot supply a daily correction.
  - The [selected-sale archive](cost-model/archive-replay.json) captures a
    3,527,677-byte archive and restores all 207 sales through the application
    with valid integrity and owned cleanup. The
    [one-sale storage sample](cost-model/archive-storage.json) separately measures
    a 2,835,270-byte generated archive, eleven storage attempts, a complete and
    range read, HEAD, listing, an abandoned multipart part and cleanup. Its
    transfer counts cannot substitute for the selected-sale archive's transfers.
  - The [generated owner browser journey](cost-model/remote-owner-browser.json)
    measures 2,836,968 encrypted response bytes through the real isolated gateway,
    including cold/cached loads, sign-in, dashboard, reconnect and sign-out.
    Interrupted stream bodies and IP/TCP/WireGuard overhead remain outside its
    body counters. The separate [owner/public API sample](cost-model/remote-owner-public-api.json)
    covers generated API actions. Choose one owner scenario; summing API and
    browser scenarios would overlap. Neither sample measures typical venue
    activity, public browser use or provider-billed transfer.
  - The [mail retry and fiscal lifecycle](cost-model/service-mail-retry-fiscal-lifecycle.json)
    and [signup, recovery and refusal](cost-model/service-signup-recovery-fiscal-refusal.json)
    samples preserve captured-mail attempts, refusals, retries and fiscal HTTP
    body counts. They issue no additional fiscal authority through replay or
    inspection. SMTP bytes, production alert eligibility and monthly service
    frequencies remain unknown.

  **Private measurement controls.** Online SQLite copies include committed
  transaction-log writes without migrating, checkpointing or reseeding the source.
  Private replay uses only owned scratch and an internal Docker network, checks
  effective isolation before opening data, excludes live credentials/senders and
  runs the genuine pinned writer/archive/restore paths. Every storage HTTP attempt
  is metered independently, including retries, failed replies, versions, deletion
  batches and unfinished multipart work. Unknown or ambiguous histories refuse
  complete evidence. Cancellation collects admitted writers before closing their
  measurement transports; replaced paths, lost ownership or unverifiable cleanup
  refuse deletion and retain the recorded resources for explicit recovery.
  The [generated conformance fixtures](../scripts/cloud-cost/fixtures/) exercise
  these boundaries. No fiscal allocation, hash-chain or golden rule is changed.
  Raw data, names, row identities, object keys, credentials and payloads stay on
  the Mac. Closed anonymous export rejects extra/hidden fields and raw canaries.

  The generated streamed-day check now prints its fixed outer stage and the last
  32 validated replay/native events when it refuses. The parent prints this
  evidence explicitly before rethrowing the child-command failure; raw exceptions
  and private fields are excluded. Run
  `node --test scripts/cloud-cost/streamed-day-diagnostics.test.mjs` for native
  child controls, the actual smoke catch, reporting failures and owned cleanup.
  This addresses the missing evidence in
  [run 41003745800, job 123893874129](https://github.com/waitron-io/waitron-cloud/actions/runs/41003745800/job/123893874129),
  which stopped at `private-replay`. Its historical Linux cause remains unknown.
  Capture a labelled recurrence and reproduce it with the pinned runtime when
  Docker returns; preserve accounting, cleanup, existing assertions and deadlines.

  **Forecast and live-check limits.** The [component projection](cost-model/usage-projection.json)
  applies explicit [assumptions](cost-model/projection-settings.json), preserving
  separate phases, failures, retry identities and source windows. Default future
  sales are an assumed 207/day after saved-clock reconciliation, rather than the
  earlier midnight-based source-selection count of 203. Owner/public/service/
  recovery frequencies start unset. This projection is not a complete daily
  object-size/lifetime, version, multipart, schedule or retry vector.
  The [trial assessment](cost-model/live-check.json) therefore stops before any
  AWS creation. Its illustrative high-cadence workload component alone projects
  130,000 requests above the 10,000 cap before cleanup. That sensitivity is
  assumed, not a proved upper bound. An under-cap base estimate cannot bound
  missing work, and no measured operation may be truncated to make the trial fit.
  No resources or synthetic payloads were created for this trial, and no billing
  read is due for it. The earlier storage rehearsal and its follow-ups stay separate.

  Local preflight helpers reserve cleanup requests/time, versions, multipart,
  active key hours and delayed/cancelled-deletion contingencies; unavailable
  applicable credits or missing price bounds refuse a plan. Consumption guards
  charge attempts before dispatch and refuse reused/altered budgets. These checks
  establish no generated-byte provenance or provisioning authority. Billing helpers
  compare gross usage and credits separately, retain prior-key/other/ambiguous
  lines, flag cost or quantity differences above 20%, and plan at most three
  physical reads including continuation/retry. They perform no provider I/O;
  independent synthetic generation, an owned-resource runner and durable billing
  execution remain future prerequisites if the stopped trial is ever revisited.

  **Rebuild and verify.** Run `node scripts/cloud-cost/cli.mjs build` and
  `node scripts/cloud-cost/cli.mjs verify`. They read only public inputs and
  compare the generated HTML, explanation and stop assessment without starting
  private replay or contacting AWS. `pnpm test:cloud-cost` runs synthetic checks
  and artifact verification; CI includes it alongside all five prior receipt suites.
  Compiler, real-browser, deliberate-fault and generated local-storage checks cover
  the model and its boundaries. Storage-only evidence validates neither fixed
  infrastructure, AWS capacity nor a full provider bill.

  Run `pnpm test:cloud-cost:conformance` for the deeper generated-data checks.
  Its setup fetches the pinned public Waitron source, compiles the required
  runtime exports and prepares local images without a venue source path. CI
  discovers all eighteen files, with the longer stack file split into three
  disjoint groups. Publication verification remains separate and offline.
  The model command verifies public inputs and artifacts. The owner-approved native deadline
  fixture holds its generated idle observation until shutdown is requested,
  preserving both original 43/44-second limits and every source, startup and
  cleanup assertion. It also requires deadline and cleanup to finish within
  56 seconds. The real generated cancellation and deadline checks both pass;
  neither check changes a production timeout.
  Linux conformance exposed a PostgreSQL initialization race: temporary database
  files now live on container-native scratch, outside the scanned ownership tree.
  The merge's unversioned ambiguous-multipart case also refused stack startup
  before its storage assertions. Generated Linux timing probes reproduce ownership
  scans racing deletion of `state/replay/venue/migrations.lock-journal`
  (`39635884776`), `state/mail.db-journal` and a storage `config.json.tmp`
  (`39636087276`, stack group 3). The generated venue, mail and storage databases
  now live on container-native scratch, outside that scan. The ownership guard
  stays unchanged. Separate real-service regressions check that sales, integrity,
  mail and storage still work without placing mutable service data on the host
  mount. Each generated service has a 64 MiB private scratch limit. Keep fixture
  data within it or make a separate bounded capacity change before larger uploads.
  The earlier stream-startup failure (`39616174409`) and merge refusal
  (`39627846860`) had no underlying trace; attributing those exact historical
  failures to these races remains an inference. Keep their logs and all ownership,
  isolation, accounting and cleanup assertions and deadlines. Temporary diagnostic
  workflows are removed.
  Another stack-start refusal occurred in
  [run 39743485615, stack group 1](https://github.com/waitron-io/waitron-cloud/actions/runs/39743485615/job/119706230844):
  `genuineArchiveAndSignedSdkTrafficReconcileThroughRealStorage` failed after
  3.6 seconds before its archive assertions; the other nine group cases passed.
  `startIsolatedStack` replaces its underlying error at `local.mjs:659`, so the
  cause is unknown. The test-image handling branch changes no cost runtime,
  fixture or workflow. The exact case passes locally through the new launcher
  with all archive, accounting and cleanup assertions intact. That passing probe
  explains neither the Linux failure nor a correction. Next: capture a bounded,
  sanitised startup stage and underlying refusal before cleanup, then reproduce
  it without relaxing ownership, isolation, accounting or cleanup checks.
  A separate paced-replay check refused after 75.8 seconds in `39637622744`.
  Its saved error is generic and exposes no underlying stage. One generated-only
  instrumented Linux run passes (`39638725311`); this does not establish a cause
  or correction. The paced-replay worker does not use the stack service runtime
  changed above. The isolated controller now preserves a bounded failure trace
  after normal cleanup and during result admission: fixed replay and stream stages,
  native exit codes and signals, stderr byte counts and fixed keyword flags. Unlisted signals
  use a fixed `other` code. The paced test prints the complete admitted trace on
  failure. If diagnostic inspection, JSON serialization or the reporter fails, you
  still receive the exact original replay refusal. The reporter reads only an own
  data property, without invoking accessors; native checks cover null and undefined
  refusals, hostile proxies, circular and non-serializable diagnostics, and failed
  output. Run `node --test scripts/cloud-cost/replay-diagnostics.test.mjs` for these
  checks. Raw output, paths and exception text stay private. Diagnostic traces
  and native keyword lists now require plain dense arrays with visible own data
  indices. Trace fields must also remain visible when copied;
  sparse arrays, accessors, proxies, custom properties and custom prototypes
  refuse before executable properties run. This prevents a keyword getter from
  changing an admitted flag into private text while the validated trace is copied.
  Native checks reproduce that substitution and preserve the existing label/count
  bounds and independent copies. Run
  `node --test scripts/cloud-cost/worker-trace-arrays.test.mjs`.
  This qualifies the in-process validator; it does not establish that an external
  caller can supply such objects through the worker's JSON files. Generated failures
  exercise the worker boundary and malformed-trace refusals. If resource cleanup
  itself refuses, its error can still be generic; preserve the private journal's
  validated trace before fixture cleanup. Both historical paced failures remain
  unexplained. Capture the trace on recurrence and fix its cause; preserve the 207-sale restore, integrity, source and
  cleanup checks and limits. An unchanged generated reproduction passed 13 times
  locally and 36 times across all 12 jobs of
  [Linux run 39857085282](https://github.com/waitron-io/waitron-cloud/actions/runs/39857085282)
  at `42f3b05d981769fb754ebcf984766a4f885f284e`. These passes do not identify or
  correct the historical failures. Local scratch samples peaked at 22,444 KiB
  within the unchanged 65,536 KiB limit; those samples do not establish the peak
  during a failure. The temporary branch-only investigation workflow is removed.
  A controlled child-process test separately reproduces premature stream readiness:
  a completed read can release workload before the first successful upload.
  Readiness now waits for a completed successful native PUT, matching the existing
  startup admission requirement. Reads, refused and unfinished writes do not
  satisfy it, and the original deadline still collects a writer that never uploads.
  This fixes the reproduced readiness gap; without a trace from the historical
  failures, it does not identify their cause. Startup observation keeps the original
  first-transfer clock and overlaps upload readiness. The first candidate instead
  waited for an upload and then began a separate observation; a real generated
  reproduction exhausted the unchanged 4.01-second deadline during startup.
  The corrected composition preserves the full two-second observation, the idle
  refusal, early-timer-wake checks and every original deadline. Diagnostic-only
  generated failures now retain their phase and elapsed-stage trace.
  A controlled hang-child reproduction now distinguishes a child that stops
  writing but ignores termination from one that keeps writing until forced
  collection. The original hang fixture kept scheduling uploads after SIGTERM;
  holding its next upload reproduces the generic cleanup refusal from
  `39953541488` receipt job `120415065191`. The hang fixture now suspends itself
  on SIGTERM until the unchanged two-second forced kill.
  Its delayed regression holds uploads only after SIGTERM and requires SIGKILL
  and exact owned-resource collection. A separate
  still-writing child must refuse interrupted accounting while reporting completed
  resource collection. Production code, original assertions and deadlines remain
  unchanged. The historical job has no transfer trace, so attribution to this
  reproduced overlap remains an inference. Earlier paced failures stay unexplained.
  The same named paced-replay test also failed after 76.1 seconds in
  [run 39829272927](https://github.com/waitron-io/waitron-cloud/actions/runs/39829272927/job/120000877058),
  while qualifying the browser-source repair after Actions recovery. Its image
  build completed, then `runIsolatedReplay` returned the same generic error.
  That diagnostic head changed no cost-model files relative to `5b709aa`.
  Its saved log has no underlying worker stage; the later bounded traces and
  separate startup correction do not establish that historical failure's cause.
  A later paced failure in
  [cost run 40489223783, job 122138753711](https://github.com/waitron-io/waitron-cloud/actions/runs/40489223783/job/122138753711)
  stops at `quiesce` after a zero native exit, before restore. That label combines
  several independent checks. You now receive separate fixed codes for waiting
  for idle transfers, waiting for child collection, validating its stop result,
  checking post-stop health and checking storage accounting. A separate code
  marks restore admission after that checkpoint completes. Cancellation can
  refuse any active operation; these codes identify its boundary, not its cause. Native child/HTTP tests
  distinguish nonzero stops, interrupted transfers, cancellation after a zero
  exit and inconsistent storage inventory after a zero exit. A held child
  reports collection in progress before the unchanged forced-kill timer fires.
  Each controlled failure refuses publication and collects owned resources. Run `node --test
  scripts/cloud-cost/replay-stream.test.mjs scripts/cloud-cost/replay-quiesce-diagnostics.test.mjs`.
  The historical cause remains unknown; capture the new boundary on recurrence
  before changing any accounting, ownership, restore or deadline guard.
  Another paced replay refused at `quiesce-checkpoint` after a successful native
  stop in [run 40954158356, job 123729967144](https://github.com/waitron-io/waitron-cloud/actions/runs/40954158356/job/123729967144).
  You now receive a fixed `measurement-refusal` code distinguishing checkpoint
  admission, independent inventory verification, rejected traffic during verification
  and accounting snapshots. A request refused while inventory is running has its
  own traffic code, even when it later poisons accounting. Cancellation is labelled
  by the operation it interrupts. The code
  survives replay and worker admission without exposing raw storage errors. Native
  HTTP controls refuse closed sessions, unobserved objects and overflowing storage
  totals; a native writer control verifies forwarding after a successful stop.
  Reporter exceptions cannot replace the refusal or prevent listener collection.
  Run `node --test scripts/cloud-cost/stream-checkpoint-diagnostics.test.mjs
  scripts/cloud-cost/replay-stream.test.mjs`. These controls reproduce diagnostic
  boundaries; the historical Linux checkpoint cause remains unknown. Capture the
  new code on recurrence before changing accounting, ownership or deadline checks.
  The checkpoint boundary recurred in [run 41449381877, job 125290693382](https://github.com/waitron-io/waitron-cloud/actions/runs/41449381877/job/125290693382)
  with `transfer-interrupted`, zero pending and 111 completed transfers. Its trace
  discarded the HTTP details already recorded by the transport. You now retain
  the recorded HTTP event, network error code, storage operation, count of idle
  callbacks at admission, closed-client flag and response-header flag through
  the worker and host. These optional fields accept only fixed codes, booleans
  and a bounded count. Raw paths, headers, bodies and error text stay private.
  Read these as recorded transport fields, rather than proof of one exception.
  A real HTTP control cancels a LIST after an idle callback and verifies that
  the details survive while accounting still refuses publication. Run
  `node --test scripts/cloud-cost/checkpoint-transport-details.test.mjs`.
  The unchanged paced case passes once on the shared Linux test box with
  `node scripts/cloud-cost/conformance.mjs --only paced-replay-conformance.test.mjs`;
  that does not reproduce the historical failure.
  This repairs evidence loss, not the historical paced-replay failure. Capture
  the next trace and reproduce its first event before changing measurement guards.
  The D121 recurrence in [cost run 40144665901, job 121023380173](https://github.com/waitron-io/waitron-cloud/actions/runs/40144665901/job/121023380173)
  reaches `storage-cleanup` after successful native replicate and restore exits.
  Cleanup now retains its first refused operation as a fixed `storage-refusal`
  stage in the worker trace, including inventory, deletion, accounting and resource
  collection. Generated failures exercise persistence and reporting containment;
  real-backend checks cover SDK refusals and retained-inventory disagreement.
  Separate worker codes identify failure while constructing cleanup input or
  shaping its result. All eighteen storage codes have generated fault checks.
  The historical cleanup operation and cause still need an instrumented recurrence
  and reproduction. Accounting, ownership checks and deadlines remain unchanged.
  A generated setup-client shutdown exception no longer stops independent cleanup.
  The worker tries a fresh cleanup client, collects its owned bucket when that
  client opens, and closes its listener and child process. Any failed step still
  refuses measurement and retains the private directory; a failed replacement
  client never sends requests through the stale setup client or records a bucket
  cleanup intent. A client whose instrumentation fails is closed before refusal.
  The first fixed diagnostic remains available without raw SDK errors. Whether the real SDK
  naturally throws there and the historical Linux cleanup cause remain unverified.
  The successful browser journey also refused in
  [run 39890570428](https://github.com/waitron-io/waitron-cloud/actions/runs/39890570428/job/120209134728),
  while all six deliberate-fault journeys passed. Its wrapper retained only the
  generic refusal. Browser failures now retain a fixed phase through the generated
  child boundary, without printing launch errors, URLs or credentials. The complete
  seven-case journey passes locally; that pass does not identify the historical
  failure. A later merge cost run
  [40004973526](https://github.com/waitron-io/waitron-cloud/actions/runs/40004973526/job/120590562266)
  refuses the successful journey during reconnect after 16,602.897 ms; all six
  deliberate-fault journeys pass. Setup completed and the same tree passed all
  seven cases in exact-head run `40003626992`. The historical operation and cause
  remain unknown; the duration alone does not establish a timeout.
  Reconnect failures now carry one of four fixed operation labels through the
  generated child boundary: reload, takings, overdue-empty or requests. Controlled
  failures exercise each browser operation, and a real child-process check carries
  only the allowed labels into the parent refusal. Raw browser errors, URLs and
  credentials stay out of the diagnostic. Run
  `node --test scripts/cloud-cost/browser.test.mjs scripts/cloud-cost/browser-diagnostics.test.mjs`
  to check the labels, redaction and unchanged failure cleanup. Every original
  accounting, isolation, cache and cleanup check and deadline remains intact.
  A later recurrence in
  [40092022379](https://github.com/waitron-io/waitron-cloud/actions/runs/40092022379/job/120866647453)
  identifies reconnect/takings. The whole test took 16,188.328 ms; that is not
  a measurement of the takings wait. It still has no underlying error category.
  Reconnect refusals now retain three more fixed observations: whether the thrown
  error identifies itself as a timeout, the last session-check response observed
  during reconnect (accepted, refused, other or none), and whether a page error
  occurred during reconnect. A later session response replaces an earlier one;
  this label does not preserve the full response history. These observations use
  existing events and add no browser request or wait. Only the fixed labels cross
  the generated child boundary; exception text, URLs, credentials and page content
  remain private. Run `node --test scripts/cloud-cost/browser-refusal-evidence.test.mjs`
  alongside the command above to check the boundary, unusual thrown values and
  failed diagnostic output. Original tests and journey deadlines stay unchanged.
  Capture an instrumented Linux recurrence before attributing the historical
  cause. A passing unchanged repeat would not explain it. Local Docker-backed
  qualification remains unavailable until Docker returns; CI runs the real journey.
  Reconnect refusals also retain fixed request-event counts, grouped by known
  route, whether Node first observed the request before or during reconnect,
  and lifecycle event. This does not establish when Chromium issued it. Pending requests remain visible, including streams from before reload.
  Counts saturate at 999; raw paths, query strings, bodies and network errors
  are never printed. These passive observations add no request or wait and do
  not change the existing accounting refusal or deadlines. A not-modified
  response (HTTP 304) has its own label, separate from a redirect. Run
  `node --test scripts/cloud-cost/browser-traffic-evidence.test.mjs` for the
  controlled lifecycle and real child-boundary checks. The cause of the Linux
  takings timeout and outstanding-request refusals remains under investigation.
  Twelve independent Linux observations ran the complete seven-case group at
  diagnostic heads `6bdf753` and `a58e794`: all 84 cases passed. A later instrumented
  recurrence in [run 40122070386](https://github.com/waitron-io/waitron-cloud/actions/runs/40122070386/job/120955659784)
  times out at reconnect/takings with an accepted session and no page error.
  Both overview and overdue requests fail, alongside other API and live-stream
  requests. These counts do not identify the underlying connection failure.
  Reconnect refusals now retain the byte-counting relay's first refusal category
  before browser cleanup. You can distinguish a socket reset, refused connection,
  broken pipe or other socket error, timeout, incomplete close, empty exchange,
  admission or byte limit, cancellation, observation-window end, listener error
  or accounting refusal.
  `none` means the relay had not refused when the browser error was caught.
  Later cleanup cannot replace the first category. Socket sides identify the
  browser-facing client or gateway-facing upstream; raw network errors and payloads
  stay private. Run `node --test scripts/cloud-cost/remote-refusal-evidence.test.mjs scripts/cloud-cost/browser-relay-evidence.test.mjs`
  for real relay sockets with controlled resets and injected faults, preserved
  accounting refusals and the child-process diagnostic boundary. These controls do not establish the historical Linux cause.
  Browser readiness waits for stream-open callbacks and their reads, rechecks
  requests while response sizes settle, and retains the three-second deadline
  and every byte-accounting guard. Run
  `node --test scripts/cloud-cost/browser-readiness.test.mjs` for these boundaries.
  The browser source now includes Waitron's
  [document-lifecycle repair](https://github.com/clintongormley/waitron/pull/2279)
  at `99c265981ba98f1afd0e5fc822624a9a91822ad2`, alongside D499's supported
  generated authority, routes, assets and storage identity-port handoff. Replay
  measurements retain their original source. The
  [Linux investigation](backlog/browser-reconnect.md) keeps the bounded observation
  groups, six original fault controls and earlier cancellation traces. A native
  Chromium/TLS reproduction identifies an unloading page's error refresh as one
  source of late reads; historical Linux socket-reset attribution remains open.
  No cancelled bytes, failed samples, accounting checks or deadlines are excused.
  The reporter preserves the original refusal when a diagnostic property cannot
  be inspected, including throwing or revoked JavaScript proxies, objects that
  intercept property inspection. Each field is contained separately, so an
  unreadable step does not discard a valid phase. The same fixed labels and
  original checks apply. A synchronous failure while printing either label also
  preserves the exact original refusal; the reporter stops printing after that
  failure. The same focused command above checks both output failures and normal
  output. This does not identify the historical reconnect failure's cause.
  The launch, reconnect and logout failure tests also
  inspect the real traffic-meter listener and require it to be closed when the
  journey refuses. Removing the meter cleanup fails six named assertions;
  independent test teardown collects the listener and timer without waiting for
  the meter's ten-minute lifetime. Browser operations remain controlled fixtures,
  and this check does not establish the historical reconnect failure's cause.
  Ownership validation remains strict. Generated gateway fixtures explicitly
  retain the file-access capability needed for their host-owned private mounts;
  production gateways and private-data replay permissions are unchanged.

  Cancellation first drains admitted storage traffic before signalling the native
  writer, with a bounded fallback. Invalid transfer accounting still refuses
  measurement publication. Separately proved collection of native processes and
  their owned scratch lets the replay remove its own verified database copy;
  replaced roots and lost ownership continue to refuse cleanup. The generated
  native cancellation/deadline journey passes three consecutive runs, alongside
  37 stream and 33 private-replay checks. Setup interruption collects its recorded
  child process group and generated directory for both supported signals.
  The generated fast-exit cancellation checks now separate two contracts. The
  successful-close case admits only its startup upload and its held upload, so
  it retains the original successful-close and exact child-collection assertions
  without queuing later work. A second case keeps queuing, admits a later upload
  after the real idle handoff signals the writer, then exits after receiving one
  of four declared reply bytes. Close must refuse that interrupted accounting;
  cancellation separately prevents publication while independent resource
  collection reports completion. The check requires a successful native exit
  without a forced-kill signal and inspects the actual listeners, backend sockets,
  owned child identities and scratch, and never launches restore.
  Run both with `node --test --test-timeout=10000 --test-name-pattern='^cancellation'
  scripts/cloud-cost/replay-stream.test.mjs`.
  Native reproduction previously found one failure in 432 unchanged trials and
  one in 800 instrumented trials: a later PUT lost its response during session
  collection. The controlled split qualifies that local mechanism and preserves
  admitted-upload drainage, accounting, child ownership and every deadline.
  Runtime code is unchanged. The original untraced Linux event and official
  Litestream shutdown still need attribution and qualification.

  The replay writer-deadline check also refused during opening in
  [main run 40259519210, receipts job 121368783695](https://github.com/waitron-io/waitron-cloud/actions/runs/40259519210/job/121368783695),
  before its intended finish assertion. Slow fixture storage setup reproduces
  that boundary: opening correctly consumes the whole-run 0.7-second budget.
  Opening failures now report elapsed milliseconds and the existing bounded
  stage/native trace, after collection, without private paths or child output.
  The real-clock check requires its deadline callback to fire before accepting
  refusal during opening or before a complete result, then verifies source
  preservation, listener closure and final child collection. A separate check
  waits for a real writer before firing the unchanged 0.7-second callback and
  proves collection by that deadline before finish or close can hide a missed
  abort. Only that callback is controlled; HTTP, SQLite,
  native children and other timers remain real. The existing 4.01-second opening
  and idle controls, drainage assertions and all runtime timers remain unchanged.
  Run `node --test scripts/cloud-cost/replay-stream.test.mjs` for these controls
  and the bounded opening diagnostics. The historical Linux startup stage and
  underlying delay remain unknown; this repairs the reproduced test assumption.

  **Remaining work and observations.** To complete the operating total, establish
  the missing inventory quantities and regional billing terms, representative
  venue/public activity, complete retained-object forecasts, recovery/alert/email
  frequencies and provider capacity/transfer mappings. Keep external mail, fiscal
  API fees, GitHub charges, account allowances, credits and tax separate from
  gross AWS usage. Earlier untraced refusals and transient source-file fingerprint
  changes remain unattributed; later accepted samples do not explain those exact
  occurrences. A generated restore-integrity failure reproduces on the host-shared
  Docker folder and passes with active SQLite/native stream state on container-native
  storage. Its production relevance is unproved. Prepare a consistent frozen copy
  before long replay; later live-source activity does not identify a writer and
  must not be treated as proof that the isolated experiment wrote the source.

- **Future remote DNS lost-reply browser failures.** The reproduced reconciliation
  stall is resolved by [PR #102](https://github.com/waitron-io/waitron-cloud/pull/102).
  If the saved-name assertion fails again, use the bounded request/status events,
  injection stages and setup-screen diagnostics to identify and reproduce the cause.
  Keep the four-second assertion and fault-injection ordering checks unchanged;
  passing repeats alone do not explain a failure. See [the ordering receipt](#portal-lost-reply-test-ordering).

- **CI job record publication.** The historical GitHub publication delay remains
  unexplained. D573 lets a slow job lookup finish with a larger retry budget inside
  the original one-minute allowance. A controlled eleven-second response now
  succeeds; persistent lookup timeouts and failed or missing jobs still fail.
  Timeout diagnostics report attempt duration and remaining time. Deadline
  diagnostics identify unmet identity and completed-step checks
  from the last observed record. Preserve run identity, final dependency results and time
  limits; landing still requires every actual job record final. See the
  [investigation and qualification limits](backlog/ci-job-record-publication.md).

- **CI execution budget.** You can read one summary job and the individual package
  and receipt jobs to check a candidate. The summary also checks the plan's
  package allocation against the planner's registered package names and shard
  counts. Registration uses six partitions, account HTTP uses three, portal uses six
  and backups uses seven. The [backup job budget investigation](backlog/backup-ci-budget.md)
  records a job cancelled during cleanup after all 569 cases passed. Seven
  partitions separate its five expensive guard files while preserving every assertion
  and the eight-minute limit. The summary requires every registration partition
  and rejects five- and seven-partition allocations. The
  [registration runtime investigation (D576)](backlog/package-ci-runtime.md) records
  the Linux measurements and the historical failures that remain unexplained. A Node subprocess
  check partitions copies of every current registration filename plus a new
  filename and requires each to execute exactly once. Its file workers run one
  at a time; overlapping fixture bodies fail on a shared scratch-directory lock.
  This checks file discovery; real package jobs must still report every test case.
  The reminder-worker cases live in `email-reminders.test.ts`, with their complete
  test bodies unchanged. The name places them before the worker-loop tests in
  Node's file allocation. Each file prepares its own disposable schema; every
  case and the 30-second deadline remain. Earlier five- and six-job layouts took
  313 and 348 seconds respectively and were not adopted. A later six-job split
  reached 259 seconds but used the same 23 rounded registration minutes as seven
  jobs, and its backup job failed the strict native-memory OOM check. The start
  ordering fix below addresses a reproduced mechanism for that failure.
  Whole-file measurements guide the six-job allocation and three explicit
  filename moves. The balanced Linux trial passes all 1,684 cases and runs every
  one of the 139 files exactly once. Its slowest wrapper falls from 293.499 to
  234.678 seconds, with every group within four minutes. These sequential Linux
  runs do not establish concurrent hosted-job timing or explain the historical
  cancellation.
  Aim for about four minutes per registration job and require every exact-head
  registration job within 300 seconds. Use observed wall times and complete case
  counts rather than the retired rounded-minute budgets. Current-head CI and
  post-merge verification remain required.

  The relay-capacity test keeps its four SMTP deliveries open until all four
  competing worker attempts return without work. Its unchanged sending, queued
  and total-delivery assertions then describe one concurrent batch. A delayed-start
  control reproduces extra later deliveries when that synchronization is removed;
  the production worker limit and original deadline are unchanged. The original
  CI log did not record the worker schedule, so the exact host delay remains
  unmeasured.

  A shard is one partition of a package's tests. Removing a partition
  from both the plan and the job list cannot turn incomplete work green.
  Unknown packages, altered counts, invalid partition numbers and extra row
  fields fail; complete partitions and the existing short-package groups remain
  accepted. Each package in a short-package group must also emit a nonempty,
  consistent Node test summary and exit successfully. The runner reports its
  test, pass, skip and todo counts, keeps all output and continues with later
  packages after a failure. A zero exit without a summary, an all-skipped run,
  or a failed or cancelled test cannot pass. Plain and colored TAP and spec output are
  exercised with real Node test subprocesses; the package commands, deadlines
  and treatment of individual skipped or todo cases are unchanged. These counts
  establish executed work, not that the selected package contains every required
  test. An independent summary policy checks the execution contract; tests
  feed it every real planner package allocation and the full grouped plan, and
  compare its package names with the complete workspace inventory. Adding,
  removing or renaming a package, or changing its partition count, requires
  updating that policy. This validates allocation for selected packages;
  independently proving that every affected package was
  selected and resolving wider input selection remain open. No grouping or
  cost reduction is claimed by this guard. The reviewed
  [precise-selection design](superpowers/specs/2026-10-14-precise-ci-selection.md)
  and [implementation plan](superpowers/plans/2026-10-14-precise-ci-selection.md)
  remain the guide for the parked `feat/precise-ci-selection` branch. Rebase that
  branch over the six-partition portal allocation before resuming it. They
  define how documentation, scripts, configuration, resolved lockfile changes and
  receipt inputs can select their actual checks. Regular prose uses its formatting job when it is regular in both saved trees;
  package Markdown, consumed documents, receipt data and unknown inputs keep
  their owning work. Review actual readers with the [CI guide](ci-documentation-audit.md).
  The parked `feat/precise-ci-selection` branch remains untouched. D69 ended in
  #262 with full work for unresolved directory readers; its unmerged replacement
  is reference material, not the current implementation. D571 part 2 declares
  40 exact reader versions for installed dependencies, runtime data, scratch and
  inert directory values. Both immutable trees check their mode, type and blob;
  changed or unknown readers retain conservative work. Quoted file references,
  sibling imports and helper chains remain in the graph. The fallback fixtures
  supply explicit unknown readers and preserve every original assertion.
  Local saved-graph controls on the current direct-consumer implementation select
  six portal package jobs and one UI-smoke job. Account HTTP, registration and
  remote access still select 28 groups; backups and translation select 24,
  identity 23 and operations seven. These are synthetic source-path selections
  against the real graph, not hosted execution or GitHub duration savings.
  All six independent receipts remain selected whenever these declarations
  qualify narrower package work. A refused graph retains full package work and
  its independent receipt audits. The [reader boundaries and renewal procedure](ci-package-readers.md)
  explain the declarations and remaining limits.
  Part 2b supplies the
  direct package selection below; part 5 still owns verified merge reuse.
  The executable output fixture gives its synthetic PR an explicit event and
  call inputs, including when its parent is a full nightly invocation. Its
  original root, compiler, package, receipt and forced-full assertions remain.
  The first manual full-nightly at `b883ee69` also exposes nine older synthetic
  CLI assertions across seven files. They reproduce at pre-integration `7105610a`
  when the parent event is `workflow_dispatch`. D587's landed #988 isolates those
  fixtures, and #986 isolates the root output fixture, preserving the original
  selections and full-nightly checks. Hosted controls
  [#985](https://github.com/waitron-io/waitron-cloud/pull/985) and
  [#989](https://github.com/waitron-io/waitron-cloud/pull/989) qualify root-only
  and health-receipt-only selection respectively; both are closed without merge.
  All four root jobs at #985's revision run while compiler, package and receipt
  work is skipped. #989 runs the entire local-stack receipt, including both health
  checks once, with 1,532 reported passes and 26 optional skips; compiler, package
  and root work is skipped. Complete source contracts and strict summaries qualify
  each workflow independently. The manual full-nightly acceptance below completes
  part 3's full-run check. These receipts do not establish a time saving.
  Ownership review does not complete global root precision or establish a time
  saving. Unresolved package readers, including the separate #938 fix, remain
  outside this slice.
  Part 4 selects the separate cost and venue matrices from their
  [reviewed proof inputs](ci-proof-selection.md). Cost retains backend sources,
  migrations, shared fixtures, gateway and installation inputs; venue selects
  its proof programs and named suite tests. Portal code and ordinary unrelated
  package tests omit both matrices. Unknown packages, root areas and
  unclassified scripts retain work, including changes in the other proof's
  script tree. Part 3 narrows only its two admitted root tests. Both workflows
  support complete manual runs and stop running on main pushes, while the nightly
  backstop below retains both full matrices. Real-Git controls cover positive
  inputs, omissions, renames, missing history and checkout refusals. No rehearsal
  assertion, command or deadline changes. The combined controls preserve the
  nightly full flag and existing proof input rules. No measured GitHub time saving is claimed. D571 part 5 has a
  [verified-merge design](superpowers/specs/2026-11-05-verified-merge-ci-design.md)
  and [implementation plan](superpowers/plans/2026-11-05-verified-merge-ci.md).
  The workflows now publish attempt-bound source plans and main decisions,
  independently qualify identical-tree sources, and recheck them in the final
  summary before accepting skipped work. Main readback verifies the hosted
  artifact, every final job and the reconstructed push range or full inventory.
  AWS and applicable download diagnostics have their own planners and summaries.
  Cost and venue retain part 4's removed main triggers and their input selection;
  they cannot borrow standard CI's evidence. Historical proof reconstruction
  reads its explicit immutable range, independently of the operator checkout.
  Reusable calls, including a false-valued full input, always run complete work.
  The [merge evidence checklist](ci-merge-evidence.md) distinguishes inherited
  counts, newly executed checks and workflows excluded by their actual triggers.
  Local checks cover workflow conditions, artifact publication, complete native
  jobs and deliberate guard omissions. Hosted equal-tree readback qualifies
  general and AWS reuse on #965 and #992's exact merges, with zero new product
  checks in those families; #992's separate Kubernetes run executes 37 checks.
  Different-tree #986 runs the full standard selection and its independently
  selected AWS work, with literal-range readback. The full nightly below includes
  AWS. Aggregate time savings remain unproved.
  The whole-branch review found ordinary-run failures around missing API evidence,
  empty ranges, oversized plans and summary checkouts. Focused controls cover their
  full-work fallbacks, bounded historical reconstruction and final summary proof.
  Missing immutable PR objects are fetched by exact hash without moving refs.
  CLI fixtures set their own run identity so hosted inputs cannot change the
  refusal they exercise. The live-reader control uses distinct saved revisions
  to reach package discovery without bypassing the empty-range guard.
  The bounded native, source and readback readers now collect 30-record job
  pages. A controlled slow large-page response reproduces native summary
  exhaustion; smaller pages pass that control. Missing, duplicated, truncated
  or changing evidence still fails in those bounded readers. The 500-record
  ceiling and request/time limits remain; shared readback requests can exhaust
  their budget earlier. Numeric aliases require an independently verified
  repository name and ID. The ordinary strict summary requests 30 records
  through its existing reader, preserving its expected-name/result checks and
  retry bounds. D586 closes that reader's separately reproduced completeness
  gap: declared totals must be stable and equal every delivered record, and
  all job IDs must be unique positive integers before workflow-family filtering.
  Controlled incomplete, changing, duplicated and missing-page responses refuse
  immediately. Complete single-page and multi-page lists still pass, while
  missing required jobs and failed results retain their original refusals.
  A controlled nightly response also proves that a sibling job appearing
  between pages can change the declared total and cause this refusal. Whether
  GitHub produces that race in practice remains unverified. If it occurs,
  investigate that saved response under this CI investigation before changing
  the existing retry policy; D586 does not retry contradictory evidence.
  The hosted timeout's natural cause is not proved. The watcher
  has updated all six operator runbooks; runtime landing still requires fresh
  current-head CI.
  Part 6 adds the [nightly full backstop](ci-nightly.md):
  one 03:17 UTC schedule and a manual trigger call all four workflows
  at the same revision. All package partitions, six receipt suites, cost,
  venue and four AWS cells execute even on an unchanged tree. The parent refuses a missing, skipped,
  cancelled or failed family; the standard summary retains its exact job checks
  within the nested family, refusing malformed job names before filtering.
  Configuration guards protect the full inputs, concurrency and final
  dependencies; an executed CLI control checks the configured prefix. These
  guards do not replace hosted execution.
  [Manual main run 42165813178](https://github.com/waitron-io/waitron-cloud/actions/runs/42165813178)
  attempt 2 qualifies exact `9237200a`: all 77 jobs final, 21,072 reported Node
  passes, 26 optional skips and 384 separately counted mocked OpenTofu cases.
  All 29 package allocations, eight root partitions, compiler checks, six receipt
  suites, 21 cost cells, both venue cases and four AWS cells execute without reuse;
  every family and parent summary qualifies. The failed-only retry executes 14 cost
  checks and two summaries, retaining 21,058 passes with identical logs and execution
  times. The first attempt's recurring native LIST shutdown refusal remains on
  D530; the passing retry is no repair. The [nightly guide](ci-nightly.md#verified-manual-run)
  records the exact revision and limits. Comparable healthy
  aggregate usage measurements remain open. The original 4 November baseline
  overlaps published GitHub incidents and cannot support a savings claim.
  D571 part 2b adds
  [one-level package selection](ci-package-selection.md): a source change selects
  its package and direct consumers; changes only under its `test/` directory
  retain file readers rather than every manifest consumer. Both immutable
  revisions contribute readers, including removed imports and exports. Lockfile
  selection retains its original full dependency walk. The 50-merge replay
  through `be28f5d6` remains 980 package jobs before and after because other
  audit and reader refusals still select full work. A separate projection that
  excludes prose and audit metadata changes 410 to 338 package jobs; this is
  potential selection reduction, not measured CI savings. Registration source
  selects 28 of the full plan's 29 jobs after the sixth registration partition;
  the historical sample retains its original 27-job count. Further narrowing
  needs file-level consumer evidence.
  Without the part-2 declarations, even a portal-only change refuses the saved
  directory reader in `scripts/ci-audit-fixture-dependencies.mjs` and keeps full
  package work. The local part-2 control narrows that graph to six portal jobs;
  it does not establish a hosted time saving.
  Root script families use regular saved targets and their owning behavioral
  checks, without record renewal. Lock changes compare both saved manifests and
  dependency graphs. Unknown inputs retain full work; see the
  [selection guides](ci-documentation-audit.md).
  Historical receipt fixtures retain their independently pinned nine-manifest
  certificate and exact metadata assertions. Production validation independently
  discovers all ten current manifests, including translation and licence metadata.
  Saved dependency, execution, schema and deployment inputs are unchanged.
  Other root scripts and shared configuration still retain full work. Wider
  selection and job-duration qualification remain open.
  The immutable package graph
  also follows quoted references through shared JavaScript and TypeScript helpers
  outside package directories, including helper chains and cycles. It retains
  readers from both saved revisions, resolves directory index helpers and maps
  emitted JavaScript and JSX helper paths to TypeScript sources. Matching quote
  delimiters retain paths after apostrophes while the broader scan preserves
  paths embedded in generated fixture programs. Only reached helpers add package
  links. Every tracked JavaScript or TypeScript source is read as evidence, so an
  unreadable, linked or oversized source keeps all package tests even when it is
  not reached. Reading only reached sources remains an efficiency follow-up.
  This is not a complete resolver for computed inputs or root-file selection. A lockfile PR now reports
  which workspace dependency sets changed by comparing both saved revisions.
  The bounded version 9 parser follows indirect, optional and workspace-linked
  dependencies, retaining separate peer variants and their package metadata.
  Duplicate keys, missing or unused records, unsupported syntax and incomplete
  evidence cannot produce a partial comparison. YAML separation uses ordinary
  spaces; other Unicode spaces remain part of scalar values. The direct parser
  accepts at most two MiB, while individual source blobs retain their one-MiB cap; tree and batch
  transports use the bounded 64-MiB reader.
  Shared records are hashed once. The graph has a 500,000-visit limit and the
  complete comparison hashes at most 32 MiB of serialized input per lockfile.
  A lockfile PR, alone or with workspace manifest dependency edits, can select the
  affected packages and their saved source/helper
  consumers when both revisions match the complete lock-mode audit described in
  [the current guide](ci-lockfile-audit.md). Its projection pins each manifest with its four dependency fields removed and every
  other tracked file, including installation policy, root readers and documentation. Any
  change to those inputs invalidates it until you review them again; follow the
  [lockfile audit procedure](ci-lockfile-audit.md). The selected packages
  include consumers from both saved revisions; all compiler and receipt checks
  still run. Root dependency changes, changed workspace membership, formatting-only
  locks, unrelated mixed paths, missing evidence and stale audits retain full work.
  Every changed manifest selects its package and its old/new consumers even if
  that edit does not change a resolved importer. Manifest scripts, package identity
  and every nondependency field stay audited. Version 1 remains supported for
  lock-only updates. This route still requires explicit reader review before
  renewing complete-input certificates. Receipt-selector test fixtures seed eleven
  saved audited dependency inputs, so an unrelated manifest or lock edit does not
  invalidate their positive test setup. Their original omission and refusal
  assertions remain; a separate real-clone regression changes every workspace
  manifest and the lockfile before running the four positive checks sequentially.
  It requires all four test names, so a passing file with no matching test cannot
  substitute for coverage. The saved manifest metadata must match its reviewed
  nondependency fields in the audit. The fixtures also seed the saved audited
  package runner and package-path resolver from
  `scripts/fixtures/ci-execution-inputs.json`. Separate real-clone checks change
  each live input and require all five original positive receipt tests to execute.
  Their assertions and the production audit pins stay unchanged; changing either
  real input still retains receipt work. Actual
  dependency changes still retain every receipt in the production planner.
  Fourteen root-test fixtures now disable automatic Git maintenance for their
  temporary repositories. Real-child checks trace each named original test,
  require that exact test and its commit to execute, and reject automatic
  maintenance or garbage-collection children. The original receipt, selection
  and reuse assertions remain unchanged. The checking process owns a separate
  process group and stops that group's remaining descendants when the check ends;
  a deliberately stalled test proves its worker is stopped after a timeout.
  In [run 38824736788](https://github.com/waitron-io/waitron-cloud/actions/runs/38824736788),
  262 of 263 root checks passed before database-input fixture cleanup failed
  with `ENOTEMPTY`. Local tracing confirms detached maintenance launches in the
  original fixtures, but does not establish that they wrote into the directory.
  Sixteen concurrent original-file review runs did not reproduce the failure.
  The change removes a confirmed detached background Git process from these
  fixtures; it does not establish the historical cleanup cause. Capture that
  directory's remaining entries and process activity if cleanup fails again.
  Four receipt-selector fixtures now use the planner's existing batch reader
  against their own temporary repositories. The local-stack and nested dependency
  checks previously launched 1,021 and 1,094 individual source-read processes.
  Tracing now requires zero individual source reads and exactly two batches per
  checked plan, while every original omission, refusal and maintenance assertion
  remains. Positive checks also reject a package-evidence fallback, so a broken
  batch cannot silently substitute a full package plan.
  Three concurrent complete root-suite runs reproduced both outer checks' former
  30-second timeouts. With batching, the local-stack check completes in 27.0 seconds
  under the same load. The nested dependency check completes in 58.2 seconds;
  its outer deadline is now 90 seconds because its four sequential workers already
  have a 60-second budget, plus repository setup and cleanup. Other outer checks
  retain 30 seconds, and the deliberately stalled worker still has five seconds.
  These are local stress measurements, not a guarantee under arbitrary host load.
  The same three-root overload still triggers the unchanged 35-second bootstrap
  observer in all three runs and the inner 60-second dependency-worker limit in
  one run. These are separate stress follow-ups, not resolved by the outer budget
  correction; retain their diagnostics and avoid overlapping full qualification.
  A later default-concurrency root run passed 322 of 324 checks and hit both
  limits again: the bootstrap observer after 35.18 seconds and the dependency
  worker after 65.34 seconds including its outer setup. Review controls and
  package qualification overlapped that run. The precise cause remains unproved;
  retain both limits and their original assertions when investigating recurrence.
  A later review of the five-shard change also missed the 60-second dependency
  worker twice with the new discovery check, while its base and skipped-check
  comparisons did not. That small sample does not establish causality. The new
  discovery fixture now permits one file worker at a time; overlapping bodies fail
  on an exclusive scratch-directory lock. Keep the 35-second and 60-second limits
  and capture stages on recurrence; bounded fixture workers do not prove that the
  historical root timeouts are resolved.
  The original historical failures did not retain these exact stages; the controlled
  reproduction establishes the timeout mechanisms rather than their precise history.
  Evidence, earlier partial fixes and complete load-run outcomes are retained under
  `~/waitron-campaign-d/receipts/d69/fixture-child-timeouts/`.
  The remote operator and reconciler test children now use one colorless
  environment, removing inherited `FORCE_COLOR` and preserving `NO_COLOR`,
  configuration and other runtime warnings. This also covers continuous
  reconciler mode. Conflicting parent settings previously added a Node warning
  to their exact error output. Run `node --test
  packages/remote-access/test/cli-color.test.ts` for real CLI refusals without a
  database, including forced color values 0, 1 and 3. Every original CLI assertion,
  command and deadline stays unchanged; production color handling is unchanged.
  Local PostgreSQL suites are unavailable while Docker is down until 3 November;
  GitHub CI qualifies the original database-backed journeys.
  The parser's current-lock inventory check retains independently reviewed literal
  package, snapshot and importer counts. A new dependency record needs an
  explicitly reviewed inventory update. The disposable
  [dependency-only control #164](https://github.com/waitron-io/waitron-cloud/pull/164)
  replaces the portal's resolved axe-core version with unchanged inventory counts
  and passes a frozen install. Its
  [exact-head run 38823958615](https://github.com/waitron-io/waitron-cloud/actions/runs/38823958615)
  runs only three portal groups (196 cases), all compiler checks, 263 root checks
  and all five receipt suites (225 cases). All seven successful jobs check out the
  exact head; documentation and script jobs skip. It uses 19 rounded job-minutes,
  a 320-second job span and a 288-second longest job, compared with 69, 352 and
  322 in the [full baseline](https://github.com/waitron-io/waitron-cloud/actions/runs/38817784178).
  That baseline's complete tree equals the scratch target. Planner, workflow,
  runner, summary and audit evidence are identical between target and control.
  The scratch PR is closed without merging, and its branches and worktree are
  removed. These are timestamp-based estimates, not invoices or a completed
  full-run budget claim. Broader dependency additions, other controls and
  wider lock/root
  selection, package precision and their real scratch controls remain open. Review follow-ups:
  independent deletions of the audit-version, manifest null-byte and manifest
  dot-segment checks fail the existing policy-refusal test. The Markdown inner
  path filter also has an independent removal control: deleting it makes the
  strict-summary refusal test in `scripts/ci-docs.test.mjs` fail with
  "Missing expected exception". All 11 document tests pass before deletion and
  after restoration (`node --test scripts/ci-docs.test.mjs`). The regular-file
  defenses retain their paired removal control. Seven additional checks refuse
  a non-blob object even when its reported file mode is regular, covering the
  policy, both script pairs, the lockfile and the package manifest. Each uses
  controlled malformed inventory at the Git reader boundary and passes its valid
  input control. Deleting only the object-type guard fails all seven named checks;
  normal Git producing inconsistent metadata is not claimed. Keep the refusal
  assertions when simplifying these checks. Keep the renewal recipe's explicit manifest patterns aligned with
  discovered workspace members; a mismatch currently retains full work. The
  lock-specific explanation now lists changed package manifests separately from
  changed resolved dependency inputs, so you can see why a manifest owner runs
  even when its resolved inputs did not change. Saved-revision checks cover
  single and multiple manifests, overlap with a changed resolved importer and
  lock-only changes without edited manifests. Package selection, audits,
  fallback, compiler and receipt checks retain their existing behavior. Judge grouping
  by observed job wall times and complete case counts, keeping each work job near
  five minutes. Rounded-minute budgets no longer gate this work. The historical D66/D67 full-run samples used 72 and
  73 minutes; these are timestamp-based rounding estimates, not invoices.
  CI still selects changed workspace packages and every package that depends on them,
  including test dependencies and direct sibling source/fixture reads absent from
  manifests. Package-only PR selection now reads source and manifest dependency links from both
  immutable Git revisions, preserving removed links and committed readers hidden
  by local edits. The existing quoted-path discovery also retains named, root-relative
  and uncertain sibling-template readers. Missing blobs, incomplete inventories,
  changed workspace membership or test commands, checkout attributes, links and
  tracked dependency overrides keep all package suites with a reason. Initial package
  selection remains a conservative floor; an independent receipt audit may still omit
  a receipt when its own immutable evidence holds. Workspace discovery
  currently recognises only the repository's two explicit package-directory patterns;
  other policies keep full work. The planner reads the required policy, manifests and source
  blobs in one Git batch per saved revision, deduplicating identical objects. It checks
  each object's identity, byte length, separator and content hash before using the source.
  The old one-MiB per-file limit remains; each batch also has a 64-MiB output limit
  and a 30-second deadline. Missing, malformed, oversized, slow or corrupt batch
  evidence keeps all package suites with a reason. Existing callers without a
  batch reader retain individual reads.
  Named shared subdirectories now retain every saved JavaScript or TypeScript
  descendant as a possible helper input. Directory readers can therefore keep
  their package consumers through helper chains and cycles, including files
  added or deleted between the two revisions. Exact directory boundaries avoid
  pulling in similarly named siblings; equivalent dotted and repeated-slash
  directory paths resolve to the same saved inputs. A real Node directory scan reproduces
  the formerly omitted portal consumer; saved-revision and batched-read checks
  cover old and new helper files, dirty local sources and paths with spaces.
  The actual portal-only and all-nine identity selections stay covered.
  Root-relative file paths also normalize dotted segments and repeated slashes
  before looking up package owners or shared helpers. Real Node imports prove
  that equivalent package and helper spellings load the same input; selection
  checks retain their direct and transitive consumers from both saved trees,
  even when local helper files have changed. The live workspace graph applies
  the same normalization to direct package paths. When `..` leaves an earlier
  package prefix, selection follows the actual destination and drops that false
  dependency. If an unresolved root-relative package template has no constant
  package owner after normalization, every package remains a possible input.
  Real imports and selection checks cover both directions across package
  boundaries and this uncertain template case. Both graphs use slash-based
  normalization. Every earlier assertion and reader-audit certificate is unchanged.
  This is a conservative source dependency rule, not evidence that every quoted
  directory is read at runtime. A bare quoted folder name such as `scripts` can
  select extra consumers even when it names a data field. Qualify actual reader
  operations before narrowing that rule. Direct `readdirSync(new URL(relativePath,
  import.meta.url))` calls without options now retain immediate root-level source
  helpers when the URL names the repository root. A real Node scan proves the
  loaded helper keeps its package consumer; saved-tree checks retain added and
  removed helpers, transitive consumers and dirty-checkout independence. A root
  command working directory alone adds no helper inputs, and a nonrecursive root
  scan does not traverse nested directories. The same rule now follows a simple
  `const`, `let` or `var` assignment of that URL to a raw JavaScript identifier passed
  directly to `readdirSync` without options, including a `: URL` type annotation
  or a later comma-separated binding in the declaration. Raw names now include
  accented and astral letters and the two join-control characters JavaScript allows
  within identifiers. Executed Node scans cover all four directory APIs. Saved
  readers retain immediate helpers and transitive consumers when reader and helper
  coexist in either saved revision, including added or removed helpers despite
  dirty local files. Root options still
  retain every package, including for audited lock changes. Unused bindings,
  different identifiers and non-root scans keep narrow selection in the controls.
  URL-variable names also retain those consumers when declarations or uses contain
  fixed-width or braced Unicode escapes. Different spellings of the same name are
  compared after decoding the escapes. Executed scans cover all four directory
  APIs, and saved-tree checks cover removed or added helpers, former transitive
  consumers and dirty local files. Recursive root options retain full package work,
  including audited lock changes. Unused bindings, different names, local scans and
  a command working directory alone stay narrow in the controls. The `URL`
  constructor and optional type label now also accept fixed-width and braced
  Unicode escapes, including mixed spellings and leading zeroes. Executed scans
  cover all four directory APIs; saved-tree checks retain old and new helpers,
  transitive consumers and dirty-checkout independence. Recursive root options
  keep every package, including for audited lock changes. Unused bindings,
  local reads, different variable names, unrelated constructors and a command
  working directory alone remain narrow in the controls. Simple declaration
  aliases of these URL bindings now retain immediate helper consumers too.
  The scanner follows alias chains in either declaration order, decodes escaped
  names and bounds cycles with a visited set. Executed controls cover all four
  directory APIs, comma-separated declarations and the supported URL type label.
  A trailing line or block comment can carry the line break that ends the
  declaration without a semicolon; those aliases retain consumers too. Both sides
  of an alias decode identifier escapes in the controls. Comments followed by an
  expression continuation can conservatively select extra work.
  Saved-tree controls retain old and new helpers, additions, deletions and
  transitive consumers despite dirty local files. Root alias reads with options
  retain full package work, including audited lock changes. Unused aliases,
  different scanned names, local reads and working-directory values stay narrow
  in the controls. Names are combined conservatively across scopes; this does
  not resolve binding identity, destructuring or other type labels. Bare later
  assignments now preserve these URL aliases too, including separate and chained
  transfers, escaped names, comments and parentheses around a bare assignment
  such as `(directory = original)`. Executed
  controls cover all four directory APIs, old and new saved helper readers,
  transitive consumers and dirty-checkout independence. Recursive root options
  retain full package work, including audited lock changes. Unused transfers,
  different scanned names, local reads, expression prefixes and working-directory
  values remain narrow in the controls. Assignment order and reused names are
  combined conservatively, so overwritten values can select extra work. Direct
  constructor assignments such as `let directory; directory = new URL(...)`
  now retain immediate helper consumers, including assignment chains, escaped
  names and constructors, comments and parentheses around an assignment such as
  `(directory = new URL(...))`. Executed checks
  cover all four directory APIs, saved old and new transitive consumers, dirty
  local files and audited lock changes. Root options keep every package; unused
  inputs, local reads and identifier suffixes stay narrow in the controls.
  D69 closes under the owner's 2026-10-20 decision: run all when unsure.
  The historical design and measurements below do not require another syntax
  extension or a cost target before closure. More precise selection remains
  optional efficiency work; preserve the conservative fallback.
  Every direct directory read must resolve through an admitted URL constructor
  or its supported bindings and aliases. An unresolved argument, unknown value
  transfer, unrecognised reassignment or other use of a URL binding prevents
  package narrowing. A matching outer declaration cannot qualify a different
  parameter, and a URL object may change through another reference. Assignments
  inside parentheses, opaque literal programs and unknown alias sources also
  prevent proof. Executed controls cover all six same-name review probes and
  their audited-lock paths. This refuses uncertainty without resolving more forms. The planner
  then keeps every package suite and names the saved source path. Audited lock
  changes also keep full work through their existing fallback. Both saved trees
  are checked, so a removed reader and dirty local files cannot hide a consumer.
  Ordinary resolved reads keep narrow selection in the executed controls.
  In the current repository, `packages/account-http/test/fixtures/fiscal-waitron-bridge.mjs`
  computes a journal directory that this scan cannot prove. Package-only changes
  therefore retain all packages, including portal changes. Do not add another
  special case to recover that saving; the owner accepts the wider fallback.
  This deliberately trades additional work for retaining tests. Do not extend
  the syntax recogniser one written form at a time; an uncertain form takes the
  fallback. Precise binding resolution and generated-input analysis are optional
  future efficiency work, outside the closed D69 task. This source scan can also
  select extra work for inert text and reused names.
  Storing a root command working directory alone adds
  no helper inputs. An existence check alone also adds no root helpers, and a
  shared helper scanning its own directory does not scan the repository root.
  This bounded scan can keep extra consumers when identifiers are reused; it does
  not resolve directory aliases precisely, other type annotations, computed
  assignments or other directory APIs. A reachable source mentioning `glob` or
  `globSync` now keeps every package. Package-only planning names that source
  in its fallback reason; lockfile planning can report a generic full fallback.
  Glob patterns, options and the default working directory remain unresolved,
  so these calls cannot justify dropping consumers. Executed Node scans cover
  direct/stored root directories, default working directories, absolute patterns,
  optional calls, `.call` and import aliases. Saved shared-helper readers in either revision keep this fallback
  despite dirty local files. The bounded source scan can retain extra packages
  for inert text or unrelated functions with these names; indirect scans without
  a named glob reference and precise input resolution remain open. Block and line
  comments now separate tokens in the supported directory calls and URL bindings
  just as whitespace does. Executed Node scans and saved-tree checks retain the
  loaded helper, its package consumer and transitive consumers from either
  revision despite dirty local helpers. Nonrecursive scans still exclude nested
  helpers, and comments cannot hide the full fallback for explicit root options.
  Line comments end at each JavaScript line terminator. Whitespace and comments
  between the tokens of `import.meta.url` now retain immediate root-helper
  consumers for all four directory APIs, directly or through a supported URL
  declaration. Executed Node scans cover block comments and every line-comment
  terminator; saved base/head and unchanged readers retain transitive consumers
  despite dirty local files. Audited lock changes retain those consumers too.
  Recursive root options keep full package work; non-root options and root
  command directories stay narrow in the controls. This remains a bounded source
  scan; unresolved URL inputs keep full work. The immediate-entry rule also covers `readdir` from
  `node:fs/promises`, `opendir` and `opendirSync`, directly or through a supported
  URL declaration. Executed scans retain the loaded helper consumer without
  traversing nested directories; saved shared-helper readers from either revision
  retain former transitive consumers despite dirty local files. A reachable
  `readdirSync`, `readdir`, `opendir` or `opendirSync` of a literal repository-root URL,
  directly or through a supported URL declaration, now selects full package work
  whenever explicit options are supplied. The same fallback covers ancestor scans
  and URL text containing query, fragment or percent-encoded syntax that this path
  resolver does not interpret. When this prevents narrow selection, the planner
  names the source path:
  unresolved options may enable recursion and cannot justify dropping a nested
  helper's package consumer. Real recursive, directory-entry, encoding and computed
  option calls, saved readers from either revision and shared-helper directory
  depth are covered. Query, fragment, encoded-dot and ancestor runtime checks keep
  enumeration inside an owned directory. Calls without options retain their immediate-entry rule;
  options on a helper's own non-root directory do not imply a root scan. Resolving
  options precisely remains open. A reachable `readdirSync`, `readdir`,
  `opendirSync` or `opendir` renamed with `as` now keeps all package suites and
  names the source path in the planner's reason. The renamed call can load a
  helper without spelling a directory API at its call site. Executed Node scans
  prove that consumer, while saved-tree and batched-read controls cover readers
  from either revision despite dirty local helpers. Unreachable alias helpers
  retain narrow package selection. Block and line comments before `as` also keep
  the fallback. Quoted import names and escaped alias tokens also keep all package
  work; real Node checks cover both quote forms, Unicode and hexadecimal escapes
  and a quoted line continuation. The scan does not decode or execute source text.
  Escaped tokens are consumed before checking their adjacent `as` suffix, avoiding
  repeated scanning of ordinary backslash-heavy strings. The saved-source regression
  reproduces the earlier five-second timeout; a local fixed run completes in 0.48
  seconds with 100,000 backslashes. Unrelated later `as` text does not turn a token
  into an alias.
  It can select extra work for inert text, unrelated names or an escaped alias
  for a different import. Reachable directory API names followed by optional
  access, member access or computed member access now retain all package suites
  and name the saved source when the package-revision branch falls back.
  The lockfile path also retains full work, with its existing generic reader reason.
  Real Node calls cover optional
  invocation, `call`, `apply`, `bind`, computed `call` and comment-separated access
  for all four directory APIs, including TypeScript non-null assertions.
  An unchanged-reader lock control retains every package; its reader-free control
  still narrows selection. Saved-helper controls retain both revisions and
  transitive consumers despite dirty local files. An unchanged saved helper also
  triggers the package planner guard; unused helpers keep narrow work.
  This conservative rule can also select extra work for inert text or unrelated
  members. Direct TypeScript non-null calls such as `readdirSync!(directory)`
  now also retain every package suite: an assertion does not change the function
  Node invokes, but previously prevented the direct-call resolver from seeing its
  directory. Executed Node checks cover all four APIs, repeated assertions and
  block comments before and after assertions. Saved-reader checks cover either
  revision and unchanged shared helpers, transitive consumers and dirty local
  files; the lockfile control retains full work while its reader-free control
  still narrows selection. Unreachable helpers keep narrow package work.
  Precise alias resolution, assignment/destructuring aliases, escaped
  bare API identifiers and other unsupported calls remain open. Directory reader names
  wrapped directly in parentheses now retain every package suite because wrapping
  the function leaves its runtime readers unchanged. Executed Node controls cover all four APIs,
  nested parentheses, TypeScript assertions, optional invocation and comments.
  TypeScript `satisfies` and generic-type references, including unparenthesized
  generic calls, also retain full package work because Node erases their types.
  Saved-helper controls cover either revision, unchanged readers, transitive
  consumers and dirty local files; lockfile controls keep full work for the reader
  and narrow work without it. Unreachable helpers still keep narrow selection.
  The closing-parenthesis fallback is conservative: inert text and passing a
  reader as an argument can also select extra work. Directory readers stored as
  the first, final or simple middle array element now retain every package suite; indexing the
  array preserves the function that Node invokes. Real Node checks cover all four
  APIs, nested arrays, comments, trailing commas, TypeScript assertions and `at`.
  Saved-helper controls cover either revision and unchanged transitive consumers
  despite dirty local files. Audited lockfile controls retain full package work
  with these readers and narrow work without them; unused helpers stay narrow.
  These guards can also select extra work for inert text or unrelated names.
  Simple middle elements retain full work with all four APIs, comments, TypeScript
  assertions and indexed or `at` calls. Saved-helper controls cover either
  revision and unchanged transitive consumers; audited lock changes keep full
  work with a middle reader and narrow work without it. Unreachable helpers
  remain narrow. The middle-element guard requires an array opener so ordinary
  named imports preserve existing package isolation. Inert text can still select
  extra work. Logical and conditional operands adjacent to a directory reader
  now retain full package work: either branch can preserve the function for a
  later call. Executed Node scans cover all four APIs on either side of `&&`,
  `||` and `??`, both conditional branches, comments and TypeScript assertions.
  Simple namespace references such as `null || fs.readdirSync` also keep full
  work, including a comment-separated member in a conditional branch.
  Saved-helper controls retain both revisions and unchanged transitive consumers
  despite dirty local files; audited lock changes keep full work with these
  readers and narrow work without them. Unreachable helpers and ordinary named
  imports still keep narrow work. This bounded guard can select extra work for
  inert text, unrelated names and direct calls inside a branch or right operand;
  it does not evaluate branch conditions or resolve these calls precisely.
  Middle readers immediately after a nested array or object now retain full
  package work, including simple namespace references, comments, non-null
  assertions on the reader or namespace and optional namespace access. Executed
  Node controls cover all four directory APIs. Saved-reader
  controls cover either revision and unchanged transitive consumers despite dirty
  local files; audited lock changes retain full work with these readers and narrow
  work without them. Unused helpers and ordinary multi-name imports stay narrow.
  This closing-delimiter guard can also select extra work for inert text,
  unrelated names or function arguments. It does not parse arbitrary expressions:
  other nested predecessors and delimiter-bearing comments or strings remain
  unresolved. A directory reader reached through one namespace name after a
  simple array value, such as `[0, fs.readdirSync, null][1]`, now retains every
  package suite. The member may use `.`, optional `?.` access and non-null `!`
  assertions. Executed Node
  controls cover all four directory APIs, comment-separated members, non-null
  assertions and optional namespace access. Saved-helper checks cover either
  revision and unchanged transitive consumers despite dirty local files; audited
  lock changes retain full work with these readers and narrow work without them.
  Unused helpers and ordinary named imports still keep narrow work. This bounded
  guard can select extra work for inert text and unrelated names. Middle-array
  readers now also retain full package work through chains of plain member names,
  including `[0, fs.promises.readdir, null][1]` and a reader immediately after a
  nested array or object. Executed Node controls cover all four APIs through two
  and three member segments, comment-separated tokens, optional access and
  non-null assertions, plus native `fs.promises.readdir` and `opendir`. Saved
  helpers retain base, head and unchanged transitive consumers despite dirty
  local files. Audited lock changes retain full work with these readers and
  narrow work without them; unreachable helpers stay narrow. These guards do
  not resolve member identities and may select extra work for unrelated names
  or inert text, including multi-segment function arguments after a closing
  array or object delimiter. Middle-array namespace segments now also retain
  package work for Unicode, escaped and private names, such as
  `[0, ñs.readdirSync, null][1]` and `[{}, 0, this.#fs.readdirSync, null][2]`.
  Executed Node controls cover all four APIs, astral letters, join-control
  characters, fixed and braced escapes, optional access, comments and erased
  non-null assertions. Saved helper controls retain base, head and unchanged
  transitive consumers despite dirty local files. Audited lock changes retain
  full package work for simple and nested predecessors; unused helpers and
  ordinary Unicode namespace values stay narrow in the controls. These scans
  still do not resolve bindings or arbitrary expressions; inert text and
  unrelated members with directory API names can select extra work. Logical
  and conditional operands now retain full package work through Unicode,
  escaped and private namespace chains, including `null || ñs.readdirSync` and
  `false ? null : this.#fs.readdirSync`. Executed Node controls cover all four
  directory APIs, astral letters, join-control characters, fixed and braced
  escapes, comments, optional access and erased assertions. Saved readers from
  either revision and unchanged transitive helpers retain consumers despite
  dirty local files. Audited lock changes retain full work with these readers
  and narrow work without them; unused helpers and ordinary Unicode operands
  keep narrow package work in the controls. This conservative scan does not
  evaluate conditions or resolve member identities, so inert text and unrelated
  members with directory API names can select extra work. General expression
  parsing and precise directory resolution are optional efficiency work. Quoted and commented
  predecessors now retain stored readers too, including
  `[';', ñs.readdirSync, null][1]` and `[[], 'a;b', ñs.readdirSync, null][2]`.
  Executed Node controls cover all four directory APIs, single/double/template
  strings, escaped quotes, comments and regular-expression character classes.
  Saved base/head and unchanged transitive helper checks retain consumers despite
  dirty files; audited lock controls retain full package work with these readers
  and narrow work without them. Unused helpers and ordinary values stay narrow.
  The additional scan masks punctuation inside complete literal-like tokens and
  preserves the original text as a separate scan. Repeated-regex and long quoted
  array checks bound the planner child; an isolation control prevents fragments
  crossing between the two copies. The first CI run passed all 1,336 root
  checks but hit the eight-minute job limit. The new reader fixtures now use
  their explicit four-package metadata and batched saved Git reads, avoiding
  repeated pnpm discovery without dropping cases or changing deadlines.
  That fixture optimization did not leave enough margin: the independent full
  merge run [39291389992](https://github.com/waitron-io/waitron-cloud/actions/runs/39291389992)
  passed all 1,336 root checks in 445.258 seconds, then cancelled the compiler
  five seconds after it started at the unchanged eight-minute job limit.
  The preceding green head took a similar amount of time. No assertion failure
  or platform cause was established. The unchanged local baseline passed all
  1,336 checks in 392.259 seconds with two file workers.
  Root checks now run in eight separate jobs, using Node's round-robin file
  partitions and two file workers per job. They retain the original selectors,
  every case and every individual deadline; the compiler runs independently.
  The existing planner decision selects both the compiler and all eight root
  jobs. The summary requires each root job exactly once, completed and successful,
  plus the successful matrix result. Missing, repeated, cancelled, skipped or
  unfinished work cannot establish success. Controlled workflow execution covers
  a future matching file, both additional selectors and failing checks.
  D571 root runtime: healthy general runs before and after root ownership
  activation show the slowest root job growing from 347 to 425 seconds.
  PR984 adds a root test file that moves the seed wrapper into the same
  four-way partition as indirect-reader and lock-selection fixtures; its
  partition reaches the unchanged limit in a workflow that started during a
  GitHub incident. That run is failure evidence, excluded from healthy timing
  comparison. Eight partitions divide that work
  while preserving both file workers, every selector and every deadline.
  Source evidence and the final summary require all eight jobs exactly once;
  older four-job evidence cannot qualify. The first head's
  [general run 42149153883](https://github.com/waitron-io/waitron-cloud/actions/runs/42149153883)
  passes every root job in 83–312 seconds, with unchanged limits and selectors.
  Its complete interval avoids published GitHub incidents, checkout takes at
  most four seconds, and the logs contain no actual download HTTP 5xx.
  All 76 jobs across its four workflows qualify with 21,040 reported Node
  passes and 26 unchanged optional skips. Cost takes the complete fallback
  after workflow-identity lookup refusal, so it has no reusable source plan.
  The final #992 head and its exact merge qualify their own CI and independent
  general/AWS reuse readbacks; the separate merge Kubernetes run executes 37 checks.
  The full nightly at `9237200a` also qualifies all eight root partitions.
  Aggregate usage savings remain open.
  Each work job retains its eight-minute cap. Whole-run timing and the owner's
  five-minute work-job/about-ten-minute total goal needs measured CI evidence;
  a passing local run does not establish hosted-runner duration.
  It does not resolve template substitutions, division
  versus regular expressions, array membership or receiver identities. Unrelated
  expressions and inert text can select extra work; unresolved directory-call inputs
  retain full package work. Executed base/head planner probes cover division
  between the quoted value and stored reader, but do not establish completeness.
  Logical assignments (`||=`, `??=` and `&&=`) and awaited logical or
  conditional operands now retain every package suite. These operators can
  preserve a directory function until its later call, including
  `scan ||= ñs.readdirSync` and `null || await ñs.readdirSync`. Executed Node
  controls cover all four directory APIs, bare and private readers, comments,
  optional access, escaped namespace names, repeated `await` and erased assertions.
  Saved base/head and unchanged transitive helpers retain consumers despite
  dirty local files. Audited lock changes retain full package work with these
  readers and narrow work without them; unused readers and ordinary values
  preserve narrow selection in the controls. The scan remains conservative:
  it does not evaluate assignment conditions, resolve bindings or interpret
  arbitrary expressions, so inert text and unrelated API-named members can
  select extra work. Direct async calls after a logical operator, an object
  property colon or a switch-case colon can also select full package work;
  executed base/head planner controls confirm that additional work. Other
  expression positions and arbitrary predecessor expressions remain unqualified.
  Dot-member namespace readers stored as the first array element now retain
  every package suite, including `[fs.readdirSync, null][0]` and
  `[fs.promises.readdir, null].at(0)`. Executed Node controls cover all four
  directory APIs, one to three namespace segments, comments, optional access
  and erased non-null assertions. Saved-helper checks retain base, head and
  unchanged transitive consumers despite dirty local files; audited lockfile
  changes keep full package work with these readers and narrow work without
  them. Unused helpers, ordinary namespace values and named imports stay
  narrow in the controls. The scan does not resolve member identities or
  parse arbitrary expressions; inert text and unrelated members with these
  names can select extra work, including a reader used as a computed key.
  First-element namespace segments also cover Unicode identifiers, fixed and
  braced Unicode escapes, and private members such as `this.#fs`. Executed Node
  controls load real helper consumers through all four directory APIs, including
  `[ñs.readdirSync, null][0]`, astral letters and join-control characters.
  Comment-separated members, optional access and erased assertions retain that
  fallback. Saved base/head helpers and audited lock changes retain consumers;
  unused helpers and ordinary Unicode member values stay narrow in the controls.
  This lexical scan still does not resolve identities or arbitrary expressions;
  inert text and longer lookalike names such as `readdirSyncñ` can select extra
  work because its word boundary does not follow Unicode identifier rules.
  Other expression positions remain unqualified.
  Quoted computed members such as `fs['readdirSync']` now retain full package
  work for all four directory APIs, including double-quoted and plain template
  keys, comments, optional access, assertions on the object, key or result,
  parenthesized keys and stored references. Executed
  Node controls cover loaded consumers; saved-helper checks cover either revision
  and unchanged transitive consumers despite dirty local files. Audited lock
  changes keep full work with these readers and narrow work without them;
  unreachable helpers stay narrow. This guard does not resolve member identities
  and can select extra work for unrelated keys, arrays of API names or inert text.
  Keys whose first quoted token contains an escape before the next matching
  quote now retain full package work too: Unicode, hexadecimal escapes and
  line continuations can spell a reader without its literal name.
  Executed Node controls cover all four APIs, all three quote forms, comments,
  parentheses and erased assertions. Saved-reader checks retain either revision
  and unchanged transitive consumers despite dirty local files; audited lock
  changes retain full work with a reader and narrow work without one. Unused
  helpers remain narrow. The guard does not decode keys, so unrelated escaped
  member keys and inert text can also select extra work. A receiver check keeps
  plain escaped array values narrow, including arrays after `of` and `return`.
  Receiver matching covers plain names and closing call/index delimiters, with
  comments, optional access and non-null assertions; arbitrary receiver
  expressions remain unqualified. Computed keys without a literal API-name prefix
  or an escape in that first token remain unresolved. Executed base/final probes
  still miss consumers when the escape appears in a later concatenated string,
  a comma expression or a template nested inside the key's template.
  Parenthesized dot-member receivers such as `(fs).readdirSync` now retain
  full package work when the four directory API names are written without escapes.
  Executed Node controls cover
  optional access, comments, erased assertions, deeper namespace receivers and
  stored array references. Saved-helper controls retain either revision and
  unchanged transitive consumers despite dirty local files; audited lock changes
  retain full work with these readers and narrow work without them. Unused
  helpers stay narrow. The guard does not resolve receiver identities, so unrelated
  objects with these member names and inert text can also select extra work.
  Deeper member chains such as `(fs).promises.readdir` now also retain full
  package work when intermediate names use identifier characters, Unicode escapes
  or private names (the `#` prefix used inside a class). Executed Node controls
  include accented characters, `𐐀`, an invisible character allowed inside a name,
  both Unicode escape forms (including extra leading zeros inside braces) and
  private members, across all four directory APIs.
  This includes optional access, comments, non-null assertions,
  erased receiver assertions and stored reader references. Executed Node controls
  cover all four directory APIs and actual loaded consumers. Saved-reader checks
  cover either revision and unchanged transitive consumers despite dirty local
  files; audited lock changes retain full work with these readers and narrow work
  without them. Unused helpers stay narrow. Receiver and member identities remain
  unresolved, so unrelated objects and inert text with the same member spelling
  can also select extra work. Parenthesized chains now also retain full package
  work through bracket members such as `(ns)['nested'].fs.readdirSync`,
  `(ns)[key].fs.readdirSync` and ``(ns).nested[`fs`].readdirSync``.
  Executed Node controls cover all four directory APIs, optional access,
  comments, non-null and erased assertions, concatenated keys and adjacent
  bracket members. Saved-helper controls cover base, head and unchanged
  transitive consumers despite dirty local files; audited lock changes retain
  full work with these readers and narrow work without them. Unused helpers
  stay narrow. Keys are not evaluated, so unrelated objects and inert text
  can also select extra work. Closing brackets now also retain full package
  work through member chains, including `(ns)[keys[0]].fs.readdirSync`,
  `(ns)['nest[ed]'].fs.readdirSync` and unparenthesized indexed receivers.
  Starting at the closing bracket avoids interpreting nested keys. Executed Node
  controls cover all four directory APIs, optional access, comments, erased
  assertions and stored readers. Saved-helper checks retain base, head and
  unchanged transitive consumers despite dirty files; audited lock changes
  retain full work with readers and narrow work without them. Unused helpers
  and ordinary indexed access stay narrow. Receiver identities and keys remain
  unresolved, so unrelated objects and inert text can also select extra work.
  Intermediate bracket segments still exclude embedded brackets, but a later
  closing bracket can independently retain the reader. Other expression positions
  remain unqualified; this is not a general expression parser. Closing template
  backticks now also retain full package work through member chains: a tagged
  template calls a function with a template string and can return a directory
  reader, as in ```ns[key]``.fs.readdirSync(directory)```. Executed Node controls
  cover all four directory APIs, bare and indexed tags, parenthesized tags,
  comments, optional access, non-null assertions, substitutions, escaped backticks
  and chained tags. Saved-helper checks retain base, head and unchanged transitive
  consumers despite dirty files; audited lock changes retain full work with readers
  and narrow work without them. Unused helpers and ordinary tagged values stay
  narrow. The scan also matches opening backticks and backticks in comments.
  Template contents and receiver identities remain unresolved, so inert text
  and unrelated objects can select extra work. General template parsing and
  other expression positions remain unqualified.
  Nested array or object predecessors separated from a stored reader by
  ordinary elements now retain full package work too, including
  `[[], 0, readdirSync, null][2]`. Executed Node controls cover all four
  directory APIs, multiple intervening elements, namespace access, comments
  and erased non-null assertions. Saved base, head and unchanged helper
  checks preserve transitive consumers despite dirty local files; audited
  lock changes retain full work with readers and narrow work without them.
  Unused helpers, ordinary arrays and named imports stay narrow in the
  controls. The additional literal/comment scan now crosses punctuation inside
  complete quoted strings, comments and regular-expression-like tokens. Brackets,
  braces and semicolons outside those matched tokens still bound it. A division
  pair can be mistaken for a regex token and carry the scan across actual
  statement or array boundaries. It does not resolve array
  membership, template substitutions or receiver identities. Arbitrary expression
  parsing remains open. Inert text and unrelated
  expressions can select extra work, including text after a function body
  without a semicolon. An ordinary object expression and a semicolon
  before that inert text have separate package-isolation controls. The
  nested-predecessor delimiter limit now has an independent omission control:
  a completed array statement followed by inert reader text keeps only the
  changed package selected. Removing the whole limit selects unrelated packages;
  restoring it passes. This proves the statement boundary after a closing bracket,
  not the exclusion of bracket characters alone: the earlier array guard also
  retains inert text inside arrays. General expression parsing and the wider
  reader inventory remain unqualified.
  Unicode escapes in dot-member names, such as `fs.re\u0061ddirSync`,
  now retain full package work. Node execution controls cover all four directory
  APIs, escapes at the start and end of a name, zero-padded brace escapes,
  comments, optional access and erased TypeScript assertions. Saved helper
  controls cover base, head and unchanged transitive consumers despite dirty
  local files; audited lock changes retain full work with these readers and
  narrow work without them. Unused helpers and plain escaped array strings
  stay narrow. The guard does not decode names or resolve receiver identities:
  any dot-member name with a Unicode escape, including unrelated names and
  inert text, can select extra work.
  Escaped bare names such as `re\u0061ddirSync(directory)` now retain full
  package work too. Executed Node controls cover all four directory APIs,
  fixed-width and zero-padded brace escapes at the first or last character,
  stored references, comments and erased TypeScript assertions. Saved-helper
  checks cover base, head and unchanged transitive readers despite dirty local
  files. Audited lock changes retain full work with these readers and narrow
  work without them; unused helpers and plain escaped string values stay narrow.
  The guard decodes names without resolving their bindings, so unrelated namesakes
  and inert text spelling a directory API can also select extra work. Other escaped
  identifiers and Unicode text stay narrow. It excludes an opening
  quote immediately before the name; strings with more complex contents and
  other expression forms still need separate qualification.
  Adversarial repeated delimiter/comment
  text can increase scan time; comprehensive parser performance remains unqualified.
  Semicolon-terminated stored references now retain full package work, including
  `const scan = fs.readdirSync;` followed by a later call. Executed Node controls
  cover all four directory APIs, bare and namespace references, comments, optional
  access and erased non-null assertions. Saved base, head and unchanged helpers
  retain transitive consumers despite dirty local files. Audited lock changes keep
  full work with these readers and narrow work without them. Unused helpers,
  ordinary named imports and ordinary stored values stay narrow in the controls.
  This lexical check does not resolve bindings or general assignment expressions;
  inert text spelling an API followed by a semicolon can select extra work.
  Stored assignment references now retain full work across line endings and
  comma-separated declarations, including `const scan = fs.readdirSync` followed
  by a newline and `const scan = fs.readdirSync, unused = 1;`. Executed Node
  controls cover all four APIs, bare and namespace references, comments, optional
  access and erased non-null assertions (`!`), plus CRLF, lone carriage returns
  and Unicode line endings. These controls exercise both the assignment check
  and existing reader checks. Saved base,
  head and unchanged helpers retain transitive consumers despite dirty local
  files; audited lock changes retain full work with readers and narrow work
  without them. The assignment check leaves ordinary named imports narrow.
  An exported reader also retains full work when the assignment ends at the end
  of its file, without a semicolon or final newline. Executed Node controls cover
  all four APIs, bare and namespace references, comments, optional access and
  erased non-null assertions. Saved base, head and unchanged helpers retain
  transitive consumers despite dirty local files; audited lock changes keep all
  package work with these readers and narrow work without them. Unused helpers
  and ordinary exports stay narrow.
  Inert assignment text can still select extra work; these lexical controls do
  not establish complete JavaScript or TypeScript parsing.
  Default-exported reader references, including awaited values, now retain full
  package work at the end of a file or across a line ending. Awaited assignments
  that export the stored reader later also retain full work in the controls.
  Executed Node controls cover all four directory APIs, bare and namespace references, comments, optional access and
  erased non-null assertions. Saved base, head and unchanged helpers retain
  transitive consumers despite dirty local files; audited lock changes keep full
  work with these readers and narrow work without them. Unused helpers, ordinary
  default exports and resolved directory calls keep narrow selection in the
  controls. These lexical checks do not resolve bindings; an unrelated namesake
  or inert text can select extra work. Precise resolution, general assignment
  and destructuring aliases, and other unresolved reader forms remain open.
  Class fields ending before `}` and arrow functions with a single expression
  now retain full package work when they store a reader. Executed Node controls
  cover all four directory APIs, bare and namespace references, static fields,
  comments, optional access
  and erased non-null assertions. Saved base, head and unchanged helpers retain
  transitive consumers despite dirty local files; audited lock changes retain
  full work with readers and narrow work without them. Unused helpers, ordinary
  fields and arrow values, and resolved directory calls keep narrow selection in
  the controls. The scan does not resolve bindings or parse arbitrary expressions;
  inert text and unrelated namesakes can select extra work.
  Block returns also retain full package work when a function or method returns
  the reader before its closing brace, including `return ns.readdirSync }`.
  Executed Node controls cover all four directory APIs, block-body arrows,
  ordinary functions, instance and static methods, awaited values, bare and
  namespace references, comments, optional access and erased non-null assertions.
  Saved base, head and unchanged helpers retain transitive consumers despite dirty
  local files; audited lock changes retain full work with these readers. Unused
  helpers, ordinary return values and resolved directory calls keep narrow selection
  in the controls. These lexical checks do not resolve bindings or parse general
  expressions; inert text, unrelated namesakes or a call continued on the next
  line can select extra work. General assignment, destructuring aliases and other
  unresolved reader forms remain open. Generator yields now retain full package
  work when they yield the reader directly, including `yield ns.readdirSync }`.
  Executed Node controls cover all four APIs, bare and namespace references,
  comments, optional access, erased non-null assertions, generator methods and
  awaited async-generator values. Saved base, head and unchanged helpers retain
  transitive consumers despite dirty local files; audited lock changes keep full
  work with readers and narrow work without them. Unused helpers, ordinary yielded
  values and resolved directory calls stay narrow in these controls. The scan does
  not resolve bindings or parse general expressions; inert text and unrelated
  namesakes can still select extra work. Object shorthand now retains full
  package work when it stores a directory reader, including
  `yield {readdirSync}`, `yield {readdirSync, n: 1}` and `return {readdirSync}`.
  Executed Node controls cover all four APIs, first/middle/final properties,
  nested preceding values and comments. Saved base, head and unchanged helpers
  retain transitive consumers despite dirty local files; audited lock changes
  keep full work with readers and narrow work without them. Static named imports
  are excluded from this shorthand check, including default-plus-named and
  type-only imports, comment-separated forms and the executed quoted-program
  controls. Generated objects still retain consumers in those controls. Unused helpers, ordinary objects
  and resolved directory calls stay narrow in these controls. This lexical scan
  does not resolve bindings or parse general expressions; inert text and unrelated
  namesakes can still select extra work. General aliases, destructuring and precise
  object/binding resolution remain open. Destructured reader bindings, named
  reader exports, quoted text such as `'{readdirSync}'` and generated import text
  with escaped quotes can still select extra work. Executed base/final probes
  record these conservative cases; precise binding and generated-code resolution
  are optional efficiency follow-ups outside D69. Call arguments ending in a comma now retain full package
  work when they transfer a directory reader. Executed Node controls cover all
  four APIs, first/middle/trailing-comma arguments, nested preceding values,
  namespace members, comments, optional access, erased non-null assertions and
  awaited values. Saved base, head and unchanged helpers retain transitive
  consumers despite dirty local files; audited lock changes retain full work
  with these readers. Generated programs, a transfer inside division tokens
  and division in neighboring arguments retain their executed consumers.
  The same context rule retains object shorthand between division-valued
  properties. Executed controls cover all four APIs there and a division followed
  by a path-string argument. Unused helpers, ordinary arguments, static
  named imports and resolved directory calls keep narrow work in the controls;
  separate inert quoted fragments cannot combine into a transfer. This lexical
  scan does not resolve bindings or distinguish parameter declarations and
  inert program text from executed calls, so those can select extra work.
  General alias, binding and generated-input resolution remain open; these
  controls do not establish complete JavaScript reader discovery.
  A broad review run reported one child-status assertion with `null` instead
  of zero, but its output filter lost the test name and child diagnostics.
  A later 1,600-check run passed; that does not establish the first failure's
  cause. Preserve complete TAP, the named test, child error/signal and output
  before changing any assertion or deadline on recurrence. The complete
  reader/object controls pass separately; no broad-load reliability claim is made.
  The object check requires a brace
  context, so array readers keep their existing diagnostics and comma-only text
  stays narrow. Each quoted program has its own delimiter context; separate inert
  fragments cannot combine into a reader. A division-like token can contain live
  code, so its body is also checked for a stored object reader. A valid
  12,000-import control executes in Node and keeps five repeated saved-revision
  plans, using the production batched Git reader, within one five-second child budget. The initial source-masking scan
  reproduced a timeout; ordered import ranges, token contexts and skipping
  ordinary quoted values without reader names pass that same bound. This does
  not qualify arbitrary parser inputs, nested generated programs or host load.
  A final element's trailing comma also keeps full work, including multiline and
  comment-separated forms. Saved-helper and lockfile controls independently exercise
  final elements, so the first-element guard cannot mask a missing final-element guard.
  TypeScript `as` wrappers already retain full work; the diagnostic can name an
  import alias or an indirect call, depending on the surrounding expression.
  Precise resolution and clearer reasons remain open.
  Existing assertions and reader-audit
  certificates are unchanged. Repository-root working directories, computed
  inputs, non-source directory contents and broader root-path selection remain
  conservative. The owner closed D69 with the run-all fallback; more precise dynamic-input selection is optional future work. Identity still selects all nine packages in the current graph;
  portal-only changes retain full package work when any saved reader is unresolved
  or a declared version has changed. The 40 exact D571 declarations bound known
  runtime/data operations without weakening unknown-reader checks. Unaudited root,
  unknown and empty changes run everything.
  Type checking stays whole-workspace. The root command compiles the shared
  backend configuration once, then runs the portal and UI-smoke configurations.
  The seven backend package commands use the same root configuration, so repeating
  them does not check additional sources. The package-revision checks run in separate
  files discovered by the existing CI command, preserving every test
  body, assertion and fixture while allowing Node to run the files in parallel.
  This follows an eight-minute job cancellation after all 671 root checks and
  compiler checks completed; the test step alone took 457.9 seconds. The roughly
  five-minute job target still needs qualification. Real-compiler controls retain errors in
  every backend package, a newly added package, portal source/tests and UI
  declarations. A workspace inventory check refuses an unaccounted compiler
  command or configuration. Individual package commands remain available. Measure
  the full CI job before attributing any billed saving; the new behavioral checks
  also take time. The automated controls now inject a real type error into every backend test
  directory and a newly added backend package. They require a compiler diagnostic
  for each file, then pass after correcting all injected errors. Excluding those
  test directories in a disposable copy makes the new check fail. Missing
  package compiler scripts now fail with the affected package name, including
  absent scripts objects and non-string commands. Isolated workspace checks
  remove each package command in turn, require the named inventory failure and
  pass after restoration. Every compiler assertion and command remains unchanged.
  Both `-p` and the equivalent `--project` spelling identify the same three
  configurations in the inventory and real compiler trace. Isolated controls
  switch every package to the long spelling and still refuse unknown commands
  or configurations. All earlier compiler assertions remain in place.
  **pnpm setup:** capture a labelled recurrence to explain the historical network
  failures, and qualify cleanup when the supervisor itself is forcibly stopped.
  Native cancellation now remains visible when no request error follows an
  `.abort()` event, including before socket assignment or exit from an abort
  handler. Cleanup after a complete wire transfer stays successful. The historical missing npm timeout diagnostic
  remains unattributed; no existing assertion or deadline changed.
  Keep signature verification, version pins and deadlines; see the
  [setup boundaries and remaining work](backlog/ci-pnpm-setup.md).
  **Remote fixture container preservation (D530).** Running the rendered TLS
  and trial-receipt wrappers together reproduces the whole-host inventory race:
  the trial's database and counters appear during the rendered fixture. Each
  wrapper now excludes only positively labelled traffic siblings from the
  foreign inventory and retains every unrelated running or stopped container.
  A uniquely labelled witness must also retain its identity, start time and
  running status across cleanup. A lost create response is recovered through
  its unique label. Owned labels and names must both be empty afterward; the
  original traffic, image, anonymous-volume and receipt checks remain. Controls
  execute both wrappers with restarted or stopped witnesses, removed unrelated
  foreign containers and a lost create response, requiring refusal and cleanup.
  This repairs the inventory assertion; it does not explain unrelated historical
  browser, transport, install or backup-cleanup failures.
  **Passive audit-read clock fixture (D530).** Session creation and activity
  defaults can fall in different milliseconds. The HTTP audit-page test now
  seeds that difference and compares activity and creation time before and after
  both page reads, so the passive-read check no longer assumes equal defaults.
  Real PostgreSQL reproduces the old one-millisecond failure and passes the
  corrected test. Production session behavior and migrations remain unchanged.
  Independent controls catch activity and creation-time rewrites. This test
  still does not cover activity updates delayed by sixty seconds or changes to
  absolute session expiry; those limits also existed in the original test.
  **Nested package authentication (D530).** All five package-test entry points
  and the grouped receipt step now pass the existing read-only package token to descendant installs. A cold
  loopback-registry control reproduces the placeholder-token 401 and loads the
  installed package with each workflow binding. See the
  [failure receipt and remaining unknowns](backlog/ci-pnpm-setup.md#nested-package-installs-d530).
  The separate schema-upgrade checkout refusal now retains fixed release and
  operation labels with bounded child exit facts, while withholding arguments
  and output. The historical lifecycle failure remains unattributed.
  Package-only changes omit the two-venue milestone receipt when both immutable
  revisions retain its audited regular-file inputs, test command and CI wiring.
  These tests exercise validators and receipt composition; their guarded CLI
  blocks do not launch backend proofs when imported. Changed, missing or linked
  readers and unsupported evidence keep that receipt. Package-only changes also
  omit the backup-capacity receipt when both revisions retain its audited TLS
  fixture, two backup source files, validators, installation inputs and CI wiring.
  Root installation files and all tracked package manifests must match the complete
  audited inventory, so nested manifests, new install hooks or packages keep the
  receipt. Tracked dependency overrides under `node_modules` also keep it. Changed storage
  or transfer code still runs the real TLS checks. Package-only changes also omit
  the database-recovery receipt when both revisions retain its audited syntax-check
  targets, validator, migration-count helper, migration module, transaction helper,
  installation inputs and CI wiring. The suite checks syntax and validators; it
  does not execute the physical recovery drill. Changed imports or missing evidence
  keep the receipt. Any tracked `.gitattributes` file also keeps capacity and
  database-recovery checks: checkout encoding can change a reader without changing
  its stored Git hash. A fresh-clone control proves the UTF-16 import failure.
  The shared installation check preserves the earlier capacity guards.
  Package-only changes also omit the public-gateway receipt when both revisions
  retain its audited seven-module test closure, installation inputs and CI wiring.
  The tests exercise the real TLS gate, its fallback page and strict receipt
  validator. Changed gate/page code, helpers, test roots, commands, manifests,
  checkout attributes, install hooks or dependency overrides retain the checks.
  Package-only changes also omit the local-stack receipt when both revisions
  retain its audited deployment helpers, package readers, root script/test files,
  installation inputs and CI wiring. Whole deployment and migration directory
  hashes preserve wildcard test discovery and new directory entries. The tests
  exercise configuration, manifests, migration compatibility, operations metrics
  and validators; their child probes use controlled failures or supplied fixtures.
  They do not launch the deployed service stack. Changed or missing readers,
  new directory entries, installation hooks, attributes or overrides keep the checks.
  Unknown/full changes retain all five;
  portal source changes also omit local-stack when its audit holds, otherwise they
  retain it. Isolated ui-smoke needs no receipt. Registration
  uses six file shards, account HTTP uses three, portal uses six and backups uses
  seven. Selected identity, operations and remote-access suites share one job when at
  least two are needed. Each keeps its full package command and deadline, runs
  once in sequence, and reports its own result. One PostgreSQL/Mailpit setup
  serves the group; a failure fails the job while later suites still run. The
  summary refuses malformed groups and overlapping package execution. Other
  packages keep one job each. Selected receipt suites share one
  setup and run in one job. The runner validates every selected suite before
  execution, runs each once and continues after a failure so later results remain
  visible. Any failed suite fails the job; the summary requires that job to
  complete successfully. The existing receipt-input audits also pin the grouped
  runner and its suite registry, because they now control execution. Changed or
  missing execution inputs retain the affected receipt. The five receipt commands
  and all their assertions stay intact. Compare observed job wall times and complete
  case counts with the preceding five-job sample before claiming a saving; whole-run runtime and other grouping work remain
  open. Each file runs once, with its original
  assertions and test deadline. The authenticator clock-rollover case has its own
  portal file so sharding can separate its two real clock waits from the main
  authenticator journey. All work jobs have an eight-minute limit; the target is
  at most five minutes per job and about ten minutes for the whole run, including
  setup and queueing. Measure both the candidate and its merge before claiming the
  target is met.
  Browser packages install Chromium with at most two attempts, each bounded to
  120 seconds plus a shared ten-second cleanup allowance. On Linux, the privileged
  supervisor adopts its own orphaned descendants, including dpkg processes that
  start a separate session. It checks current parentage before signalling through
  stable process handles, and reaps adopted children after success, failure,
  timeout or cancellation. A second cancellation signal cannot interrupt that
  cleanup. Kernel handle and signal support are probed before installation;
  pre-existing children cause refusal instead of being assigned to the attempt.
  Each process receives at most one signal per cleanup phase. Unconfirmed
  cleanup refuses another attempt. The explicit browser cache path keeps the
  installed browser available to the runner. Before each
  attempt it waits at most 30 seconds for the existing apt/dpkg locks, without
  deleting lock files or stopping another process. The retry delay stays five
  seconds and all browser assertions and test deadlines stay intact. These
  configured allowances total at most `2 × (30 + 120 + 10) + 5 = 325` seconds,
  excluding job setup; the job still has its eight-minute limit. The lock waits
  are additional time introduced by the earlier supervisor change.
  D109's retrospective review found that apt could move dpkg outside the earlier
  process group and that a second cancellation could skip the forced stop.
  Real Linux session/lock checks now cover escaped children, stale ownership
  data, unavailable kernel support, inherited children, repeated termination
  and refused cleanup while preserving an
  unrelated holder. Host checks cover repeated cancellation and background
  children after successful and failed parent exits. A real disposable local
  package install leaves no apt/dpkg/install-script processes behind after its
  timeout. The interrupted package configuration still refuses the next install:
  cleanup releases process ownership and locks, not dpkg's unfinished records.
  Use a fresh CI runner; this helper does not run automatic package repair.
  [Run 39744422290](https://github.com/waitron-io/waitron-cloud/actions/runs/39744422290/job/119709401502)
  failed before UI-smoke tests: a timed-out dependency install left apt holding
  its lock. A controlled reproduction runs the workflow shell with a real
  lock-holding child that ignores termination: the old retry fails, while the
  supervised retry kills that child and succeeds. Run
  `node --test scripts/ci-download.test.mjs scripts/ci-download-linux.test.mjs scripts/ci-workflow.test.mjs` to check
  retry exhaustion, cancellation, lock release and refusal to touch an unrelated
  lock holder. On macOS, set `CI_DOWNLOAD_LINUX_IMAGE` to a cached Linux image
  with Python 3 (for example `node:26`) to execute the Linux checks in an owned
  container. Actual CI separately qualifies the root boundary and browser
  cache access. This handling does not establish why the outside download stalled.
  Ubuntu's Azure mirror and primary archive have both exhausted these limits.
  In [run 39804073424](https://github.com/waitron-io/waitron-cloud/actions/runs/39804073424/attempts/2),
  portal shard 1 timed out twice fetching the 15 MB `noble/universe` package index
  from the primary archive. Earlier
  [run 39787485838](https://github.com/waitron-io/waitron-cloud/actions/runs/39787485838)
  reached package downloads but timed out fetching fonts and NSS libraries.
  An initial alternative, kernel.org, was refused by a GitHub runner at its
  IPv4 address in [run 39810150851](https://github.com/waitron-io/waitron-cloud/actions/runs/39810150851/job/119934129050).
  Its local signed-download probe passed, so local reachability alone cannot
  qualify the source for Actions.
  CI directs recognised Azure, primary and runner mirror-file archive
  references to a local APT mirror list. APT tries Princeton first, then
  `https://archive.ubuntu.com/ubuntu` when a file cannot be fetched. Your release,
  components, architectures, signing keys and unrelated source files retain their
  values. A generated APT configuration limits HTTPS connection and idle waits
  to 10 seconds, including other HTTPS sources on that disposable CI runner, so
  an unavailable host leaves time for the alternative. The two outer 120-second
  attempts, cleanup grace, package-lock waits and retry delay stay unchanged.
  Ubuntu's signed release metadata and package hashes still decide which bytes
  you can install; no additional signing key or unsigned source is introduced.
  See [Ubuntu's archive verification](https://documentation.ubuntu.com/security/software-integrity/archive-verification/)
  and [APT's mirror fallback and priority rules](https://manpages.ubuntu.com/manpages/noble/man1/apt-transport-mirror.1.html).
  Run `node --test scripts/ci-browser-source.test.mjs scripts/ci-download.test.mjs scripts/ci-browser-apt.test.mjs`
  to check preserved source fields, the unchanged workflow, controlled unavailable
  mirrors and exhausted attempts. On Linux, the final check runs real APT against
  a temporary signed archive: it checks the effective timeout after runner defaults,
  downloads through the alternative when the first connection cannot complete,
  refuses two unavailable mirrors, rejects altered signatures and
  rejects changed package bytes. It installs no package and uses no system APT
  state. On macOS that Linux check is skipped; GitHub CI must execute it.
  Browser CI now requests stable index filenames, keeping the mirror that
  supplied each signed release. APT's by-hash URLs otherwise select a mirror
  again for every index, including one that just failed. Signed release metadata
  still supplies the required index digests, and package hashes still apply.
  Stable-path selection is now limited to each rewritten Ubuntu source entry,
  using APT's [source-local By-Hash option](https://manpages.ubuntu.com/manpages/noble/man5/sources.list.5.html).
  Vendor sources keep their own bytes and hash-addressed downloads, which can
  avoid stale filename copies during index publication. A mixed Ubuntu/vendor
  Deb822 stanza refuses before any source is changed because one stanza shares
  its index policy. Signing keys, digest checks and retry deadlines stay intact.
  Run `node --test scripts/ci-browser-vendor.test.mjs` on Linux to reproduce a
  signed stale-filename mismatch, successful vendor hash-addressed acquisition,
  and refusals of altered immutable-index bytes and signatures. The historical
  Microsoft publication mismatch in [run40482034486](https://github.com/waitron-io/waitron-cloud/actions/runs/40482034486)
  remains unattributed; a controlled reproduction does not explain its CDN state.
  If an index changes during publication and its required bytes cannot be fetched,
  a digest mismatch still refuses the update; no package state is repaired.
  A separate [extra relay admission](backlog/relay-contention-extra-admission.md)
  needs PostgreSQL reproduction; this source repair does not explain it.
  The controlled regression includes four suites with sixteen package indexes
  and forty-eight compressed package, translation and command indexes, with a
  separate altered-index refusal. Both journeys require the actual stable
  index request paths, with no missing or extra requests. The compressed Ubuntu by-hash case reproduced the
  release-success/index-timeout sequence before stable filenames were introduced; the one-index and
  uncompressed sixteen-index cases did not. Run
  `node --test scripts/ci-browser-apt-components.test.mjs` on Linux as well as
  the original trust and refusal journeys. If the isolated fixture's update or
  package download fails, its bounded stderr record names the stage and scenario,
  retains the output tail and lists the latest requests received by its local
  archive. Run `node --test scripts/ci-browser-apt-diagnostics.test.mjs` on any
  platform to check timeout evidence, nonzero exits, output bounds and silent
  success. The original exception, result, checks and deadlines are preserved.
  On the Ubuntu 26 test box, the archive fixture reproduced three unexpected
  TLS closes before signed-index validation. Its HTTP handler now sends the
  TLS shutdown notification, with a one-second limit for the peer to reply.
  Run `node --test scripts/ci-browser-apt-tls.test.mjs` for strict clients that
  reply, stay silent or disconnect. All three original component journeys and
  the original signature/package-hash refusal journey pass on that box with
  their assertions and deadlines unchanged. This repairs the local fixture
  transport. The handler also disables TCP coalescing, which can hold small TLS
  writes while earlier bytes await acknowledgement. The same three transport
  checks now inspect both accepted sockets as well as response bytes and bounded
  shutdown. All original APT assertions, signature and hash checks, retry limits
  and deadlines remain unchanged.
  The compressed-index update timeout in
  [run40536424286](https://github.com/waitron-io/waitron-cloud/actions/runs/40536424286/job/122302974742)
  remains unexplained; the missing temporary configuration warning's relation to
  that timeout is unknown. A later
  [index-hash recurrence](https://github.com/waitron-io/waitron-cloud/actions/runs/41276827214/job/124760631141)
  recorded the expected hash mismatch and 47 local requests before the eight-second
  supervisor expired. Neither historical run captured packet timing, so the exact
  historical cause remains unknown. Run the Linux component journeys and
  retain their labelled failure evidence on another recurrence; a passing retry
  alone does not repair a timeout.
  The public mirror's underlying
  network failure remains unexplained; this change addresses index selection.
  Real Actions qualification must show two consecutive full runs of the same
  head and its independent merge run, with one install attempt and every portal
  and UI-smoke test executed. Keep this gate when changing sources; controlled
  checks alone do not qualify public mirror availability.
  [Run 39890570457](https://github.com/waitron-io/waitron-cloud/actions/runs/39890570457/job/120209180867)
  and [run 40094682408](https://github.com/waitron-io/waitron-cloud/actions/runs/40094682408/job/120874425012)
  could not connect to Princeton at `128.112.18.21:443`. The fallback addresses
  the repeated single-host dependency. Either public archive can still fail,
  and the existing supervisor must refuse within its limits if neither works.
  [Run 40423880234](https://github.com/waitron-io/waitron-cloud/actions/runs/40423880234)
  later refused Princeton's expired certificate chain before browser tests.
  The alternative retains TLS verification; an expired certificate is never trusted.
  The outside network cause and the separate browser reconnect cause remain
  unknown; those original red runs remain evidence.
  The rewrite recognises the runner's current lowercase, whitespace-delimited
  URIs. Qualify compact Deb822 URI fields or capitalised hostnames before
  widening that support when a runner changes its source format.
  When the source helper rewrites no archive URI, it now warns on stderr and
  continues: your sources may already be prepared or the runner layout may have
  changed. A warning keeps an unfamiliar but usable runner eligible; the existing
  signed-package checks and bounded install still decide whether CI can proceed.
  Empty, unfamiliar and already prepared source inventories retain their bytes
  and successful exit status; a real rewrite reports its mirror without the warning.
  Source preparation now reads every selected file as UTF-8 before writing any
  source, so an unreadable vendor file refuses without rewriting earlier files.
  A real-command invalid-byte regression preserves both files byte for byte;
  deliberate faults also prove each URI's leading whitespace boundary. This preflight does not make subsequent
  write failures atomic or qualify new source formats. ARM
  runner sources remain unqualified; check their archive location before adding
  that architecture. The current workflow uses x64 runners. D117 preserves line
  endings, closing the review's separate newline-format note.
  D107's corrected-head
  [run 39776383906](https://github.com/waitron-io/waitron-cloud/actions/runs/39776383906/job/119816424815)
  could not build the verification fixture because Docker Hub returned
  `502 Bad Gateway` for the `node:26` manifest. The two infrastructure tests
  in `packages/backups/test/verification-infrastructure.test.ts` did not run;
  cleanup also refused to remove the image that was never built. The outage
  fixture now acquires a missing base before creating its PostgreSQL container,
  makes at most three pull attempts for transient registry failures, and shares its existing
  120-second image-preparation budget across acquisition and one build. Cached
  bases need no pull; authentication refusals stop immediately. Cleanup removes
  the uniquely requested image tag when present and the uniquely named attempted
  PostgreSQL container, including failed builds and starts. Docker's forced
  container removal accepts an absent container; other cleanup errors remain
  visible and image cleanup still runs after container-removal failure.
  The readiness probe
  checks TCP because PostgreSQL's temporary initialization server already accepts
  local sockets. Fourteen controlled acquisition/failure checks and the two
  real outage/malformed-archive tests pass with the existing limits and original
  behavioral checks. The target-bound worker uses the same acquisition helper
  with its own Dockerfile, building exactly once before PostgreSQL starts. This handles
  the local fixture failure; it does not fix Docker Hub's response or guarantee
  registry availability. Other backup fixtures still acquire their base inside
  their own build; extend this preparation helper there if acquisition fails.
  The later [D108 qualification run 39786287483](https://github.com/waitron-io/waitron-cloud/actions/runs/39786287483/job/119850413048)
  exhausted both browser-install attempts before any portal test ran. D117's
  signed alternative source above now has two consecutive full exact-head runs
  and an independent merge qualification, each installing in one attempt and
  executing every browser test. The historical primary-archive slowness remains
  unexplained. Every fixture head requires its own CI qualification.
  **Local storage fixture port allocation repaired; original holder unknown.** In
  [run 39929839494](https://github.com/waitron-io/waitron-cloud/actions/runs/39929839494/job/120335229364),
  SeaweedFS's filer failed before the separate-authority concurrency case because
  its loopback address was already in use. The fixture now holds all seven child
  port reservations together until just before spawning SeaweedFS, preventing the
  allocator from choosing one port for two services. Reservations drop incoming
  connections so a peer cannot hold their release open. Partial allocation failure
  closes every earlier reservation. A child startup failure records the named
  port allocation and a bounded `lsof` listener snapshot, or an explicit reason
  that collection was unavailable, before stopping only its own child.
  Native tests reproduce the earlier release pattern, allocation interruption and
  an owned competing listener. Authority/concurrency checks and service deadlines
  are unchanged. Another process can still claim a port during the handoff to the
  separate child. The [parallel fixture repair](#parallel-storage-cache-fixture-failure-on-main)
  now retries an explicit refusal of an allocated port once, preserving its
  diagnostics and leaving the competing owner alone. The historical CI socket
  owner remains unknown. D101 slice 3 landed in PR311 after fresh head and merge
  CI; every later fixture change still requires its own qualification. A
  successful unchanged rerun is not a cause diagnosis.
  A separate test-harness route failure remains unattributed. In
  [run 39813909743](https://github.com/waitron-io/waitron-cloud/actions/runs/39813909743/job/119947375548),
  registration shard 2 never ran its tests: pulling `axllent/mailpit:v1.31.1`
  from Docker Hub failed with an IPv6 `connect: network is unreachable` error.
  The launcher now retries that connection response within its existing
  three-attempt, 120-second per-image acquisition limits. Docker-free checks run
  the real launcher against a controlled Docker executable, proving recovery
  for both pinned images before either container starts, and refusal after three
  unreachable responses without running package tests. Original assertions,
  deadlines, cancellation and container cleanup remain unchanged. Run
  `node --test scripts/ci-test-postgres.test.mjs` for those checks. Real Docker
  qualification runs in CI while local Docker is unavailable. The outside
  route's cause and recovery remain unproved; a later successful pull does not
  establish a route fix. The historical job's stale `in_progress` record hid its
  failed step, so read the actual job log and final status before counting tests.
  Main pushes use a unique concurrency
  group per run so a later merge cannot cancel an earlier merge's checks;
  superseded pull request runs still cancel. The workflow text guard checks shard
  completeness and deadlines. The summary checks actual job records against the
  plan, refusing missing, duplicated, cancelled, unfinished or failed required
  jobs, and any unexpected executed job. Unused job families must finish skipped.
  Every PR job checks out its exact
  head SHA. The former 2026-10-18 policy repeated complete package, receipt and
  compiler suites on every main push. D571 part 5 replaces that policy
  with independently verified identical-tree reuse and actual main-range selection.
  D571 part 6 supplies an additional nightly full run under the 4 November
  decision; it does not itself remove main-push testing. Local
  regressions exercise the real planner and summary commands and both equal-tree
  and advanced-main squash merges without depending on the pull-request API.
  The reuse helper and its evidence checks remain historical controls.
  The planner explicitly disables setup-node's automatic package cache because
  it does not install dependencies. The lockfile control selected all 20 package
  jobs, then reproduced a missing-store failure in the cache-saving cleanup step
  ([run 38546606743](https://github.com/waitron-io/waitron-cloud/actions/runs/38546606743)).
  setup-node describes its input as “Set to false to disable automatic caching”
  ([action definition](https://github.com/actions/setup-node/blob/v5/action.yml), read 2026-10-14).
  Historical Actions controls proved portal-only selection (three nonempty shards,
  180 tests), identity's complete consumer set (all nine packages), and lockfile
  fallback (then all 20 package jobs and five receipts). The corrected cold-lockfile
  [run 38548997181](https://github.com/waitron-io/waitron-cloud/actions/runs/38548997181)
  passes all 28 jobs and all 1,477 package tests, including the added usage case.
  The [current scratch merge](https://github.com/waitron-io/waitron-cloud/actions/runs/38547672978)
  reuses its green head with only planner and summary work; the
  [behind scratch merge](https://github.com/waitron-io/waitron-cloud/actions/runs/38547920473)
  refuses reuse and passes the full suite. The portal head and its merge use
  18 + 2 = 20 rounded job-minutes, compared with the previous full-run pair's
  70 + 70 = 140. These are timestamp-based rounding estimates, not invoices.
  That historical backlog-bearing PR took the full route because mixed docs and
  code changes remain outside the narrow selectors. Its observed full head uses 72 minutes; adding the measured
  two-minute reuse gives a 74-minute pair estimate. The final production pair is
  recorded in the [PR evidence](https://github.com/waitron-io/waitron-cloud/pull/124).
  The simultaneous proof runs queued behind each other: identity took 13m54s
  overall, while every executed job stayed within 4m14s. Treat queue time separately
  from test duration and keep measuring normal runs.
  [Run 38500339948](https://github.com/waitron-io/waitron-cloud/actions/runs/38500339948)
  on `9bb8e8644d5ce9993fffa3f7ec13170d81de5ae4` took 9m45s in portal and
  9m02s in account HTTP before this split. The package logs counted 1,476 tests;
  compare the sum of every shard's count with each package's original count.
  Whole-package coverage must remain whole-package if a package later enables it.
  Run focused local checks while implementing; CI owns mandatory package suites
  under the owner's 2026-10-18 decision. Check every job on the exact PR head
  and the independent main run.
  On an 18-core local runner, the unsplit registration suite exhausts PostgreSQL's
  shared lock table while resetting disposable schemas (`53200: out of shared
  memory`). For a full local package run, put `--test-concurrency=2` before the
  file list, for example
  `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-concurrency=2 --test-timeout=30000 'test/*.test.ts'`.
  The full unsplit account HTTP suite also reports PostgreSQL `53200` during
  disposable migration setup on this Mac: the D72 run completed 292 cases with
  82 failures, including the unchanged signup, origin, session and rate-limit
  fixtures. Use the same two-file limit for full local database package runs;
  retain every file, original deadline and portal build. A later parallel local Task 21 run
  also killed the unchanged npm-bootstrap probe at its 35-second deadline without
  retaining npm output. An isolated run passed in 31.36 seconds; that does not
  explain the earlier deadline. Capture process startup and request timestamps on
  recurrence, and preserve the original budget. A later D69 focused CI-script
  run passed 970 of 971 checks and reached that same unchanged 35-second
  bootstrap limit with no child output. The test and workflow match its base.
  An isolated instrumented copy passes in 31.4 seconds, with tarball requests at
  0.4 and 16.4 seconds. A controlled five-second npm startup delay reproduces
  the unchanged timeout assertion. This demonstrates that startup time can
  consume the remaining budget; the original run recorded no request stages,
  so its precise cause remains unproved. No bootstrap assertion or limit changes.
  Retain startup and request timestamps on recurrence. Local receipts are under
  `~/waitron-campaign-d/receipts/d69/nested-predecessor-readers/`.
  Fiscal store and HTTP fixture construction now close acquired resources when
  a later setup step fails. Docker-free checks force authority startup, table,
  venue, listener and machine setup failures, using real authority children,
  HTTP listeners and pool objects with database operations replaced. Normal
  teardown also closes multiple HTTP listeners. The PostgreSQL package suites
  verify the unchanged fiscal behaviour in CI; local database checks remain
  unavailable while Docker is down. The authority helper now stops its child
  and removes its temporary directory before rejecting failed startup or restart.
  Docker-free checks force a synchronous spawn refusal, a missing executable,
  early child exit and malformed ready output, preserving the startup error.
  Keep the package's original test deadline and any build step. Appending the
  concurrency option to the package script leaves it after the files and does
  not limit this runner. The fixture's default lock capacity for a full local
  parallel run remains open; preserve every assertion when addressing it.
  A later bare `node scripts/test-postgres.mjs` run repeated `53200` in registration
  schema reset/migration, including authenticator setup; it reported 576 passes and
  72 failures among 648 result entries. The last relay-worker test process remained
  open with no remaining test-database sessions. Stopping its recorded process ID
  allowed the failure report and wrapper cleanup to finish. Qualify that fixture's
  failed-setup/resource cleanup separately; the exact remaining handle was not
  identified. The documented two-file command keeps every original assertion and
  deadline; the bare run's failure remains recorded.
  The residential-comparison bare run repeated `53200` in authenticator schema
  reset and reported 377 passes and 273 failures among 650 registration result entries.
  Its remaining `test/relay-operator-stop.test.ts` worker also needed an owned-PID
  stop before failure reporting and wrapper cleanup completed. The exact open
  handle remains unproved. The complete documented two-file suite then passes
  all 646 registration cases; that qualification does not close the unsplit-resource
  or historical open-handle investigation. The shared relay-worker fixture now closes
  both pools when schema creation, migration or its clock read fails, and drops only
  a schema whose creation succeeded. Cleanup attempts later resources even if an
  earlier step fails; a setup failure remains the cause when cleanup also rejects.
  Docker-free checks exercise real pool closure with database operations replaced.
  They do not reproduce the historical PostgreSQL hang; genuine database cleanup
  remains for CI. The relay operator-stop SMTP fixture now rejects listener startup
  errors with their original cause instead of waiting for a successful listen
  callback. A Docker-free occupied-port check reproduces the earlier pending setup
  and keeps the competing listener open; real mail capture and test teardown are
  also checked. This does not identify the historical PostgreSQL hang's cause.
  Diagnostics: `~/waitron-campaign-d/receipts/d76/`.
  The migration batch-size fixture now confines its database-wide DDL trigger
  to its own schema. A second populated fixture proves that other tests can
  migrate while it is active; the original 103-recipient and 100-row batch
  assertions remain.
  The usage privacy fixture now uses an owned organisation identifier distinct
  from the foreign-count marker `999`. A valid identifier containing those digits
  reproduces the old false privacy alarm; an added HTTP case proves that such an
  owned identifier remains allowed while foreign totals and credentials stay out.
  Every original privacy and ownership assertion remains unchanged. The natural
  local failure did not record the matching value, so its exact cause stays unproved.
  The pairing lock/expiry fixture prepares five seconds of valid authority, then
  waits on the database clock until that deadline passes before releasing its
  observed membership lock. A controlled 200 ms call delay reproduces the old
  100 ms fixture failure and passes with this setup. Every original refusal,
  observed-lock and rollback assertion and the 30-second deadline remain.
  Removing both mutually masking post-wait expiry checks fails the owning test;
  restoring them passes. The natural CI failure did not record entry timing, so
  its exact cause remains unproved. Production expiry rules are unchanged.
  The Cloud-approval session-expiry fixture also starts its five-second deadline
  after setup. It identifies the approval waiting behind its membership blocker,
  checks that the session is still valid, then waits on the database clock before
  releasing the lock. An outside expiry update would wait on the session row
  already held by approval. A controlled 200 ms setup delay reproduces the old
  observed-lock assertion failure; the corrected fixture retains that slow setup
  and passes. All
  original session-refusal, observed-lock and absent-approval assertions and the
  30-second execution deadline remain. Main run `39209023087` did not capture
  these timing boundaries, so its exact scheduling remains unproved.
  Other pairing expiry fixtures still observe any lock wait in their schema;
  identify their actual blockers before claiming that observation proves a
  membership-lock wait.
  This budget is separate from intermittent fixture failures; more time is not
  a diagnosis of a failing assertion.
  **Two fixture failures reproduced after the authenticator merge.**
  [Run 38373683976](https://github.com/waitron-io/waitron-cloud/actions/runs/38373683976)
  on docs-only `7860981` failed registration and portal. Advancing each clock read
  by one millisecond makes the relay worker fixture reject its lease: its separate
  `issuedAt` and `expiresAt` clock reads can exceed the one-hour limit. The worker
  fixture now reads the clock once. Its advancing-clock regression passes and
  restoring the separate reads fails; the production maximum and every existing
  worker assertion remain. The Spanish/dark/390 authenticator journey also failed
  at its first factor sign-in. A controlled rollover after enrolment reproduces the
  same timeout with a real 401: the journey's previous-step code then names the
  already-consumed enrolment step. The first sign-in fixture now uses a valid
  code for the next 30-second period, which the existing verification window
  accepts. A real browser/PostgreSQL regression observes the clock advance
  after enrolment, signs in with that fresh code, refuses the consumed enrolment
  code, then accepts an unused code from the previous period after the next clock
  advance.
  It fails with 401 before the fixture correction and passes afterward. All original
  journey assertions and the seven-second waits remain. The failed CI did not record
  its factor response or steps, so the reproduced mechanism does not establish that
  historical run's exact cause; collect the failing response on any future failure.
  **Server-startup fixture grouping.** The plan merge's
  [run 38375993173](https://github.com/waitron-io/waitron-cloud/actions/runs/38375993173)
  timed out in the single server CLI settings/missing-migration test after 30 seconds.
  Its unchanged local run takes 14.9 seconds; adding one second to each real child
  startup reproduces that timeout. Each missing migration now has its own named test,
  keeping all original refusal/ledger assertions and the existing 20-second child
  and 30-second test deadlines. The controlled slow-start run passes all 31 cases. Individual startup timings were absent from CI,
  so its exact failure cause remains unproved; use the named case on a future failure.


  **HTTP authenticator replay fixture.** The management journey retains the exact
  activation code for its replay refusal, instead of computing a potentially fresh
  code after the 30-second period changes. A previous-step enrolment variant
  reproduces the old `200 != 401` failure and passes with that correction. All
  existing replay, session, recovery-code and cookie assertions and the 30-second
  test deadline remain. The complete HTTP authenticator file passes 16 checks;
  bypassing replay refusal in a disposable checkout fails both management variants
  at their unchanged 401 assertions. Run
  `node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec
  node --test --test-timeout=30000 test/authenticator-factor.test.ts`.
  [Run 38419110801](https://github.com/waitron-io/waitron-cloud/actions/runs/38419110801)
  failed that assertion. CI did not record the two code periods, so its exact cause
  remains unproved. Production authentication code and accepted code periods stay
  unchanged.

  **Registration authenticator replay fixture.** The registration-store enrolment
  test now retains its exact accepted activation code for the replay refusal,
  matching the HTTP fixture and the approved authenticator spec. A previous-step
  enrolment variant reproduces `Missing expected rejection` with the old fresh-code
  expression. The refusal code, every original assertion and the 30-second test
  deadline remain. No production authentication or accepted-window rule changes.
  PR run `39237311621` failed at `authenticator-factor.test.ts:86`; it did not
  record both code periods, so this reproduces a mechanism rather than proving
  that historical run's precise cause. Keep the explicit replay variant and
  investigate any recurrence with the consumed time-step evidence.

  **Stable registration enrolment clock (D530).** A previous-step code can expire
  after the fixture checks the time but before password verification and database
  work finish. A Linux probe holding the generated code across its period boundary
  reproduces activation's `permission_denied`, with the original assertions and
  30-second deadline. The successful enrolment and replay variants now use one
  schema-local PostgreSQL timestamp for verification and code generation. The
  clock sits 90 seconds ahead of real time, inside the five-minute enrolment
  lifetime, so an ordinary-clock pool or missing clock function fails reliably.
  Two additional host-clock-shift controls fail before the setup change. Every
  original assertion, accepted code offset and deadline remains; the independent
  lock-wait expiry cases still advance their verifier clock and require refusal.
  Run the registration `test/authenticator-factor.test.ts` file through the
  PostgreSQL wrapper. This repairs the fixture's timing dependency; the exact
  cause of [the historical registration activation refusal](https://github.com/waitron-io/waitron-cloud/actions/runs/41167290103/job/124437552213)
  remains unproved because that run did not capture both code periods.

  **Local registration suite lock capacity.** Running the complete registration
  suite with this Mac's default 18 test-file workers exhausted PostgreSQL's shared
  lock table (`out of shared memory`, with `max_locks_per_transaction` hints).
  That run reported 486 passes and 198 failures across 684 reported cases; two
  stalled test processes and their recorded descendant required termination.
  The wrapper then cleaned up its owned database and mail containers.
  Full local registration and account HTTP package commands now run at most two
  test files at once, keeping every discovered file and its existing deadline.
  Docker-free command probes check the bound, new-file discovery and failure
  reporting with real Node workers. A complete unsharded PostgreSQL run still
  needs qualification when local Docker returns; CI's existing database shards
  keep their own commands. Receipt fixtures compare seeded historical manifests
  with their saved test commands; existing assertions and production selection
  guards stay unchanged. The historical lock exhaustion and unidentified
  failed-setup handles remain recorded; database limits are unchanged.

  **One-second relay budget fixture.** The key-retirement and rollover tests now
  retry setup admissions at most ten times when the budget window ends before
  admission commits. They keep the one-second window and every existing assertion.
  A permanent PostgreSQL 1.1-second first-insert delay proves setup recovers only
  after the expired attempt rolls back; the complete relay-bounds file passes 34
  checks. Removing the production expiry guard in a disposable checkout fails both
  the slow-insert rollback assertion and the original rollover-refusal assertion.
  Run `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec
  node --test test/relay-bounds.test.ts` for these checks.
  The design-only [merge run 38415818412](https://github.com/waitron-io/waitron-cloud/actions/runs/38415818412)
  failed at that expiry guard during first admission. A controlled delay reproduces
  the failure, but CI did not record window timestamps, so its exact cause remains
  unproved. Production guards and timing policies are unchanged.

- **Shared UI.** The portal uses the released shared account controls. Qualify removal of Cloud's
  duplicate hover override after this package update, and read the first
  post-split weekly mutation results; see [scope and remaining work](backlog/shared-ui.md).
- **Identity and organisations.** Local signup, recovery, passkeys, authenticator
  controls, account sessions, pairing approval and encrypted transactional mail are
  implemented. Production ingress, email and key qualification, password screening
  operations, retention, platform/support permissions and legacy-account recovery
  remain open. See [requirements, remaining work and deliberate limits](backlog/identity-and-organisations.md),
  including the email-region decision and the boundaries of local browser evidence.
- **Subscriptions and billing.** Service catalogue, checkout, invoicing, permitted
  services, usage accounting, trials, failed payment and cancellation. Item 3 of
  [launch platform work](#launch-platform-work-in-priority-order); designed in
  [the billing design](superpowers/specs/2026-10-29-cloud-billing-design.md).
  The [first account-page plan](superpowers/plans/2026-11-07-billing-account-pages-first-piece.md)
  covers choosing the existing Connected trial; its build and payment-method pages remain open.
- **Venue and node registration.** The agreed Waitron signup and connection journey is
  implemented locally. Planned handover, diagnostics, retention, key provisioning
  and rotation, deployment qualification and production activation remain open;
  see [the requirements and deliberate limits](backlog/venue-registration.md).
- **Provisioning and placement.** The owner approved the
  [production deployment design](superpowers/specs/2026-10-22-cloud-production-deployment-design.md)
  for local building and rehearsal. D110's
  [P1 country-cell plan](superpowers/plans/2026-10-22-cloud-country-cell.md)
  specifies images, repository-driven Kubernetes deployment and genuine three-node
  availability checks for sign-in, remote access and backups. Full service/fault proof
  and the strict common verifier remain unbuilt. D570's
  [first-machine plan](superpowers/plans/2026-11-06-kubernetes-manual-first-run.md)
  still needs a live payload-free ARM run after the billing-response and Lambda
  reservation corrections, with named failure steps and a failed-setup retry
  only after verified removal in the original private folder,
  explained existing account charges within the unchanged monthly cap, measured
  shutdown and disk/interface absence, actual itemised billing and removal.
  Provider identity, quota, bootstrap behavior and fixed quantity/cost assumptions
  remain unqualified. The independent expiry drill, offline ARM inputs, full P1
  service/fault proof and measured build/steady/fault/verifier/healing peaks remain
  open. The observed 6.10 GiB owned-memory sample is only a lower bound; no capacity
  floor or supported Mac path changes. Weekly automation still needs scoped access
  and the later [weekly plan](superpowers/plans/2026-11-04-kubernetes-weekly-proof.md).
  No general AWS, production or schema authority follows from this first machine.
  Global account separation and the action controller have planning entries below;
  release waves, hosted venues and regional failover remain later plans.
  Country/provider/cell registry, repeatable resource
  creation, recovery from partial failures, capacity and customer movement remain open. The local
  movement state machine now reserves a destination without replacing the source, rejects
  competing/stale operations, retains durable retry results and revokes the old route only
  after the destination manifest was applied and tested. The two-cell proof preserves the
  venue's hostnames and certificate fingerprints, isolates the other venue and measures
  fresh-peer reconnections of 1,321 ms and 1,486 ms; it also proves failed-apply cancellation leaves the
  source healthy. The local DNS/certificate reconciler now preserves usable material,
  fences stale external work and republishes signed routes after restart. Repeat the full
  path with provider-native cells, live adapters and appliance configuration before
  choosing an explicit recovery-time target.
  Define how established connections and
  backups continue during a portal outage, including credential expiry and revocation.
  The [local control-plane outage drill](control-plane-outages.md) now stops the real account
  API process while a gateway HTTP route and TLS SeaweedFS transfer continue under their
  existing signed authority. It proves that cached gateway restart does not extend expiry,
  expired storage credentials are refused, recovery restores management access and a fresh
  manifest removes a revoked route. Repeat the drill with the selected deployment database,
  gateway reconciler and provider-native storage before setting an availability promise.
- **Global and country separation (P3).** The
  [revised implementation plan](superpowers/plans/2026-10-22-cloud-global-country-split.md)
  follows the owner's 24 October decisions: customer accounts, credentials, factors,
  sessions, profiles, plans, alerts, quotas and account/box recovery stay in-country,
  with one owner per customer organisation per country and no invitations or managers.
  Fresh sign-in, account recovery, new box recovery and venue services must work with
  global absent. Global keeps the separate worldwide operator console and apex routing,
  with no customer or venue copies. Country billing is recommended, not implemented or
  approved; global reporting needs a later privacy decision. This is planning only,
  pending owner PLAN re-approval after landing, then separate P3 build
  authority. Isolation, cutover and real outage acceptance remain unbuilt and unproved.
  Every migration task must reconcile reservations, including 043, and the actual
  manifest before reallocating provisional later names. P1's shared database remains
  transitional; P1 owns isolated deployment and P4 country action/approval adapters.
  Priority 5 separately designs verified owner handover and lost-owner recovery.
  Production schema, provider resources, deployment, spending and live mail retain
  their separate authority gates.
- **Repair actions and Cloud controller (P4).** The approved production design's
  action-by-action automation is described in the
  [implementation plan](superpowers/plans/2026-10-22-cloud-action-controller.md).
  This is planning only. The catalogue, durable requests, operator approvals,
  console, notifications and controller are not built. Plan approval and P1's
  country-cell build remain required before implementation; any new database
  migration must recheck active reservations and the inventory after migration 043.
  C39 supplies observations without
  granting action or activation authority. P5 release waves, P6 hosted placement
  and revised A1018 handover, P7 regional failover and all production enablement
  gates remain separate. P4's historical external-proof writer-admission tasks
  require amendment against the revised shared contract before build. No provider
  operation, spending or live mail is authorised.
- **Provider integration.** Storage, compute, email, notifications, jobs, keys and
  telemetry, with AWS and Google implementations where needed. The local SeaweedFS
  storage contract now covers venue-scoped access, live key rotation, issued-credential
  expiry, versioning, interrupted uploads and concurrent conditional create/replace.
  The [Stockholm AWS sandbox rehearsal](aws-storage-rehearsal.md) now exercises those
  storage boundaries with real assumed-role credentials, PostgreSQL-backed archive
  publication/key rotation and real Waitron/Litestream restores. New S3 buckets need
  explicit SSE-C enablement for the existing stream format. Cloud must extend its
  managed-stream credential contract to carry and renew session tokens, coordinated
  with Waitron, before using assumed roles through that adapter. Repeat the deployment
  qualification in Spain and separately for Google; production custody, credential
  delivery, web identity, retention, monitoring and activation remain open.
- **Operations.** Local status, deployment, database recovery and schema-upgrade
  rehearsals are implemented. Production deployment, provider-native recovery,
  recovery objectives, portal resilience and operator controls remain open;
  see [the requirements and deliberate limits](backlog/operations.md).
- **Self-service journeys.** Define completion and failure paths for setup, account
  and billing changes, diagnostics, restore and cancellation. Verify customers can
  complete routine flows without staff, including recovery from interrupted operations.
  Give exceptional failures useful diagnostics for investigation under the support policy.
  Account security is now self-service: the portal shows active management sessions and
  passkey last use, identifies the current session, and lets you revoke a session without
  staff access. It refreshes the list after every attempt so a lost successful reply does
  not encourage a second write. Owners can now download a versioned diagnostic for one
  installation. It reports redacted access, service, monitoring, remote-check and backup
  evidence without account, provider, hostname, configuration, credential or raw-error
  data. Stale health is shown as unknown and the permission is rechecked before release.
  If a diagnostic download fails, you see its error beside the venue you chose. Starting
  another download clears that warning; changing accounts clears its venue association.
- **Service monitoring.** Check representative operations from outside the affected
  cell; track errors, response times, queued work, backup freshness and capacity.
  Production observation, phone delivery, recovery targets and C39 plan/build approval
  remain open; see [the requirements and deliberate limits](backlog/service-monitoring.md).
- **Usage metering.** Local totals cover snapshot storage and transfer, installation
  operations, monitoring probes and administrative alerts. Native controller tests
  hold old totals, permission refusals and rate limits across account or organisation
  changes, including switching away and back and signing out. They check that old
  replies cannot replace current totals, end a pending read, publish an error or
  impose a cooldown; selecting the same account and organisation keeps its read.
  Production deployment,
  monitoring and additional service units remain open; define costs, allowances and
  outage policy before using totals for billing. See [scope and remaining work](backlog/usage-metering.md).
- **Data lifecycle.** Local backup capture, retention, verification and recovery are
  implemented; paused-parent verifier checks retain diagnostic-input ordering. Production
  custody, provider qualification, isolation and lifecycle
  policies remain open. See [the complete requirements and deliberate limits](backlog/data-lifecycle.md),
  including unresolved verifier failures, compatibility with newer Waitron releases
  and capacity qualification.


## Backup catalogue qualification

**Open.** Qualify server permissions, deployed browser integration, computer sleep
and genuine restore or recovery. Native transport and elapsed retry checks pass;
they grant no activation or stop-proof authority.
See [the remaining checks](backlog/backup-recovery-http.md#backup-catalogue-qualification).

## Monitoring shutdown fixture migration timeout (D530)

**Open.** Registration shard 1 fails during migration 013 under its unchanged
3,000 ms statement cap, before the shutdown checks run. The original failure
precedes GitHub's published 5 November Actions incident. The same-source hosted
rerun passes 343 cases; focused Debian runs pass four and 86 cases, with a
temporary probe measuring 47 applications of migration 013 at 25–30 ms. None
reproduces or repairs the failure. Preserve the cap and assertions; read
the retained `cloud-test-setup-waits` output on recurrence before choosing a fix.
See [the failure and qualification limits](backlog/worker-scheduling.md#migration-setup-timeout-remains-unexplained-d530).
PR #1042's merge additionally reports migration 024/035 setup timeouts and a
usage-worker SIGKILL on registration shard 3. The four named cases pass on the
exact merge on Debian; their hosted causes remain unproved and their limits stay.
The linked D530 bundle retains this occurrence separately from migration 013.

## Passive security-audit session timestamp check (D530)

[PR889's account HTTP job](https://github.com/waitron-io/waitron-cloud/actions/runs/41799209730/job/126471471556)
fails `security-audit.test.ts:41` because the session's last-used timestamp is one
millisecond later than its creation timestamp. The unchanged case passes in
[PR890's job](https://github.com/waitron-io/waitron-cloud/actions/runs/41800780918/job/126476006089).
A Linux probe calling `createSession` reproduces the same one-millisecond gap
before any HTTP request. Migration `002_identity.sql` gives the two columns
independent `clock_timestamp()` defaults. The test now seeds that difference
and compares activity and creation time independently before and after both
page reads. Real PostgreSQL reproduces the old one-millisecond failure and
passes both corrected cases. Four independent controls catch activity or
creation-time rewrites; every other assertion and deadline is preserved.
Production session behaviour and landed migrations are unchanged. Activity
updates delayed by sixty seconds and changes to absolute session expiry remain
outside this test's coverage, as they were before this repair.

## Service-proof failure diagnostics (D530)

The [first venue-proof attempt for PR381](https://github.com/waitron-io/waitron-cloud/actions/runs/41805521835/attempts/1)
failed after 231 seconds with only `Free-service proof failed`. Its later passing
attempt does not explain the original failure. That cause remains open.

You now get `SERVICE_PROOF_FAILURE` records from both proof matrices and the
single-suite command. An observed failure event identifies its service group,
zero-based file number, reported source line, runner failure category and an
allowlisted error code.
Match the file number against that group's file list in
`scripts/test-cloud-free-services.mjs`. Unknown codes stay unclassified; messages,
test names, paths, arbitrary assertion values and child output remain private.
The disconnect case’s fixed-message assertion exception is covered by
`node --test scripts/translation-disconnect-diagnostics.test.mjs`; its unknown
cause stays in [translation work](backlog/translation.md). A fixed-output assertion
failure retains selected backend IDs and termination results. The earlier
backend-termination assertion can still fail without those details; its recurrence
on main remains a priority in that same investigation.
Unexpected output still refuses the proof and records only its stream and file position.
The sender retains at most sixteen event records plus a truncation marker.
The command also reports its final refusal stage and allowlisted code.

Summary refusals retain safe counts and mark the event stream incomplete,
because Node can report a failed file summary before its failure event. The
proof still stops at its first refusal. Earlier output can hide a later error,
and the cap can omit a parent hook failure after many cancelled children. An
unmapped helper has an unknown position; line zero means unavailable, and a
file-level line one can be a runner placeholder. These records identify the
observed boundary, not every underlying error. Single-suite runs now also
honour the existing optional timing setting.

The receipt parent validates and forwards these records before a child refusal,
including records split across reads. Controlled real assertion, timeout, output
and CLI failures exercise reporting without issuing a receipt. A controlled
late rejection and a dirty checkout after passing cases both report their
refusal. The existing receipt checks, case counts, cleanup and time limits
remain unchanged. Historical causes and signal delivery through the parent's
330-second cutoff remain unqualified.

Repeated venue schema setup now uses the existing migrated database template.
Each test process prepares it once, and each case gets a separate clone with
every migration digest checked. The process closes its template after its cases,
and command fixtures use their clone's connection when starting another process.
The concurrent-fixture check covers a shared seed, separate rows, the complete
migration list and clone removal. A refused first setup leaves the next case
free to initialise its own template. A real child-process check verifies that
its default template disappears while another template family remains.
The traffic command reader's recorded Git object moves with its reviewed URL
change, so the local-stack package graph can still trust that reader.
Existing service, permission and traffic
assertions and all proof deadlines stay unchanged. The complete Debian run of
`node --test scripts/venue-service-proof.test.ts` retains all 360 cases across
nine groups in about 201 seconds, compared with 289 for the unchanged baseline
on the same box, within the same 330-second child limit. The Mac proof also
passes, separately from that x86 comparison. A controlled 1.5-CPU Debian
run still reaches that limit after 326 cases, compared with 94 before this change.
That constraint remains unqualified, and the historical hosted slowdown remains
unexplained.

## Bound verifier test failure cleanup (D530)

[The D462 backup job](https://github.com/waitron-io/waitron-cloud/actions/runs/41311315472/job/124862280459)
first refuses an invalid-archive verdict because child cleanup fails. Its leftover
child then causes later empty-state checks and image removal to fail. The original
Docker refusal remains unexplained; a controlled refusal reproduces this cascade.

The fixture now records each successfully created child's exact ID, image and six
request labels. After each case's assertions, it removes only a matching recorded
child and confirms absence. Changed ownership or an uncertain Docker response
refuses rescue. A failed rescue does not prevent attempts for other recorded
children. Failed records remain for later rescue attempts, so a persistent Docker
refusal or changed ownership can still make later cases fail. There is no
discovery or adoption of unrecorded containers.

Run `node --test packages/backups/test/bound-fixture-cleanup.test.ts` for the
ownership, absence, malformed-output and failed-rescue controls. With Docker,
`node --test packages/backups/test/bound-fixture-cascade.test.ts` injects a product
cleanup refusal into a private copy of the original test file. The original case
must still fail, its next case must pass, and both its recorded child and image tag
must be absent. The parent has an independent rescue if that control fails, and
retains both the original assertion and a later rescue failure. These controls
also run in ordinary package CI; the cascade control builds its own fixture image.
Every original verifier assertion, authority check and deadline remains unchanged.

On the Linux test box at `c9130ab7`, the unchanged invalid-archive case passes
once alone and in three waves of four concurrent copies (twelve more passes).
Each copy keeps the original assertions and deadlines, with its own random owner,
image tag and controller directory. Run the selected case with
`node --test --test-name-pattern='^invalid archive is a bounded verdict' packages/backups/test/bound-container-verifier.test.ts`.
This bounded concurrency probe does not reproduce the historical 20.197-second
cleanup failure or establish its cause. Keep that investigation open; do not
repeat this passing probe without a new failure or hypothesis.

The controller's existing diagnostics must identify a recurrence before you can
attribute or repair the historical Docker failure. A lost create response before
an ID is returned and a child created by a separate host remain outside this rescue.

## Bound verifier fixture build timeout (D312)

**Open.** The current image builds on the Linux test box, but the historical CI
timeout remains unexplained. Two later PostgreSQL image inspections also time out
before package tests, and a backup-worker fixture build fails at the same limit.
Inspection timeouts now retain bounded host and Docker-client diagnostics without
retrying the inspection or replacing its error. A shared cause is unproved.
See [the evidence and remaining investigation](backlog/verifier-build.md#bound-verifier-fixture-build-timeout-d312).
Keep every verifier assertion and the existing build and job limits.

PR #994 also records a separate diagnostic-fixture failure in
[general CI run 42161904817, job 127709403709](https://github.com/waitron-io/waitron-cloud/actions/runs/42161904817/job/127709403709).
The oversized-daemon inspection case reads an incomplete generated state file
at `ci-test-postgres.test.mjs:146`. The test, launcher and diagnostic source are
unchanged from its base and import no SDK. Twenty unchanged native comparisons
and one Linux comparison pass; they do not establish the historical cause.
Investigate the fixture writer and its termination boundary under D530, retaining
every diagnostic, refusal, cleanup and deadline assertion.


## Relay reservation admission timestamp (D530)

A delayed reservation-counter query could put the recorded creation time in a
later policy period than the one checked at admission. Two real PostgreSQL
controls cross a one-second period while that query waits, with monthly
allowances enabled and disabled. A reservation now records the same database
time used to check its period, grant and installation after lock waits. The
existing monthly-wait, expiry, replay, allowance and rollback assertions remain.
An independent database-time observation immediately before releasing the monthly
wait also requires a period that ends after that observation; this prevents the
shared stored timestamp from hiding a period chosen before the wait.
No landed migration or historical reservation changes.

The original failure is registration job
[127430816673](https://github.com/waitron-io/waitron-cloud/actions/runs/42079861800/job/127430816673)
on main `d108bebc39`. The controlled delay reproduces its assertion, but that
runner did not retain the two timestamps needed to prove its exact interleaving.
Run `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec
node --test test/billing-allowance-relay.test.ts test/relay-grants.test.ts`
for the admission and legacy-policy checks. Current-head CI still qualifies
landing; this repair does not close the separate migration-setup or mail failures.

A separate controlled review probe on both paths still admits when a grant expires
during the counter query, after its admission-time check. The baseline-equivalent
probe has the same outcome. This change does not move that guard; measuring time
again at a later write would need its own authority and period design. The original
CI interleaving, production-role behavior and mixed-version deployment remain
unqualified.

## Registration expiry checks during lock waits (D580)

The existing lock-observation limits still apply. A separate failure-cleanup
weakness is open: if installation lock observation times out, the test can skip
waiting for its outstanding request before the next schema reset. A controlled
stall reproduced the resulting reset deadlock on both the original and repaired
tests. Drain the outstanding request on that failure path in a follow-up, retaining
the lock limits and all authority assertions.

## Storage test socket attribution and live progress (D575)

Unexpected reservation-control binds now report the failed phase, port and
owning process before cleanup. The admin wrapper forwards each child output chunk
into its enclosing test output and retains the transcript. Node's ordered file
reporter can still delay the visible log, and hard-kill survival is unqualified.
Historical owners and a shared cause with default admin listeners remain unknown.
See [the checks and investigation limits](backlog/storage-cache-fixture.md#storage-test-socket-attribution-and-live-progress-d575).

## Storage archive download failure reporting (D441)

**Open; historical cause unknown.** Download failure reporting is implemented,
and all five native controls pass. The retained Linux cold-cache run and PR849
CI qualify an earlier baseline; the runtime has since changed. Capture the named
request and phase at a new failure before changing the single archive-download
attempt. D585 adds a 30-second header/body deadline without adding a retry.
See [the evidence and remaining work](backlog/storage-cache-fixture.md#storage-archive-download-failure-reporting-d441).

## Storage extraction seed acquisition (D530-4)

The extraction-refusal checks now report seed acquisition separately from the
storage fixture. Cold downloads allow at most three attempts for temporary
HTTP 5xx, reset connections and ten seconds without transfer progress, within
one unchanged 30-second budget. Permanent HTTP refusals and invalid digests stop
immediately. All three extraction checks, pins, cache preservation and outer
limits remain. Disk and cleanup failures have separate stages, with both errors
retained when removal also fails. The historical CI timeout has no recorded HTTP stage, so its
provider cause stays unknown. Capture a new labelled failure before attributing
it to the registry. The historical inventory names thirteen acquisition sites. Ten storage suites
and the seed-control suite now share supervision with native fixture startup,
which retains one attempt and adds a 30-second deadline. Conformance also uses
that acquisition helper while retaining three attempts, a 120-second total
budget, 30-second inactivity and its existing diagnostic and digest checks.
Caller cancellation interrupts requests and retry pauses without replacing the
cancellation reason. The image now runs the same acquisition helper before its
architecture checksum and extraction, using three temporary attempts within
30 seconds and ten-second inactivity. Full application image preparation
qualification remains open. The owner has deferred
the costed controlled-copy proposal; no mirror is built. See [the seed controls and limits](backlog/storage-cache-fixture.md#extraction-refusal-seed-acquisition-d530-4)
and [the complete inventory and proposal](backlog/storage-cache-fixture.md#every-seaweedfs-archive-fetch-and-a-controlled-copy-proposal-d530-4).

## Parallel storage-cache fixture failure on main

Native admin-port fallback and explicit HTTP refusal now have controlled checks;
see [the remaining collision boundaries](backlog/storage-cache-fixture.md).

Retain diagnostics to explain the original read-only-cache rejection; the readiness
and S3 port repairs do not establish its cause. Reproduce an admin-listener bind
failure and reserve those ports if needed, without retrying unknown ports or other
child exits. See [the investigation and remaining work](backlog/storage-cache-fixture.md).

The qualified current browser fixture and identity-port repair retain separate
historical bind and reconnect investigations. See [the D499 boundaries](backlog/storage-cache-fixture.md#current-browser-and-identity-port-qualification-d499).

## Dependency-cache miss job budgets (D507)

Healthy runs cover 67 cache-consuming jobs across all ten definitions. Each fits
its cap, but registration partition 1/6 takes 445 of 480 seconds with saving
skipped, leaving less than a full save allowance. **Open.** Qualify healthy miss
paths for the seven definitions sampled only on hits; preserve existing limits,
matrices and checks pending a separate decision.
See [the phase timings and remaining qualification](backlog/ci-cache-saving.md#healthy-run-timing-sample-6-november-2026).

## Audit fixture dependency preparation (D530)

The translation-vector audit, remote-access and portal guard fixtures copy installed
dependencies into their own checkouts and pass with an empty download cache and
an unavailable registry. Setup refusals retain a readable reason. Their original
vector, planner, mismatch, restoration and denial checks remain. See the
[nested-install investigation](backlog/ci-pnpm-setup.md#nested-package-installs-d530)
for the reproduced refusal, source isolation checks and remaining cache questions.

## CI PostgreSQL image pull

D104's documentation-only [run 39733028534](https://github.com/waitron-io/waitron-cloud/actions/runs/39733028534/job/119672295764)
failed before account HTTP shard 3 started its tests: Docker's request to
`auth.docker.io` timed out while pulling `postgres:18-alpine`. The recorded failure
is in the container-start path of `scripts/test-postgres.mjs`, before the owned
container is marked running.
This is separate from the reset-mail capture failure below. No runtime, test,
fixture, workflow or dependency change accompanied the incident, and the external
registry failure's cause remains unproved.

The test launcher now acquires both images before creating either container. It
uses cached images without registry access. For a missing image, it retries a
recognised connection failure with at most three attempts within each image's
120-second acquisition budget, including inspection and retry waits. A pull
killed at that deadline has no time left for another attempt. Access refusals and
other terminal errors stop immediately; a failed daemon inspection does not
become an image pull. Container starts disable implicit pulling and are never
retried. Package commands, assertions, readiness deadlines and owned cleanup retain
their existing behaviour. Run `node --test scripts/ci-test-postgres.test.mjs` for
the controlled launcher checks, including timeout termination, retry exhaustion,
Mailpit acquisition, command exit status and cleanup. These checks qualify local
failure handling; they do not prove Docker Hub availability or explain its outage.

The launcher also retries registry HTTP 5xx responses, including the HTTP 500
failures before package tests in [this merge run](https://github.com/waitron-io/waitron-cloud/actions/runs/40856632619).
Each failed HTTP attempt logs its status and attempt number. Both pinned images
keep the same three-attempt, 120-second acquisition limits. Controlled launcher
checks cover recovery, exhausted server responses, both retry-wait deadline
boundaries and immediate refusal of HTTP 401, 403, 404 and 429. Container creation,
image pins, cancellation and cleanup retain their existing behaviour. These
bounded retries handle registry server failures; the cause of Docker Hub's outage
remains unknown. Real Docker qualification continues in CI while local Docker is
unavailable.

The controlled checks also cover both deadline boundaries around retry waits,
a pull client that ignores graceful termination, and every recognised connection
response. Deliberate faults must make the matching checks fail. An early injected
`ETIMEDOUT` separately qualifies retry classification; a real launcher timeout
still exhausts the unchanged per-image budget. Cancellation checks cover SIGINT
and SIGTERM during successful and hanging synchronous pulls and at a retry wait.
They check the exit status, prevent the package command from starting and require
cleanup of every created container. Cancellation during a synchronous pull is deferred
until that call returns, so containers can still be created before cleanup.
A pull killed at its deadline exits with the acquisition error, rather than the
cancellation status, before creating any container.
These fake-client checks leave one question open: whether stopping the client
also stops Docker's own registry transfer. Qualify that with a real daemon and a
controlled registry when local Docker is available; do not infer it from client
termination.

## Portal reset-mail boundary reporting

**Open; the missing reset email remains unexplained.** Capture a diagnostic
recurrence before changing delivery or inbox capture, preserving the original
assertions, single lookup and deadlines. Read the [reporting boundaries and
redaction limits](backlog/mail-capture.md#portal-reset-mail-boundary-reporting).
All monitoring and signup/recovery mail lookups now include their fixture's queue,
worker and SMTP evidence, alongside the authenticator lookup. A one-off controlled
check at `e31dea70` verified every call. Three concurrent Debian 13 trials passed
all 63 checks without reproducing the mail loss. The evidence read now has one
shared second for connection acquisition and its query. Real PostgreSQL controls
cover exhausted pools, blocked outbox reads and terminated backends. Controlled
TCP peers cover a simulated stalled handshake and abrupt connection loss. A late
connection is returned without a query, and repeated misses keep at most one
connection request. The natural missing-mail cause remains open.

## Account HTTP reset-mail capture

**Open; the historical reset-mail capture failure remains unexplained.** Capture
a Linux recurrence before choosing a delivery or capture fix, preserving the
original assertions, single lookup and deadline. Read the [investigation and
bounded diagnostics](backlog/mail-capture.md#account-http-reset-mail-capture).

## Portal session test startup

**Open; historical cause unknown.** Capture a diagnostic recurrence before
attributing the initial signed-in timeout. See the [investigation and diagnostic boundaries](backlog/portal-session-startup.md).

## Recovery and remote browser waits (D530)

**Open; both historical causes remain unknown.** The two affected browser files
pass 88 unchanged Linux checks. Recovery and remote-name failures now report their
named step, bounded request progress and redacted panel state, while retaining
every original assertion and deadline. Read the [evidence and next reproduction](backlog/portal-panel-waits.md)
before attributing either timeout or repeating the passing baseline.

## Portal lost-reply test ordering

D530 records the unresolved consent-uncertainty and usage rate-limit waits from
[PR #598's CI run](https://github.com/waitron-io/waitron-cloud/actions/runs/41183089824/job/124484426019).
The usage journey now reports its named stage, static request lifecycle events
and a bounded controller snapshot when a page wait or setup step fails. Read
[the diagnostic limits and next reproduction](backlog/portal-lost-reply-ordering.md#usage-rate-limit-wait-d530)
before attributing either failure. Consent failures also report a separately bounded,
redacted [database wait snapshot](backlog/portal-lost-reply-ordering.md#consent-database-waits-d530).
All existing usage and consent assertions and deadlines remain.

**Open:** the historical reset-link, lost-reply and translation-control failures
remain unexplained. Capture a diagnostic recurrence, reproduce its named stage
and fix the proved cause while preserving every existing assertion and deadline.
See [the investigation and retained ordering controls](backlog/portal-lost-reply-ordering.md).

## Initial services and future candidates

**Open; local implementations do not approve production enablement.** Remote access
and backups are the initial paid services; other services retain their individual
design, integration and launch gates. Read the [service requirements and future
candidates](backlog/service-candidates.md) for the full table, including the owner’s
rota, comparison and supplier-service decisions.

## Items transferred from Waitron

The source is [Waitron's backlog at `830cf71fe854`](https://github.com/clintongormley/waitron/blob/830cf71fe854c7aa0b0d8c95078d3fe49ca05a10/docs/backlog.md).
Its section titled "The cloud primary" mixed cloud services with core SQLite work.
The [ownership map](documentation-ownership.md) records what remains in Waitron.

- **Waitron location removal (A1301).** Include the existing `venue.location`
  samples in both cost-test backend fixtures and the browser backend's
  `provisioned.locationId` route inputs in the Cloud integration work.
- **Cloud provisioning and trial onboarding.** Own the service that creates a
  customer's resources and supplies configuration and credentials to Waitron, plus
  the hosted trial entry path. The local integration contract is mapped and proved;
  provider provisioning, the paid lifecycle and the hosted trial remain open.
- **Cloud-only redundancy.** Implement and qualify the approved failure and recovery
  direction through P6/D115 and P7. The [reconciled Cloud hosting design](superpowers/specs/2026-10-21-cloud-hosted-venue-design.md)
  uses the owner-selected cold recovery shape and the revised A1018 controlled or
  explicit emergency handover where selected. After either takeover M2 alone handles
  AEAT, including copied and returned old originals in their generating identities;
  returning M1 transfers missing originals and all received outcomes without AEAT
  contact. The external stop-proof requirement
  is superseded; human shutdown declarations do not prove an isolated M1 stopped.
  A running follower needs separate future approval. D88's duplicate design gate
  is closed; no owner question is ready now. A1018's examples and retained defaults
  are approved at Waitron `060966c2b3e9203acf0849042814997307cae463`.
  Exact formats, compatible A947 amendments, separate A1018 build authority,
  implementation and runtime/provider qualification remain open, with P1/P3/P4,
  A951 and D101 dependencies. Reliability promises and pricing follow measurements.
  The old managed-Postgres framing
  is historical; Waitron targets SQLite and Litestream.
- **Production object-store proof.** The executable local SeaweedFS 4.47 contract admits
  exactly one writer in eight-way create-only and compare-and-swap races, refuses stale
  replacements, retains accepted versions, isolates venue credentials, revokes a rotated
  key, refuses an expired issued credential and commits no partial interrupted upload.
  A [one-day AWS Stockholm sandbox rehearsal](aws-storage-rehearsal.md) now proves
  real S3 conditional-write races, stale-write refusal, version retention, two-prefix
  isolation, role-session revocation/expiry and interrupted multipart cleanup. It
  restores an older-key retained archive through PostgreSQL-backed Cloud verification
  and Waitron, and a continuous Waitron database through Litestream. Its receipt
  records the conservative US$1.37 pretax estimate, cleanup and scheduled KMS deletion;
  charges were not read. This is no Spain-location or production-deployment claim.
  Qualify the selected Spain deployment, managed credential delivery/renewal,
  web identity and recovery journey; run a separate Google proof. The existing
  [prototype results](https://github.com/clintongormley/waitron/blob/830cf71fe854c7aa0b0d8c95078d3fe49ca05a10/docs/research/2026-09-16-sqlite-failover-prototype.md)
  concern MinIO and remain historical evidence.
- **Promoted cloud generation and current pointer.** The local proof follows a signed
  `current.json` generation through Waitron's cold restore. It does not activate the
  replacement or prove that the replacement begins streaming a new generation. Add
  that promotion proof to the production handover and activation work.
- **Remote support.** On-prem SSH support is a candidate capability requiring
  explicit customer approval for a specific server and limited period, separately
  from cloud data access. Scope the connection mechanism, server permissions, audit,
  early revocation and termination of active sessions on expiry. The
  [maintenance discussion](https://github.com/clintongormley/waitron/blob/main/docs/superpowers/specs/2026-09-11-box-maintenance-and-remote-support.md)
  remains an unapproved implementation proposal and also covers local OS maintenance.
- **Managed devices.** Android Management API enrolment is a cloud candidate.
  Device hardware, kiosk behaviour and the local operating-system image remain
  Waitron work.
- **Archive and hosting advice.** Review the cloud assumptions in Waitron's advisor
  questions and the historical storage document's section 8a before a fiscal archive
  design. Do not treat migrated legal conclusions as a current assessment.

Waitron retains the SQLite storage change, safe promotion and rejoin behaviour,
on-prem mirrors, fiscal filing recovery, offline log growth, local credentials,
box image networking and the end-to-end selling proof. These cloud entries do not
declare those core prerequisites implemented.

## Cost conformance image acquisition (D137)

The historical Docker Hub token-request timeout remains unattributed. Keep the
bounded, cache-first image acquisition and permanent-refusal checks. The D530
inventory separates launcher HTTP 500, build-metadata HTTP 502 and later Node-pull
authentication refusals; the first two already have bounded recovery on main.
The authentication cause remains open and must retain immediate refusal. Use
the authorised Linux test box for reproduction and current-head CI for landing.
The separate isolation-test Node acquisition now retries temporary HTTP 5xx and
transport failures before creating resources, within a shared 120-second
preparation budget; it retains every isolation assertion and immediate permanent
refusal. The historical provider outage remains unexplained.
All 54 unchanged pull, build and isolation-image acquisition controls pass on
macOS with replacement Docker commands. The 5 November Debian test-box check
also passes all 104 launcher and acquisition controls and all 29 real-Docker
isolation and source-copy cases. A live pinned Node pull and fixture build
succeed using cached images or layers; the owned fixture image and scratch
directory are collected. This qualifies the current recovery paths, not an
empty image cache or the historical authentication and provider failures.
See the
[image acquisition detail](backlog/cost-image-acquisition.md).

A later [Linux CI pull](https://github.com/waitron-io/waitron-cloud/actions/runs/40984997048/job/123833975271)
of `node:26.11.1-slim` refused authentication before any browser case started.
The registry or runner-credential cause is unknown. Capture the registry challenge
and credential selection during a controlled reproduction, preserving the rule
that authentication refusals stop immediately.

### Installation renewal accepted during owner revocation

A controlled Linux scheduler pause reproduces the accepted renewal after an
observed revocation wait. The test now queues renewal behind revocation before
releasing the held installation. Existing security checks and deadlines remain;
production locking is unchanged. The historical scheduling was not captured.
See [the reproduction and qualification](backlog/installation-renewal-revocation.md).

### Interrupted source-fetch fixture state (D530)

**Interrupted writes reproduced and handled; historical timing remains unknown.**
[D349's CI run](https://github.com/waitron-io/waitron-cloud/actions/runs/41169033630/job/124443297790)
failed to read an empty generated JSON state file while checking the historical browser
revision. A controlled interruption reproduces that read failure by stopping the
fixture's Git helper between truncation and writing. The helper now writes a
temporary file and renames it into place, so you retain the last complete state
when the supervisor kills a fetch. The new case still requires revision refusal,
one bounded retry and collection of both fetch children. All original assertions,
source pins, deadlines and cleanup checks remain unchanged. The historical run
did not capture the write boundary or explain the helper's delay; those details
remain unknown. A separate control kills the supervisor while its helper is
paused; fixture cleanup records that helper's PID independently and waits for
it to exit, so a failing supervisor cannot leave the test process behind.

### Litestream LIST-response interruption (D352 qualification)

[Cost run40546771851, job122339634344](https://github.com/waitron-io/waitron-cloud/actions/runs/40546771851/job/122339634344)
refused the transport body-accounting case after10.20seconds. At stop/idle, a
response listing storage objects closed prematurely after headers; the native
process exited0 but the audit remained unfinished. Retain the parsed diagnostic
with the [Litestream shutdown investigation](backlog/cost-stack-replication.md).
The cause is unknown. Keep all accounting guards and deadlines unchanged.
A later [qualification run41183089824, job124484426019](https://github.com/waitron-io/waitron-cloud/actions/runs/41183089824/job/124484426019)
failed two unchanged portal cases: translation consent waited five seconds for
its uncertain-write message at `translation-consent-browser.test.ts:76`, and
usage waited four seconds for its rate-limit state at
`usage-read-message-browser.test.ts:46`. The consent trace ends with an activity
request and consent write received by the server, without their finish events.
The usage failure has no equivalent request trace. Both focused cases passed
on the Linux test box (eight checks); the usage case also passed natively
(seven checks). None of eight recent failed main runs contained these exact
failures. D530 retains the historical failures. Fresh current-head CI qualifies this
separate clock change; a passing retest does not establish the cause of those
timeouts or the storage interruption. Keep every assertion and deadline.

### Storage startup retry notice can replace the original refusal (D530)

**Fixed by D526; the throwing notice preserves the permitted retry.**
[PR788 root shard 2](https://github.com/waitron-io/waitron-cloud/actions/runs/41164895176/job/124430391561)
reached the port-handoff retry notice in `startBackupStorage`, where a throwing
reporter replaced the expected readiness error. A controlled wrapper probe
isolated that defect; D526's native S3 port collision reproduces it and verifies
the fix. The fixture contains the reporting failure, completes the one permitted
restart and preserves the final readiness error. Original-error identity,
bounded reporting, request budgets and every child's cleanup remain checked.
The separate historical provisioning timeout and Linux internal error remain
open under the [readiness investigation](backlog/storage-authority-timeout.md).

### Conformance image acquisition during D135 qualification

**Open; the registry timeout and metadata HTTP 502 remain unexplained.** Fixture
builds now handle Docker Hub metadata HTTP 5xx within the original build budget,
with native controls for bounded retries, permanent refusals and cleanup. D135
still needs fresh Docker-backed qualification on the acquisition repair. A bounded
2026-11-04 attempt passed all 39 native acquisition and build controls; the test
box was occupied, so real preparation did not run. The historical causes remain
open; see the
[image acquisition investigation](backlog/cost-conformance-fixtures.md#conformance-image-acquisition-during-d135-qualification).

### Litestream conformance transport-close refusal (D141)

**Open; the historical close refusal and later result-assembly failures remain
unexplained.** Meter snapshot refusals now identify the failed check and first
invalidation boundary without exposing request details. D513's historical failure
is the body-byte comparison, not the storage-lifetime comparison named in the
initial inventory. The unchanged body-byte case passes on the Linux test box;
this does not identify or repair the old refusal. D513 and G474 still need causal
attribution, preserving redaction, cleanup, accounting and deadlines; see the
[transport and result diagnostics](backlog/cost-conformance-fixtures.md#litestream-conformance-transport-close-refusal-d141).

## Cloud cost Mailpit fixture startup

[Merge CI run 40000552513](https://github.com/waitron-io/waitron-cloud/actions/runs/40000552513)
on `57bc23ad6f61d67c66ae43ec123d5232a4c05f28`, stack-conformance shard 3,
job 120575313226, fails
`generatedServiceKeepsItsMutableFilesOffTheScannedHostTree_mailpit` after 4.17 s.
It stops at fixture startup (`stack-conformance.test.mjs:762`), before the mail,
storage and host-file assertions. `scripts/cloud-cost/local.mjs` at that revision replaced the
underlying startup error with `Invalid cloud cost local run`; the historical cause
remains unknown.
Both files have the same Git blobs as the preceding main `917e586`, and the
identical candidate tree passed exact-head cost run 39999259906. That comparison
does not explain the failure or prove a fix. This is a different case from D141's
storage-lifetime close refusal. Startup now emits `stack_startup=` before cleanup and attaches the same bounded
record to its rejection. It names ownership, plan, configuration, runtime files,
certificate, resource discovery, Compose, container policy, isolation, readiness
or cancellation handoff. Only fixed error categories, exit codes, signals and
elapsed time are retained; paths, credentials and raw subprocess output are
excluded. Cancelled requests and expired deadlines have separate categories.
Opaque thrown values also fall back to a fixed category so inspecting them cannot
prevent cleanup. A cleanup failure gets a separate record and cannot replace the original
startup refusal. Reporting failure cannot prevent cleanup.

Docker-free tests run the actual orchestration, ownership checks, files and
OpenSSL with a controlled Docker-command boundary. They inject a fault at each
stage, command timeouts and missing executables, unknown private errors, cleanup
failure and reporting failure, with a successful start/cleanup control. These
prove diagnostic handling, not the historical Linux cause. Qualify the genuine
Mailpit journey on the changed Linux CI head; a passing run alone does not explain
the earlier refusal. On a diagnostic recurrence, reproduce the named cause and
fix it test-first.
Preserve every isolation, storage, accounting and cleanup assertion and deadline.
Use GitHub CI while local Docker is down; do not rerun the unchanged merge for a
passing result. The exact job log and source-identity receipt are retained in lane
G's `receipts/d142/`.

## Cost-stack replication interruption (D152)

**Open; historical interruption causes and production shutdown qualification
remain unresolved.** Read the [replication and shutdown investigations](backlog/cost-stack-replication.md)
for retained limits, diagnostic findings and remaining reproduction work. Local
Docker proof waits for Docker to return; reproduce each new diagnostic recurrence
before changing transport, accounting or cleanup.
The D325 stop diagnostic now distinguishes child exit code and signal from an
invalid request audit, retains the first failed audit stage and identifies an
interrupted producer attempt. Premature-close response-pipeline refusals now
retain body counts, expected lengths and request/response completion flags. Real HTTP controls
reproduce a complete upstream LIST followed by a downstream close, including
equal producer/observer byte totals but different outcomes. The session remains
refused before and after a validated stop acknowledgement. These controlled
exchanges do not establish the historical cancellation cause or change which
shutdown evidence is accepted. Stop refusals after a validated acknowledgement also retain up to sixteen active
transfer snapshots from immediately before the signal helper, with the total
pending count and a truncation flag. A failed diagnostic read leaves an
unavailable marker and shutdown continues. A generated writer with a real HTTP
socket proves that this earlier snapshot survives cancellation and writer exit;
it does not identify the native writer's historical request. The historical stop/exit cause still needs a
labelled recurrence; see the linked investigation before changing the stop rule.
Five controlled Linux triples with the official writer show that a valid database
stop and one completed LIST do not stop later retention LISTs. Waiting through
the observed last retention level avoids cancellation in that toy setup. This
does not reproduce the historical premature-close code or qualify a production
drain method; retain the existing acceptance guard.
The delayed-PUT fixture also records up to sixteen uploads on a stop refusal,
including which upload released readiness and their arrival, backend-response and
reply-forwarding times relative to stop. Its readiness gate now requires a
transaction newer than every known pre-sale upload, including pending ones,
refuses multipart parts, and waits for older post-sale replies already admitted
when the new response arrives, while the new reply remains held. Native HTTP controls
catch the earlier admission-only gate and the missing settlement order. Use the
records to investigate the remaining historical idle timeout; this fixture change
does not qualify production shutdown.


## Initial upload admitted after stop (D393)

[PR635's merge cost run](https://github.com/waitron-io/waitron-cloud/actions/runs/40634308325/job/122638015466)
refused an initial PUT after a validated stop reply, with writer exit zero.
A controlled macOS reproduction uses the checksum-verified official 0.5.17
binary and a toy SQLite database with two rows. A loopback relay holds a snapshot
upload before the measuring transport receives it. The runtime confirms stop
while that upload remains held; forwarding it then reproduces the same
`after-stop-admission / post-stop-operation / put / initial` refusal.
A private macOS stack identifies that controlled upload as `DB.Snapshot` under
`Store.monitorCompactionLevel`. Completing it before stop passes the macOS paired case.

The official Linux x86-64 release now reproduces that admission refusal on the
authorised test box with the same two-row, loopback-storage probe and current
Cloud modules. Its archive matches the pinned SHA-256
`cfb371176d164437ae869f8351cfde49bd1804ae71c61923f75c9cba9c9c006d`.
At stop confirmation, the measuring transport has zero pending exchanges and
sixteen completed ones. Forwarding the held initial PUT afterward refuses
measurement despite the writer's zero exit code. This establishes the mechanism
on Linux; it does not identify the upload in the historical CI failure or its native task.

The original Linux completed-upload control also refuses: a different LIST is
active at stop confirmation, and signalling the writer is followed by
`client-error / ECONNRESET`. A disposable control that waits for the transport to
be idle before signalling passes with eighteen reconciled exchanges and no
shutdown allowance used. That single controlled ordering result does not prove
that all native background work has drained or qualify a production stop change.
The failed original control remains part of the evidence.

With the snapshot barrier, the genuine PostgreSQL/SeaweedFS request-log case
passes on the box: both sales restore, nineteen replication exchanges and
thirty-three restore exchanges reconcile, and no shutdown allowance is used.
This confirms preparation for that workload. The historical late-admission and
active-LIST controls above still leave production shutdown qualification open.

You cannot infer first HTTP admission from the earlier SDK request log, an idle
transfer count or a zero writer exit. Run `node --test
scripts/cloud-cost/litestream-pre-admission-put.test.mjs` for the two real HTTP
ordering controls. Removing the admission guard makes the late upload return
200 instead of the required 400; restoring it passes both checks. Original
assertions, accounting, pins, allowances and deadlines remain unchanged.
D530 retains the historical cause and production shutdown qualification as open.
Do not delay production stop or admit late uploads on the strength of these probes.

The native admin-port qualification also encounters an
[initial PUT after stop](https://github.com/waitron-io/waitron-cloud/actions/runs/41037164023/job/124000805980).
Its admin checks pass on Linux; the upload's underlying cause remains unproved.

## Held-list control failure ordering (D391)

The official held-metadata control failed in [PR633's merge cost run](https://github.com/waitron-io/waitron-cloud/actions/runs/40631222000/job/122627856885)
on its first LIST attempt. The transport reported an interrupted response while
the storage observer reported success. Matching byte totals and a zero writer exit
do not explain or permit that refusal.

Failure-only fixture records now distinguish the initial, held retention and other
LISTs. You can compare arrival, forwarding, response and per-counter settlement
order with the stop request, reply, validated acknowledgement, release and signal.
The record holds at most sixteen LISTs, marks truncation, omits private request
identities and freezes before cleanup. Native HTTP/process controls cover ordering,
invalid replies, truncation and an actual pre-acknowledgement interruption. That
controlled partial response remains refused at a different boundary from the
historical Linux event. It records the producer's interrupted response while the
storage observer is still pending, so it does not qualify the historical pair of
producer interruption and observer success or identify that event's cause. The official
0.5.17 binary, allowance, both counters, assertions and deadlines remain unchanged.

The unchanged genuine held-metadata case now passes on the authorised Linux test
box with the official 0.5.17 writer. All four SDK requests match storage requests,
but one permitted late LIST is interrupted: the first counter records a transport
error while storage records success. Body counts differ by 213 bytes, and cost
accuracy remains incomplete under the existing after-stop allowance.

This passes
the case's request-count checks; it does not reproduce the historical initial LIST
failure or establish its cause. The historical log does not record acknowledgement
timing. Run
`node scripts/cloud-cost/conformance.mjs --only stack-conformance.test.mjs --pattern
'^genuinePinnedLitestreamCountsHeldMetadataAfterValidatedRuntimeStop$'` on the test
box. All six native ordering and diagnostic controls also pass.

Use a labelled
recurrence to establish the historical cause before changing any shutdown rule.

## Recovery deployment qualification

**Open.** Qualify server permissions and genuine restore or recovery; these client
checks grant no activation authority or proof that the old server has stopped.
See [the native recovery boundaries](backlog/backup-recovery-http.md#recovery-deployment-qualification).

## Public browser and network qualification

Qualify the public browser check against the supported browsers and production
networks before public exposure. Local HTTP, script and Chromium checks do not
discharge that deployment gate.

## Public gateway deployment qualification (D191)

The [limits guide](local-remote-access.md#measure-shared-public-traffic-limits)
documents the implemented source policy and its native checks. Its 2026-09-30
receipt remains a historical measurement, not deployment qualification.

Before public deployment, qualify fairness for customers sharing IPv4 addresses
or IPv6 networks, including IPv4-to-IPv6 translation. Many distinct networks can
still exhaust all 4,096 source buckets and refuse new callers until expiry. Choose
and test admission under that pressure. Per-venue fairness, coordinated
limits across gateways and HAProxy connection-table pressure remain open. Verify
IPv6 connection accounting with HAProxy's configured `stick-table type ip`; native
gate checks do not qualify that separate layer.


## Storage-authority request timeout evidence (D212)

**Historical cause unknown.** A later Linux run of the same case reports a
startup `InternalError` before authority opening. The fixture now retains the last
readiness request, attempt and request counts, and prints them when attempts run
out, without changing its retry budget. D526 reproduces a separate test-count
failure after a port collision: five abandoned-client requests plus 120 final-client
requests fail the test's aggregate 120 assertion. The final diagnostic correctly
reports 120. The owner-approved correction checks each client separately,
requires all 120 requests on the final client and verifies every child stops.
A permanent native collision control also reproduces a throwing retry logger
replacing the readiness error. Logging now preserves the permitted retry and
the final SDK error; request budgets and retry limits are unchanged.
All four unchanged authority cases pass on the Linux test box, including delayed
identity publication in 5.01 seconds. The test and operation-label helper match
the later failing revision; its runtime and dependencies differ. An isolated
checkout of that exact historical revision with its frozen dependencies also
passes all four cases. Neither run reproduces the failures or recreates the
original CI job's concurrency. The authority, fixture, diagnostic tests and
dependency lock still match the earlier Linux check and current main. This
preserves that result's scope without explaining either historical failure.
Use the next labelled recurrence to find the cause, preserving the existing
assertions and deadlines. See the
[investigation and qualification limits](backlog/storage-authority-timeout.md).


## Paced replay deletion recurrence (D351 qualification)

[Cost run 40541558126, job 122321994540](https://github.com/waitron-io/waitron-cloud/actions/runs/40541558126/job/122321994540)
records another `storage-cleanup` / `delete-object` refusal, after 75.35 seconds,
following native restore and validation. Retain it with the D344 qualification
trace below and lane D's D121 investigation. The deletion cause remains unknown;
source equality with the parent does not establish independence. Keep ownership,
accounting, cleanup and deadlines unchanged; genuine reproduction needs Docker.

## Paced replay object deletion refusal (D344 qualification)

The passkey keyboard qualification run also captured a paced-replay refusal at
`storage-cleanup` / `delete-object`, after native restore, file, integrity, sales
and accounting stages. The failure is in
[run 40516366868, job 122231317704](https://github.com/waitron-io/waitron-cloud/actions/runs/40516366868/job/122231317704)
at `c1c2ea77e2005e2e88c6a8da9a5b989782d55d82`; the case refused after 75.33 seconds.
The branch changes no cost-runner code. This labels the refused operation but
does not identify its cause. Resume D121 with this trace and reproduce the
deletion refusal without changing ownership, accounting, cleanup or deadlines.
Genuine local reproduction waits for Docker to return; a later passing run does
not establish a repair.

## Passkey keyboard browser handler observation (D373)

The keyboard fixture waits for its options handler before checking the exact
password and pending controls. The waiter has its own four-second limit, matching
the page timeout. Original journeys remain alongside delayed-handler and
missing-record controls.

Historical qualification recorded a [gateway reconnect refusal](https://github.com/waitron-io/waitron-cloud/actions/runs/40597914600/job/122518692085):
the session was accepted but the request check failed. Its cause remains unknown;
lane D's D201 owns the investigation. Keep the accounting checks and deadlines.
The owner's test box now provides focused Docker reproduction. Fresh qualification
does not identify the historical cause.

## A way forward after every refusal (D254)

The [self-service refusal audit](refusal-self-service-audit.md) traces current
English/Spanish portal messages, public pages and account emails to their server
causes. Native probes confirm 50 client refusal mappings and 34 rendered emails
and HTTP pages. Database causes are source evidence, not local runtime proof.
No current customer message asks you to contact Cloud support, and no shared
refusal code is classified as possible only through a product bug.

Cloud follow-ups, each a separate small change with tests before implementation:

- R1 delivered: refused authenticator management requests offer Check authenticator
  settings in English and Spanish. The read-only refresh discards the old local
  setup and inputs, reads current status and requires fresh password/codes before
  another change. General 400 responses retain general feedback, without blaming
  a code field or claiming a specific cause. Server responses, proof checks and
  uncertain-write reconciliation remain unchanged. Native and stubbed-browser
  checks cover stale setup, changed status and restart; database qualification
  runs in CI. The audit records each server cause and the remaining shared-code limit.
- R2 delivered: refused passkey registration and removal requests offer Check
  passkeys in English and Spanish. The read-only action clears the old password
  and refreshes your account's list before you start a fresh prompt or removal.
  The shared 400 response gives general guidance, including choosing another
  passkey if already registered; it does not identify expiry, duplication or a
  verification failure. Password sign-in, credential feedback, rate waits and
  uncertain-write reconciliation remain available. Native and stubbed-browser
  checks cover the path; database and HTTP qualification runs in CI. The browser
  checks wait until the list handler counts the refresh before asserting its count,
  while holding the reply. The handler-count wait has a separate four-second
  timeout. Its bypass control requires refusal before a separate five-second timer
  finishes; it does not pin the exact four-second setting. All original journeys
  and assertions remain; concurrent background list reads remain unqualified.
  Generic passkey failures now give neutral English/Spanish feedback with the
  existing password sign-in as an alternative. Browser checks exercise a refused
  prompt and unavailable options, a second refused passkey attempt, a rejected
  password then successful password sign-in, and a failed list read followed by
  a successful retry. They use synthetic
  HTTP responses; real credential and database checks remain in CI. The shared
  message cannot diagnose browser restrictions, configuration or transport faults.
  These failure checks explicitly provide a simulated passkey device; a paired
  native check records whether the machine can begin without it.
  Request-body limits/formats/interruption still need cause-specific feedback.
  An earlier [reconnect check](https://github.com/waitron-io/waitron-cloud/actions/runs/40246747289/job/121329853937)
  refused with an accepted session and no page or relay error. Its historical
  cause remains unknown and belongs to the shared CI-failure investigation;
  a successful requalification does not establish a repair of that cause.
- R3 delivered: recovery approval and replacement refusals now distinguish missing
  confirmations, unverified or incompatible sources, reused replacement keys,
  another open recovery, changed request bindings and missing approval in English
  and Spanish. Check request status reads the existing request without repeating
  a write; refreshing snapshots and choosing a different source still requires
  both confirmations. Replacement conflicts first ask you to check for completed
  replacement; source refusals point to setup requirements without assuming the
  snapshot is at fault or that verification guarantees compatibility. An unapproved
  request can be left to expire. Another open
  recovery must be closed through its original link if it is no longer needed;
  this page does not list or close another request. Unknown replies and transport
  failures retain read-after-uncertain-write reconciliation. Native API/controller
  and stubbed-browser checks cover these paths; real database authority, locking
  and compatibility checks run in CI. Finding another request without its original
  link, displaying source compatibility before approval, and fresh replacement
  setup remain follow-ups in their owning Cloud/Waitron surfaces. No recovery,
  permission, proof or single-writer rule changes.
- R4: recovery now explains a refused test-only action in English and Spanish.
  Open a new recovery link from the replacement server’s setup, then choose a test venue;
  production recovery remains unavailable. Native API/controller and browser
  checks cover the 403 restriction, cleared authority, retained permission errors
  and uncertain-write reconciliation. Server scope and proof requirements stay
  unchanged; PostgreSQL scope checks run in CI.
- R5 venue panels now distinguish denied permission from request verification.
  Installations, snapshots, diagnostics, usage, remote setup and translation consent
  ask you to check your account, organisation and venue. Both languages offer Account
  overview without reloading and Sign out beside the refusal, with retry if sign-out
  fails. Native HTTP/controller and two-venue browser checks cover six reachable
  panels, heading focus and cleared private state; real database/locking checks run
  in CI. Existing permission conditions remain; specific remote refusals get a
  fresh session and ownership check before their cause is returned. Shared
  backup/installation reads on recovery/fiscal pages inherit the wording; their
  request-specific guidance stays in R3/R6/R7. Pairing keeps its existing guidance.
  Remote setup now explains a missing paid trial plan, missing gateway setup,
  a production venue outside the test-only trial and stopped installation access
  in English and Spanish. Account overview and a read-only installation refresh
  give you current context; plan changes, gateway provisioning and restoring stopped
  access are unavailable here. Shared callers keep `permission_denied`; Account
  exposes only a known refusal cause after its ownership check. Native SQL-boundary,
  API/controller and browser checks cover the mapping; real database and late-DNS
  rechecks run in CI. Customer plan/setup/restart controls and membership changes
  still need real product paths and remain open.
- R6: make outside fiscal-custodian, entitlement and identity-space guidance usable;
  record missing provisioning paths without changing fiscal authority or history.
- R7: distinguish temporary fiscal continuity access from missing configuration,
  uncertain history and allocation contention; retain original-request inspection.
- R8 delivered: the no-eligible-business message explains the existing sign-out
  and owning-account sign-in path in English and Spanish. Stubbed-browser checks
  cover the same-page account switch, retained connection request and recoverable
  sign-out failure. Reloading loses the in-memory request; reopen the connection
  link from Waitron. Preserving it across reloads and same-account membership/business
  creation remain separate missing capabilities.
- R9 private forwarding diagnostics now appear in Account for the current owner.
  The [approved plan](superpowers/plans/2026-10-26-private-forwarding-causes.md)
  keeps five fixed failure categories, separate success and unknown states,
  five-minute visibility and 30-second batching. Visitors retain neutral bilingual
  guidance with no upstream details. Refresh reads stored evidence without probing
  or repairing; Account clears it on expiry and navigation. Gateway/collector
  container mounts, primary-only reads and P1/P3 backup integration still need
  deployment qualification. Reporting stays disabled in deployments. See the
  [collection and Account guide](local-monitoring.md#private-gateway-forwarding-collection).
  The invalid equal-timestamp fixture uses one captured observation; its owning
  refusal test advances the clock on every read so a tick cannot make it valid.
  Client validation and the guard-deletion checks retain their assertions.
- R10 delivered: direct navigation to rejected public requests receives bilingual
  guidance for 421/429/413/404/405/400 and failed-proof 403. Background refusals stay
  empty; host, proof, quota, size and forwarding checks retain their status codes.
  Unmatched hosts receive no retry link. The worker reports exhaustion after its
  20-second search budget; the page stops stalled challenge, worker or proof
  requests after 30 seconds, terminates the worker and ignores late results.
  Unsupported/blocked workers offer another-browser and JavaScript guidance;
  disabled JavaScript gets a static explanation. Native HTTP, executed scripts
  and browser checks cover these outcomes. A failed page attempt ignores late
  replies and does not redirect; proof and access remain server decisions.
  If the browser-check script cannot load or JavaScript is disabled, bilingual
  guidance stays visible below the heading. It disappears when the script starts
  and reveals the waiting line, so a failed download does not leave you without
  a next step. Native Chromium checks cover failed, disconnected and delayed
  script downloads, recovery on reload, disabled JavaScript and later retry
  feedback in both languages, themes and phone/desktop widths. Other browser
  engines, screen readers and production timing remain unqualified. A new script
  can still start on the previous page markup during a rollout. The fallback
  offers Reload page / Volver a cargar as an ordinary link to the same public page.
  Pointer and keyboard checks cover restarting after a failed script download;
  without JavaScript, the link returns to the static guidance. Reloading repeats
  the browser check and does not grant access. A script from before fallback hiding was introduced may
  leave the guidance visible during a mixed rollout. If a running check fails,
  the Reload page link reappears beside the existing failure-specific message.
  With matching page and script versions, static download/disabled-JavaScript
  advice stays hidden after startup, so a failed request offers reload guidance
  while blocked/unfinished checks keep their browser guidance. Mixed versions can
  keep the previous advice until reload. Chromium checks cover both languages,
  themes and widths; this wording does not diagnose why a request or check failed.
  Pointer and keyboard
  checks cover restarting after challenge, worker, proof and timeout failures,
  with no automatic retry or granted access; the new attempt hides the fallback
  while it runs. The older-page
  browser fixture now serves the exact shipped HTML from before the static
  fallback, with a pinned digest independent of current page generation. Its
  existing waiting, bilingual failure, no-forwarding and no-cookie checks run
  against the current script. Native Chromium also completes the real worker and
  proof exchange on that historical page, then opens the local HTTPS venue response.
  Both languages, themes and widths retain zero cookies and upstream requests before
  proof, followed by the scoped access cookie and one forwarded request. Other
  historical versions, browser engines and production networks remain unqualified.
  In the reverse rollout pairing, the shipped older script also runs on the
  current page: after a failed challenge, Reload page restarts the real worker
  and proof exchange before opening the local HTTPS venue response. Chromium
  checks cover both languages, themes and widths, with no cookie or forwarding
  before proof. The older script leaves the current static advice and reload
  link visible while checking; these tests preserve that known mixed-version limit.
  The browser-check page groups its heading, waiting or failure message and
  reload guidance in one main content region. Native Chromium checks cover
  disabled JavaScript, a failed script download and a running check that fails,
  in both languages, themes and widths. Automated landmark checks run with
  JavaScript enabled. The waiting message and later failure share a status
  region so assistive software can observe the change without moving your focus.
  Chromium exposes a polite, whole-message region while waiting; the failure
  message replaces its contents in place. Checks cover challenge and worker
  failures in both languages, themes and widths. The reload link returns after
  failure and access still requires proof. Actual screen-reader announcements,
  other engines and production networks remain unqualified.
- R11 delivered: public/staff alerts in Account and email name the existing remote
  setup and refresh controls in English and Spanish. Failed checks ask you to
  check venue internet, the selected hostname and setup status. Unknown monitoring
  asks you to look for new observations without declaring an outage; certificate
  warnings retain their separate dates and can accompany a passing route check.
  Native mail and stubbed-browser checks cover the guidance, read-only setup/status
  requests and later healthy evidence. The local monitoring guide explains the
  checks and their limits; refreshing neither starts a probe nor repairs a route.
  Gateway assignment, renewal configuration and certificate installation remain
  operator tooling. Owner-facing repair controls, appliance certificate delivery
  and live provider activation remain unfinished. No monitoring, certificate,
  gateway, permission or delivery rule changes. Real database/gateway qualification
  remains in CI and the Docker-based local proof.

Authentication, recovery, tenant permissions and fiscal changes keep their full
review and owner gates. This audit does not enable services or change policy.

## Remote hostname save qualification

**Open.** Qualify live DNS and certificate issuance, browser integration and deployment.
The Route 53 challenge adapter now plugs into the existing reconciler and staff
exchange. It writes only challenge TXT records below its configured suffix, waits
for propagation and deletes the exact issued value. Native checks exercise the
real AWS client against a local HTTP boundary, including scope refusal, pending
propagation, provider refusal and cleanup after a newer challenge. Production
installation refusal remains in place. The single-suffix trial has completed
staging and real issuance, trusted browser password sign-in from outside the home
network, and automatic app and tunnel restart. Reboot, renewal, revocation,
offline sales and connected-machine isolation still need joint qualification.
Cross-suffix moves also need qualification here: the retained staff hostname and
the destination-derived challenge name currently differ. Keep that production
renewal and routing gate open; the single-suffix test does not discharge it.
The existing signed certificate status action also discovers the stored request
when its ID is lost, including stale configuration needed to replace it. This
metadata read retains installation, lease, plan and test-environment checks;
known-ID status and submit replies keep their existing contract.
Native save and read-back checks pass; permission and retry rules remain in force.
See [the remaining checks](backlog/remote-access-http.md#remote-hostname-save-qualification).

## Remote status and DNS-preview deployment qualification

**Open.** Qualify live DNS, certificate issuance, browser integration and deployment;
retain the existing permission and retry rules.
See [the native read boundaries](backlog/remote-access-http.md#remote-status-and-dns-preview-deployment-qualification).

## Isolated replay ownership-loss fixture

An earlier remote-guidance qualification failed in
`isolatedControllerNeverClaimsCleanupAfterLosingItsOwnership`: the fixture did not
observe the replay worker's started journal state (conformance run 40265731418,
job 121387722438). The cause remains unknown and belongs to D530's investigation.
Keep the ownership assertion, deadlines, resource collection and refusal to claim
cleanup after ownership loss. Qualify any repair with the genuine runtime fixture;
a passing remote-guidance qualification does not establish a repair.
