# Translate all: approved design, implementation still open

The [Cloud design](../superpowers/specs/2026-10-14-translate-all-design.md) and
[24-task plan](../superpowers/plans/2026-10-14-translate-all.md) are owner-approved. Design is
complete for the agreed translation flow: signed background jobs, missing-name suggestions,
language-neutral first/review passes, consent, usage and retention. The owner approved the
temporary **US$5 per venue per calendar month (UTC)** safety cap and submit admission of
**4 in flight, at most 1 per client address**, outside other account requests' shared places.
Task 1 now provides UTF-8 job fingerprints, the four signed translation action names and
deterministic shared signing vectors published in the canonical contract. Focused checks cover
changed bytes, malformed fingerprints, the 1 MiB bound and action/signature separation.
Task 2 adds append-only migration 039 for jobs, separately retained bodies, consent history,
prices and the spending policy. PostgreSQL checks constrain job bounds, reasons, one open job
per venue and repeat operations. A composite foreign key also binds each job to its
installation’s own venue. Usage metering accepts four translation quantities with
per-job replay checks and keeps its existing accounting guards. The service name is allowed
in the schema. Task 17 adds its ready row to existing, newly registered and replacement installations.
Historical receipt-selector fixtures use their saved migration module and directory membership,
so new migrations still exercise the original omission and refusal assertions. Production receipt
audits remain unchanged and retain work for the new schema.
Task 3 adds transaction-scoped venue locking, repeat-submit lookup, exact integer UTC-month
spending checks, installation-scoped job reads and release. Collection reconstructs filtered
submit order from retained outcomes and measures complete compact UTF-8 pages, including the
actual continuation, against the 16 MiB limit. PostgreSQL tests cover concurrent submits,
rollback, repeated collection, release locking and a multi-page walk; serializer tests cover
exact byte boundaries, Unicode and complete outcomes. These foundations are consumed by the signed translation
routes described below.
Task 4 adds the contract parser and family/category batch planner. Offline checks cover exact
field shapes, language and text bounds, the 1,000-item boundary, context-only heads, all nine
name kinds and house-style examples. Batches keep families whole, including context heads and
families larger than 90 items; small categories stay together. Batch order does not change the
collect contract’s filtered submit order.
Task 5 adds the country and language templates, house-style and family context, first-pass
reply checks and review merging. Offline checks pin both approved templates and cover missing
and duplicate outcomes, name and correction bounds, placeholders, context omission and review
changes limited to missing names. Malformed review entries are dropped and counted without
interrupting valid changes. Venue-entered names remain unchanged; spelling corrections stay
suggestions. These are offline checks, not a measurement of translation quality.
Task 6 adds the OpenAI Responses client and a local fake provider. Real HTTP checks cover the
pinned model and effort, `store: false`, redirects refused, timeout and caller cancellation,
4 MiB response sizing, token validation, retry hints and sanitized errors. Valid token counts
survive unusable replies so spending checks can account for them. HTTP errors are classified
before their bodies are read, so an oversized refusal cannot become retryable. The fake provider
accepts the actual assembled first-pass and review prompts. Retry hints reject malformed dates;
base URLs reject even empty query and fragment delimiters. Connection-close checks protect
both response cancellation paths, and real HTTP checks pin the default byte limit. No real provider request or quality
measurement is part of these checks.

Run `node --test packages/translation/test/openai-client-compressed-integrity.test.ts`
to exercise complete decoded JSON arriving before a delayed gzip or deflate
checksum. Text and usage stay withheld until the stream finishes. A valid checksum
admits the exact reply; a corrupt checksum returns a sanitized network error with
no usage or automatic retry. A later call through the same client still succeeds.
These local checks do not qualify a real provider or enable production traffic.

