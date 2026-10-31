# Cost conformance image acquisition (D137)

A Docker Hub token request timed out while D135's stack group 2/3 was pulling
`node:26.11.1-slim` (cost run 39977546909, job 120496895328). Both archives
verified and the fixture image built before the refusal; 206 cost cases passed
and eight did not start. The network cause remains unknown.

The conformance preparer now checks the local image cache first and retries only
recognised transport failures, with at most three pull attempts. Authentication,
permission, missing-manifest and rate-limit refusals stop immediately, even when
the same message also contains a transport error. An unavailable Docker daemon
stops at inspection. Container creation is not retried. Fixture image builds have
their own bounded retry for Docker Hub metadata HTTP 5xx responses, described in
the [build acquisition investigation](cost-conformance-fixtures.md#conformance-image-acquisition-during-d135-qualification).

Inspection, all pulls and both retry pauses share the existing 300-second image
acquisition budget: inspect time + pull times + 1 second + 2 seconds must fit
inside 300 seconds; each command receives only the remaining time. Retries are
not started when their pause cannot fit, interruption cancels a pause, and the existing
command supervisor kills a stalled child. Cached images avoid another registry
request. A BuildKit base image is not assumed to exist in Docker's runnable-image
cache; the separate Node runner still uses an explicit cache inspection.
Image pins and all conformance assertions remain unchanged.

Controlled Docker-command tests reproduce the exact recorded refusal and cover
recovery, permanent refusals, exhausted attempts, shared deadlines, cached images,
interruption and owned scratch cleanup. Run them with
`node --test scripts/cloud-cost/conformance-image-acquisition.test.mjs`.
The Mac's Docker remains unavailable until 3 November; use the authorised Linux
test box for a controlled reproduction and current-head CI for landing evidence.

### Registry failure groups (D530)

Keep these three boundaries separate when investigating a recurrence:

- [D477's launcher failure](https://github.com/waitron-io/waitron-cloud/actions/runs/40856632619/job/123389285499)
  returns HTTP 500 while pulling PostgreSQL, before conformance preparation.
  `scripts/test-postgres.mjs` now retries registry HTTP 5xx within its shared
  120-second acquisition budget. Run `node --test scripts/ci-test-postgres.test.mjs`
  for recovery, exhausted-attempt and permanent-refusal controls.
- [D521's fixture build](https://github.com/waitron-io/waitron-cloud/actions/runs/41143129809/job/124361956617)
  returns HTTP 502 while reading Node base-image metadata. Its separate build
  retry shares the original 300-second budget. Run
  `node --test scripts/cloud-cost/conformance-image-build.test.mjs` for its controls.
- [D462's later Node pull](https://github.com/waitron-io/waitron-cloud/actions/runs/41160662631/job/124417317872)
  reports `unauthorized: authentication required` after the fixture build succeeds.
  It stops after one pull, as required for authentication refusals. The log has
  no registry challenge or credential-selection evidence, so its cause remains
  unknown. Capture those details in a controlled reproduction without publishing
  tokens, credentials or authorization headers.

The first two boundaries already have recovery handling on main; their provider
outage causes remain unknown. A passing control or later CI run does not repair
the authentication failure or explain any of these historical outages. Preserve
the existing image pins, deadlines and immediate authentication refusal.

### Isolation-test Node image (D530)

[D462's later receipts job](https://github.com/waitron-io/waitron-cloud/actions/runs/41209487824/job/124561374894)
fails an implicit `node:26-slim` pull with HTTP 502 before the isolation canary
starts. Six source-copy checks then fail because that image is absent. This is
a separate acquisition path from the conformance preparer and its pinned runner.

The isolation tests now prepare their existing image before creating their own
resources. Cache inspection, at most three pulls, one- and two-second retry
pauses, and the final immutable-image-ID lookup share a 120-second preparation
budget. Only recognised temporary transport and registry HTTP 5xx failures retry;
authentication, permission, missing-manifest and rate-limit refusals stop immediately,
including messages that also contain a temporary failure. An unavailable daemon
stops at inspection. Container creation is never retried, and the tests retain
every isolation assertion and existing test deadline. Image preparation finishes
before the cancellation test schedules its abort.

Run `node --test scripts/cloud-cost/isolation-image-acquisition.test.mjs` for
controlled acquisition checks. On the authorised Linux test box, also run
`node --test --test-concurrency=1 scripts/cloud-cost/local.test.mjs scripts/cloud-cost/source-copy.test.mjs`
to exercise the actual isolation and source-copy boundaries. The historical
Docker Hub outage cause remains unknown; this recovery does not repair the
provider or the separate authentication refusal.

