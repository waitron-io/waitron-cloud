# Cost conformance image acquisition (D137)

Image pulls check the local cache first and retry only recognised transport failures and registry
HTTP 5xx, at most three times inside their budgets; authentication, permission, missing-manifest
and rate-limit refusals stop at once, even beside a transport error. Container creation is never
retried. Keep the pins, deadlines, immediate authentication refusal and every isolation assertion.

### Registry failure groups (D530)

Keep these boundaries apart; their provider causes are unknown:

- Token request timeout on `node:26.11.1-slim` (cost run 39977546909).
- [HTTP 500 pulling PostgreSQL](https://github.com/waitron-io/waitron-cloud/actions/runs/40856632619/job/123389285499)
  before preparation (D477).
- [HTTP 502 for base-image metadata](https://github.com/waitron-io/waitron-cloud/actions/runs/41143129809/job/124361956617)
  (D521).
- [Implicit `node:26-slim` pull, HTTP 502](https://github.com/waitron-io/waitron-cloud/actions/runs/41209487824/job/124561374894)
  before the isolation canary (D462); the image is now obtained first.
- [`unauthorized: authentication required`](https://github.com/waitron-io/waitron-cloud/actions/runs/41160662631/job/124417317872)
  after a successful build (D462). Capture the registry challenge and credential selection in a
  controlled reproduction without recording secrets.

The Linux recovery paths pass on cached images and layers; an empty image cache, and which
credentials the daemon uses, are unqualified. Repeating passing selections explains nothing.
