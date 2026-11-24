# CI pnpm setup

## Nested package installs (D530)

The audit, remote-access and portal guard fixtures copy the parent's installed dependencies, and
the package-test and receipt steps pass the package token, so a nested install needs neither the
store nor a placeholder credential (`node --test scripts/ci-audit-fixture-dependencies.test.mjs
scripts/ci-nested-install-auth.test.mjs`). Open:

- Why the offline install could not find `undici-types@7.18.2`
  ([41792705294](https://github.com/waitron-io/waitron-cloud/actions/runs/41792705294/job/126450587544),
  [main](https://github.com/waitron-io/waitron-cloud/actions/runs/41797930675/job/126466887370)), and which
  package [the remote-access failure](https://github.com/waitron-io/waitron-cloud/actions/runs/41804574176)
  missed.
- Why [41461747571](https://github.com/waitron-io/waitron-cloud/actions/runs/41461747571/job/125332453331),
  [41814030751](https://github.com/waitron-io/waitron-cloud/actions/runs/41814030751/job/126520320891) and
  [41817007161](https://github.com/waitron-io/waitron-cloud/actions/runs/41817007161/job/126530905441) needed
  another download after the initial install.
- The password and relay fault programs in `nightly-mutations` still install from the offline
  store: qualify that path, including its cold-store install, in the hosted nightly.
- The lifecycle proof's checkout failure is unattributed; its record now names the release and
  the failed boundary.

## Bootstrap transport failures and bounded recovery (D154)

`scripts/ci-setup-pnpm.mjs` gives at most three fresh 30-second attempts and retries only known
transport failures; signature, integrity and unknown refusals stop. The network causes are
unknown: the `ERR_PNPM_PNPM_ENGINE_IDENTITY_UNVERIFIABLE` / `terminated` refusals
([39650584401](https://github.com/waitron-io/waitron-cloud/actions/runs/39650584401/job/119397690795),
[40022323542](https://github.com/waitron-io/waitron-cloud/actions/runs/40022323542/job/120649947311)), the
reset in [40712695671](https://github.com/waitron-io/waitron-cloud/actions/runs/40712695671/job/122902175152),
the missing diagnostic in
[41170351156](https://github.com/waitron-io/waitron-cloud/actions/runs/41170351156/job/124446923168) and the
five-minute bootstrap in 38803777952. Keep verification and capture the failing HTTP stage on a
recurrence. Body decoding after a completed transfer, a synchronous exit right after `.abort()`,
`AbortSignal` labels and a force-killed supervisor's cleanup are unqualified.

## Native attempt-count observation (D530)

On 4 November `hang is stopped within each attempt's bound` counted two installer executions
instead of three; isolated runs give both answers. The cause, and any link to the similar
descendant-timeout case, is unproved. On recurrence, keep both supervisor attempt labels and
installer-entry records before choosing a repair.

## Root-fixture stress boundaries

The historical 35-second npm-bootstrap observer and 60-second dependency worker
still have unexplained timeouts under overlapping root checks and qualification.
Preserve both limits and capture startup, request and worker
stages on recurrence; avoid overlapping full qualification to measure them.
The controlled five-second npm-start delay demonstrates a mechanism, not the
original failure's cause.