Task 7 adds the two-pass batch runner. Loopback HTTP checks cover four calls per pass,
2/8/30-second backoff or bounded provider hints, refusal handling and review fallback.
Every billed reply reaches the spending callback, including unusable text and incomplete
responses; every attempt reaches the lease callback once. The cap is checked before each call.
Shutdown during either pass, a callback or retry waiting returns an abort without a batch
result. Storage and lease callback failures escape without repeating paid work. These
callbacks now reach the durable worker in Task 8. If spending and lease renewal both fail,
an aggregate error retains both failures without retrying the paid call; Task 18 still needs
to qualify retention and its command diagnostics.

Task 8 adds the durable worker: exclusive job leases, four concurrent batches, saved-batch
recovery, integer token/cost accounting, cap checks and transactional finish/usage records.
Real PostgreSQL and loopback-provider checks cover shutdown during connection waits, body
loading and either provider pass; stale leases cannot save outcomes or update spend. A failed
usage write rolls back completion, and the next lease finishes saved batches without a new
provider call. An expired lease or a crash before a batch is saved can repeat provider work;
recovery only skips durably saved batches. The command keeps the production lease longer
than one bounded provider attempt. A greater-than-16-MiB result walks pages in filtered submit order despite family
regrouping and reversed completion. Names and corrections retain escaped control characters
and lone surrogates. Append-only migration 040 changes retained results from JSONB to JSON;
release-39 upgrade, cancellation rollback, repeat/concurrent migration, manifest and recovery
count checks preserve retained results and existing job/ledger rows. Automated translation tests
fetch the pinned earlier release so the upgrade proof also runs in GitHub. Historical receipt-selector
fixtures retain their audited workflow bytes when current checkout settings change; production
audit guards and their original behavioral assertions stay unchanged. Provider activation and routes remain open. Consent enforcement is described under Task 13 below.

Task 9 adds `pnpm translation:worker` and its `--once` mode. Startup checks the
expected migration names, required settings, provider URL and whether the key can form an
HTTP authorization header. Fatal failures print one fixed diagnostic without private values;
recoverable pass failures print a separate fixed retry line.
PostgreSQL and loopback-provider process tests cover silent idle and single-job runs,
stored results and usage, two simultaneous jobs with ten-minute leases, and SIGTERM/SIGINT
shutdown during provider work or idle polling. Interrupted batches save no partial results,
and successful shutdown returns leases without using an attempt. Borrowed-client and
real disconnect checks cover fixed fatal output; a failed lease return exits 1 in both modes.
When the database cannot accept that return, the lease remains until its original expiry.
Signals before module loading installs the handlers still use the operating system’s default
termination. The command installs its handlers before opening the database pool. Direct Node
runs are quiet on success; the root pnpm
script can report a missing optional `.env` file. No real provider request is part of
these checks; activation and retention remain later tasks.

Task 10 adds the four signed machine actions at the store boundary. Each execution
checks the installation proof, revocation and current lease under an installation lock.
Submit verifies the fingerprint before parsing, then returns a repeated operation before
checking entitlement, open jobs or spending. Concurrent retries create one job.
Status, collect and release reject repeated fields and alternate version spellings,
then validate lowercase job UUIDs before reading jobs scoped to the signing installation. Collect checks ownership before cursor validity,
then applies state rules. PostgreSQL checks cover crossed and expired leases, revocation
during a lock wait, rollback after a body insert fails, mixed outcomes and a signed multi-page walk
larger than 16 MiB with unchanged text. Collection retains results; release deletes them.
These store methods are now used by the HTTP routes below, with the consent checks described under Task 13.

