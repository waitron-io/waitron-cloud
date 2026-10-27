# Cost conformance image acquisition (D137)

A Docker Hub token request timed out while D135's stack group 2/3 was pulling
`node:26.11.1-slim` (cost run 39977546909, job 120496895328). Both archives
verified and the fixture image built before the refusal; 206 cost cases passed
and eight did not start. The network cause remains unknown.

The conformance preparer now checks the local image cache first and retries only
recognised transport failures, with at most three pull attempts. Authentication,
permission, missing-manifest and rate-limit refusals stop immediately, even when
the same message also contains a transport error. An unavailable Docker daemon
stops at inspection. Container creation and image builds are not retried.

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
interruption and owned scratch cleanup. Local Docker qualification remains
unavailable until 3 November; Linux CI must qualify the real image path. D135
must rebase onto this repair and pass every current-head job before landing.