Task 11 adds the four translation HTTP routes, off by default. The account server
accepts only `CLOUD_TRANSLATION=0` or `1`; enabling requires an installation issuer.
The routes preserve proof/lease checks, installation-scoped job reads, retry ordering,
shared request allowances and security headers. Submit validates its three outer fields
before passing only the signed two-field envelope to authentication. Real-listener
checks prove compact collect replies at exactly 16,777,216 UTF-8 bytes, splitting at one
byte over, stable cursor retries and unchanged names/corrections across multiple pages.
Task 12 gives submit its own 2,113,536-byte, 60-second reader and four simultaneous
places per process, at most one per canonical client address, outside the eight
ordinary account places. Excess submits receive 503 before reading or rate charging.
Real-listener checks cover large escaped jobs, exact request-byte boundaries, slow
delivery, address grouping, refusal/abort recovery and readiness during stalled submits.
Admission uses the router's decoded submit path so encoded aliases cannot spend ordinary places.
Status, collect, release and other account readers keep 16 KiB and five seconds.
Task 13 requires current consent before accepting a new submit and after leasing a job.
Only an enabled, email-verified owner can agree or withdraw. Consent names OpenAI,
Anthropic and Google at version `providers-2026-10-14`; withdrawal keeps its history.
A former owner's consent no longer counts, and a new agreement closes that stale record.
Agreement and withdrawal share a venue lock so withdrawal also closes a concurrently
replaced record. Recording consent locks account, credential and membership authority
through the transaction, in account, credential, membership and venue order.
This avoids the reproduced deadlock with account changes that also update ownership.
PostgreSQL tests cover authority changes during lock waits,
repeat and concurrent agreements, rollback, history and account-scoped listing.
A worker without current consent finishes with `consent_required` before provider traffic
or usage writes; a replacement worker's lease cannot be failed by the old worker.
Submit still checks entitlement before consent and returns an existing operation before
either gate. Real HTTP tests cover the 403 reply and retry after withdrawal.
Task 14 adds `GET|POST /api/account/translation-consent`. You can list your owned
venues, agree to the exact provider version or withdraw while retaining history.
Writes require the portal Origin and your session's CSRF token, which proves that
this browser started the request. Reads and writes share 30 requests per minute per
account and never renew a passive session. The route resolves the live session
before charging, then before and after the database change; expiry during a lock
wait rolls the change back. PostgreSQL HTTP tests cover that rollback for agreement
and withdrawal, a session ended during body delivery, strict bodies, owner isolation,
and machine refusal before agreement and after withdrawal.
Task 15 adds the owner-only menu-translation control in each installation's entry
on `/account`, with draft English and Spanish wording. You can agree, withdraw or
retry a failed read; a read failure appears only in the first visible translation
control. Its “Refresh translation status” button (“Actualizar estado de traducción”)
waits while the installation list refreshes, so you cannot retry against a list
still being refreshed. The list keeps its separate “Refresh status” name.
An unanswered write keeps the last confirmed choice and asks you to retry only in
that venue's control. Stubbed Chromium checks cover two venues, successful read
retry, venue-specific write warnings and views without translation controls in
both languages, themes and phone/desktop widths. The controls are groups within their venue
entries, so multiple venues do not create identically named page regions. Account changes and refused sessions clear that choice, and late
replies cannot restore it. The browser sends the session's security token on writes
and validates complete consent replies. Real PostgreSQL/Chromium tests cover
agreement, persistence, withdrawal after a lost response body and owner-only display
in both languages, themes and phone/desktop widths. The wording awaits the owner.
The manual-retry browser fixture holds its successful session-activity reply until the
retry read returns. A controlled reply before click reproduces the five-second missing
retry-button failure: the session update automatically reloads consent and replaces that
button after pointerdown. Holding the reply passes the same 500 ms delayed-click control;
removing the hold restores the original timeout. Every existing assertion and deadline
remains. The two natural failures retained no request ordering, so their exact trigger stays
unproved; bounded path/status events now accompany any future failure. Portal production
code is unchanged by this fixture correction. Task 21 also reproduces a different gap:
an initial activity result can be accepted after the clock advance even though the manual
phase holds new activity requests. A controlled real PostgreSQL/Chromium run delays only
that valid session body's acceptance. It triggers an automatic consent read and the same
five-second missing-retry-button failure seen in CI. The fixture now completes initial
activity and its forced unavailable consent reload before advancing time; the original
manual 503/429/200 path, all permission and outcome checks, the 61-second advance and every
deadline remain. That controlled schedule passes with the precondition and fails when it
is removed in a disposable installed checkout. The natural CI trace did not record JSON
acceptance, so its exact scheduling remains unproved. Earlier response-listener timeouts
also lack complete ordering; capture clock-return, listener registration and activity
acceptance on recurrence rather than claiming all intermittent failures are resolved.
Task 16 keeps translation out of the three-service configuration, account and diagnostic
lists, monitoring targets, incident display and alert delivery. A ready translation row alone
cannot enable those services. PostgreSQL regressions insert that row explicitly and cover
schedule refusal, stopped-service incident suppression, queued-mail cancellation and
operations status.
Task 17 appends migration 041 and creates the ready translation row for new and replacement
installations. Its backfill preserves existing service rows, configuration, revisions and revocation.
A configuration request with the exact signed body `{"servicesVersion":2}` receives four services;
`{}`, renewal, reports, revocation and account lists keep the original three. Retried configuration
operations replay their original result after a configuration change, while new reads reflect the
current revision. PostgreSQL and HTTP checks cover exact bytes, invalid versions, lease bindings,
revocation, replacement and upgrades from an existing schema.
Task 18 deletes submitted menus and stored results in bounded 24-hour retention passes.
Finished jobs age from completion; queued or running jobs age from submission. Each pass
expires at most 100 jobs by default (an explicit limit may be 1–1,000), clears their leases
and preserves job accounting and usage events. The worker sweeps at startup and hourly,
while keeping one-second job polling and one-minute cleanup-failure retries. When translation
is on, the account server sweeps at startup and every minute, so cleanup also runs without
a worker. Native CLI checks cover the hourly boundary, intervening polling and cleanup retry;
PostgreSQL checks cover retained-body deletion through the accelerated hourly worker.
PostgreSQL checks cover concurrent sweeps, locked collect rows, rollback, lost worker leases,
repeat-page retention, release waiting for collect and expiry between real bounded pages.
A fake-provider flow submits, finishes, durably stores collected pages and releases through
both real commands; neither command writes submitted names, generated names, the key or an
authorization header.
Cleanup failure keeps the approved startup/work gate closed: the enabled account command
exits before listening, and the continuous worker pauses new jobs, retries cleanup once per
minute and stops promptly during that wait. Both use fixed diagnostics. This also makes the
portal unavailable if its enabled startup cleanup fails; review that availability policy before
enabling translation. The `--once` regression proves an old queued job never reaches the fake
provider before its startup sweep.
The review's 50,000-retained-row probe used a sequential scan (5.4 ms locally). The per-pass
job limit does not bound rows scanned. Measure retained-history growth at launch volume and
qualify an append-only indexing migration if needed. The worker now skips queued and retryable
running jobs submitted at least 24 hours ago when selecting a new lease, even if bounded
cleanup has not reached them. PostgreSQL and loopback-provider checks cover both states at
24 and 25 hours, younger work behind them, unchanged attempts/accounting and subsequent
sweep deletion. The same venue cannot submit a replacement until the sweep expires its
old job; younger work for other venues can proceed. The unchanged command disconnect
tests still terminate real lease/cleanup queries and require one fixed fatal diagnostic.
A job aging after lease admission needs dispatch qualification before activation.
Admission does not replace deletion of an expired body.
Task 19 adds the optional `translation` Compose profile and runtime role. The default stack
omits the worker; only it receives provider settings, while account receives the translation
switch, default off. Compose and runtime checks cover the profile, migration dependency,
private configuration mount and exact environment boundaries. The package guide documents
the worker, fixed diagnostics, cap overshoot and bounded retention. CI scope checks retain
translation package selection. A real disposable Compose/PostgreSQL regression starts the
worker, then refuses a changed migration digest before dispatch. Deleting only the launcher
schema gate makes that assertion fail. The local source-mounted proof also checks exact child
environment names and normal idle shutdown (0.27 seconds); its project is removed.
A built release image and active-provider Compose shutdown still need qualification.
This does not establish full-stack translation delivery,
quality, joint Waitron paging or production provider approval.
D101 slice 1 blocks every production adapter call before input inspection or network
access, including direct review/retry calls and apparently clean menu text. Queued
jobs settle as `provider_unavailable` without token usage; maintained trials refuse
ordinary settings before output. Synthetic-only proof requires `CLOUD_TRANSLATION_LOCAL_PROOF=1`
and literal HTTP `127.0.0.1` with an explicit port, validated before URL normalisation.
Only the translation Compose role receives that flag. The existing transport tests
retain response limits, cancellation, redirects, retries and token accounting through
the explicit loopback factory. The real source-mounted launcher checks its child's
proof settings and still refuses changed migration digests. Frozen experiments,
owner grades and saved results remain byte-identical. Separate privacy eligibility,
supplier/location acceptance, quality and joint/release qualification stay open.
Task 20 preserves the original trial scripts, grading template, both product and shown-name
sets, all 141 owner grades and six Luna-review result files byte for byte. The offline scorer
reproduces the original totals: tuning 252 names, 6 needing work and 10 wrong; blind 243 names,
5 needing work and 6 wrong. Unseen names are counted and listed as ungraded, never accepted.
Command checks refuse missing input, failed or wrong-set runs, malformed values and repeated
files before printing a table, and warn about incomplete products and names. A multi-file
check preserves the complete ungraded list. The copied shown-language keys match the saved
grading pages, apart from unchanged given names that scoring excludes. These offline checks run in the
ordinary package suite without a provider or key; they do not measure the templated prompt.
Task 21 adds the trial runner and grading page below. Owner Tasks 22–24 and the joint proof remain open.
A controlled client-error event followed by cleanup-query rejection reproduces a fatal
line followed by a misleading cleanup-retry line. The worker now stops that retry path
after a fatal failure; the original exact-output assertions remain. The new subprocess
case and ordinary cleanup retry/recovery checks cover this ordering. CI exposed the
same duplicate output without retaining its exact query stages, so the historical
database timing remains unproved. The runtime reviewer later saw this original disconnect
case fail once among ten two-file runs, but its output filter discarded the assertion diff.
Twenty driver repeats then pass all 580 cases, including 60 original idle disconnections,
with complete logs retained. These passes do not explain that uncaptured failure. A real
PostgreSQL self-termination during cleanup passes three times with the guard and fails
with the guard deleted. Treat that as qualification of the fatal-then-retry mechanism,
not proof that every intermittent disconnect failure is resolved. On recurrence, keep the
complete assertion output, selected backend ids and termination results before changing
the original check. Active-job failure ordering at direct pool queries remains separately
unqualified; the reviewed idle scenario leases no job.
A later CI disconnect failure retains the reverse output: a pass-retry line before
that fatal line. A local real PostgreSQL lease-query termination reproduces this
ordering when the client error event arrives later. The query reports `57P01`,
PostgreSQL's code for an administrator stopping a connection. The worker now treats
that query rejection as fatal before the event in both the cleanup loop and the
lease pass, so it prints the existing single fixed failure line without promising
a retry. The original disconnect and ordinary retry assertions remain unchanged.
Two new process tests retain the real error code and force query rejection before
the client event at each stage. The exact query stage and
backend identifiers from that CI failure remain unavailable; the local ordering
proof does not establish them or classify every other connection error.
Keep translation off until the remaining runtime and joint qualification are complete.

The owner requires [bounded collect before go-live](../superpowers/plans/2026-10-16-translation-collect-pages.md).
The [canonical contract](../waitron-integration-contract.md#translate-all-version-1) now specifies
compact full-body replies of at most 16,777,216 decoded UTF-8 bytes, signed optional cursors in
filtered submit order, atomic unchanged results, stable retries and release only after every page
is durably stored. A conservative singleton size calculation uses the existing 1 MiB job bound
and preserves accepted language tags. Store-level sizing and HTTP serialization are tested; the real Waitron caller still needs joint proof.

Task 21 adds the hand-run production-path trial and new-name grading page. Fake-provider
checks cover usage, both passes, failed trials and strict command input; a failed review
keeps diagnostic names but is refused as a successful quality run. The builder filters
marked, shown, given and placeholder names, keeps run provenance, and escapes embedded
text. Its separate maintained template preserves the original experiment assets.
Chromium checks cover English/Spanish, light/dark, phone/desktop, exact mark writes and
deletions, failed saves and disabled controls without a grading store. Later snapshots
preserve a save result; both initial snapshots are required, pending choices lock and a
disconnected store cannot re-enable controls with a late update. These use a local
controlled store; the external grading bridge and owner measurements remain unqualified.
The new browser cases register through the original UI test entry point and keep its
workspace test command unchanged, preserving historical receipt-fixture discovery.
No real key or provider call is part of this implementation.

Remaining work:

- **Cloud qualification:** Tasks 1–21 are implemented, including the paging amendment's
  replacements for Tasks 3, 8, 10, 11 and 18. Preserve proof/lease and installation isolation,
  consent, cap/usage accounting, context omission, worker recovery and 24-hour deletion.
  Complete lock-order qualification across worker, release and installation revocation. The
  controlled revocation wait is covered; a mixed-traffic probe samples only one ordering.
  Before enabling submit, jointly qualify language recognition and canonical duplicates. The
  approved parser accepts unknown primary codes with subtags such as `xx-BR`, non-language
  codes `mul`/`zxx`, and case variants as distinct tags. The actual Waitron language validator
  refuses the unknown/non-language probe inputs and normalizes ordinary regional variants,
  but direct signed input still needs a policy decision before activation. Preserve the
  approved accepted-tag set until that contract decision; claim no complete recognition gate.
  The command rejects keys that cannot form an HTTP authorization header before leasing work.
  Direct client consumers still own their configuration validation.
  Consent rows retain history after membership removal. Current, enabled, verified ownership
  is checked when consent is recorded and used; a stored account ID alone grants nothing.
  The worker checks consent once after leasing. Withdrawal after that check does not cancel
  a job already in flight; it prevents new submits and subsequent leases. A resumed
  job without consent withholds previously saved batches and keeps cost already spent,
  as the contract now states. Consent listing now reads all owned venues and their current
  consent in at most two database queries. A real PostgreSQL check with 32 venues
  reproduces the former 33 reads and verifies two after batching, with unchanged
  ordered results and current-owner, enabled-account, verified-email, version and
  withdrawal rules. This is a query-count measurement, not deployment-scale latency
  or capacity evidence; qualify those separately before launch.
  Append migrations at the then-current next numbers without editing landed migrations.
  Task 8 retains two defensive checks whose independent role in normal worker runs is not
  proved: refusing an already-saved batch write, and refusing finish before all batch entries
  exist. Preserve them without claiming they are unreachable. Parallel infrastructure failures
  currently expose one error; both failures from one call's spend/renew callbacks are retained.
  An ordinary failed run keeps its lease until expiry and uses a lease attempt; only caller
  shutdown returns it immediately when the database accepts the update. Task 18 now tests
  fixed failure diagnostics and no names in process output; broader traffic qualification remains open.
  The page-walk fixture now holds the specifically named first batch until the second batch
  is saved. A controlled second-before-first request schedule reproduced the original failure:
  the fixture had incorrectly treated the first arriving HTTP request as the first batch.
  The corrected test preserves every original outcome assertion and deadline, adds the actual
  request-order check, and proves durable completion in the opposite order before walking pages.
  The earlier review M17 failure had no retained arrival trace, so that historical trigger
  remains unproved; the current CI ordering-precondition failure is independently reproduced.
  The fingerprint helper now refuses an actual UTF-8 byte count that differs from the
  signed count before allocating its body buffer or hashing. The declared 1 MiB limit
  keeps its existing precedence and refusal codes; matching lengths still require the
  exact hash. Six allocation checks cover shorter, longer, empty, multibyte, unpaired
  surrogate and oversized actual bodies. Keep Task 12's whole-request bound ahead of
  this helper; it does not replace HTTP admission or body limits.
- **Waitron and joint qualification:** Waitron's paging caller landed in
  [PR #1901](https://github.com/clintongormley/waitron/pull/1901) at
  `93de9902c53734dc89b1bd9b440669bc25f4c020`. The
  [interruption-proof design](../superpowers/specs/2026-10-19-translation-interruption-proof.md)
  and [three-task plan](../superpowers/plans/2026-10-19-translation-interruption-proof.md)
  define a local Cloud script against the real Waitron server and a fake provider.
  The opt-in Cloud fixture now pages at 512 bytes, pauses collection outside
  transactions, drops a chosen real HTTP reply and awaits release checks before
  deletion. Its six real-listener tests pass, including streamed writes, independent
  fixture budgets and cancellation. The production page limit stays at 16 MiB;
  invalid internal limits are refused. Removing the guards and reply controls in
  a disposable checkout makes their tests fail. The baseline script now has tested
  trace and child-cleanup checks. Its paired healthy walk passes against clean
  Waitron `a3be14ba4e59bc8104087624171ddabec4978de2` (fixture repair #1903): three
  one-item pages, three unique durable suggestions before release, and no retained
  Cloud body. An injected setup failure also cleans up its process, Cloud and root.
  The [interruption command](../local-pairing.md#prove-translation-survives-interruptions)
  now passes all five independent fault executions: lost page reply retries the same
  cursor with identical content; graceful and forced restarts resume saved cursor 1;
  lost release retries once after body deletion without moving the collection time;
  expiry retains page one's suggestion, reports one success and two failures, and
  shows the real partial-result bell notice before suggestions are opened. Every
  release checks durable completion first. A deliberate early suggestions read
  clears the notice and fails qualification. The combined five-case command passes;
  fourteen independent guard removals are caught by behavioral checks. Keep bounded
  decoded reads and the wider release gate open; these synthetic cases do not qualify
  production. Keep generation tags limited to the controlled single-runner restart.
  Before adding long-running release checks, give those callbacks cancellation:
  closing currently stops waiting and subsequent machine execution, while callbacks
  must stop their own work. Bundle-marker preflight checks required UI strings;
  the actual bell check remains mandatory.
- **Owner quality trials:** Tasks 22–24 remain owner-only after **2026-11-02**, using their
  preserved commands. Templated-prompt non-regression on both graded sets, house-style effects
  and the other kinds of name still need measurement and owner grading. Run no real-key trials
  as part of this documentation prerequisite or autonomous implementation.
- **Commercial and production gates:** pricing, billing and the replacement monthly allowance
  remain required before the first live venue. Provider processing/residency and retention
  decisions, consent wording, production key custody and deployment remain open. Suggestions
  still require a person to save them before diners see a change. Design approval enables none
  of these production capabilities.

Implement routine work inline with failing behavioral tests first. Before every push, run the
full touched-package and dependent-package suites; run the whole workspace only for shared
configuration changes. Require normal hooks and current-head CI. The amendment records the
approved contract; the partial runtime above does not complete joint proof or release qualification.

## Callback admission and request deadlines

Run `node --test packages/translation/test/openai-client-timeout-isolation.test.ts`
to check separate deadlines for overlapping HTTP requests. A timeout while waiting
for headers or an unfinished successful body closes only that request and admits
no text or usage. A later overlapping reply and another call through the same
client keep their own deadlines. Real provider and release qualification remain
separate gates in the [translation backlog](translation.md).

Run `node --test packages/translation/test/batch-runner-cancelled-callback-failures.test.ts`
to check that cancellation during delayed spending or lease-renewal failures in
either pass preserves the original storage errors, billed usage and callback
order, without another provider call. Wider runtime and release qualification
remain open in the [translation backlog](translation.md).

Run `node --test packages/translation/test/batch-runner-unbilled-failures.test.ts`
to check that lease-renewal failures after HTTP refusals and uncounted malformed
replies escape in both passes, without another provider call or invented usage.
Real database recovery, provider activation and wider release qualification remain
open in the [translation backlog](translation.md).

Run `node --test packages/translation/test/batch-runner-admission-ordering.test.ts`
to check that each provider pass waits for its spending-cap answer. Delayed
refusals, failures and cancellation prevent another call and preserve earlier
billed usage and first-pass names where applicable. Production activation and
wider runtime qualification remain open in the [translation backlog](translation.md).

## HTTP body and batch callback boundaries

Run `node --test packages/translation/test/batch-runner-callback-ordering.test.ts`
to check that delayed spending and lease-renewal callbacks finish before a batch
continues or returns cancellation, in either pass. Real database recovery and
release qualification remain separate gates in the linked translation backlog.

Run `node --test packages/translation/test/batch-runner-callback-failures.test.ts`
to check accounting and lease-renewal failures after valid, unusable and incomplete
billed replies in both passes. Local HTTP checks retain each original error and
prevent another paid call after those failures. Real database recovery, provider
activation and the remaining [translation gates](translation.md) stay open.

Run `node --test packages/translation/test/openai-client-fragmented-body.test.ts`
to check split UTF-8 text at the exact response limit and cumulative overflow
across separate network reads. Overflow must close unfinished connections and
expose no unparsed token usage. Real provider and release qualification remain
separate gates in the linked translation backlog.

Run `node --test packages/translation/test/openai-client-compressed-body.test.ts`
to check gzip, deflate and Brotli replies at the exact decoded byte limit. Overflow
closes unfinished HTTP connections before admitting text or usage; corrupt compressed
bodies return sanitized errors without retries. Real provider and release qualification
remain separate gates in the linked translation backlog.

Run `node --test packages/translation/test/openai-client-compressed-integrity.test.ts`
to check that complete decoded JSON waits for a gzip or deflate checksum before
admitting text or usage. Delayed valid checksums succeed; corrupt checksums return
a sanitized error without usage or automatic retry. A later call through the same
client still succeeds. Real provider and release qualification remain open.

Run `node --test packages/translation/test/batch-runner-compressed-integrity.test.ts`
to check spending, lease renewal and retries after gzip or deflate checksum failures
in both passes. Pending checksums withhold callbacks; corrupt replies renew the lease
without inventing usage. A healthy retry succeeds, while four failed attempts stop
the pass. Failed reviews retain first-pass names and spending. These local HTTP checks
keep real provider and release qualification open.

Run `node --test packages/translation/test/openai-client-unfinished-refusals.test.ts`
to check that unfinished HTTP refusals close their connections and retain their
retry decisions without parsing error-body usage or private text. A later valid
reply through the same client still succeeds. Real provider and release
qualification remain separate gates in the linked translation backlog.

Run `node --test packages/translation/test/openai-client-unfinished-redirects.test.ts`
to check that unfinished redirects close their connections without reaching the
redirect target or admitting its text or usage. Both passes stop without retry;
a refused review retains the first-pass names and spending. Later requests on
the same client still work. Real provider and release qualification remain
separate gates in the linked translation backlog.

Run `node --test packages/translation/test/openai-client-interrupted-success.test.ts`
to check that timeout and caller cancellation close unfinished successful HTTP
responses, discard uncompleted usage and permit a later request on the same
client. A caller cancelled before submission sends no request. These local
checks keep real provider activation and wider release qualification open.
