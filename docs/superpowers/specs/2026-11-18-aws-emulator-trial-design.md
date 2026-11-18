# Trial: Route 53 and SQS tests against AWS Emulator

Status: approved by the owner, 2026-11-18 (the conversation's "ok" to the short design).

## Why

Cloud's Route 53 adapter (`packages/remote-access/src/route53-dns.ts`) and SQS adapter
(`packages/registration/src/ses-feedback-queue.ts`) are tested only against hand-written fakes:
an HTTP server on loopback for Route 53, and an injected transport for SQS. A fake answers what we
told it to, so it cannot show that Amazon would refuse a request or answer it differently. AWS
Emulator is Amazon's local stand-in for its services, public domain (CC0 1.0), free, with no AWS
account. The trial checks whether our fakes' picture of these two services matches the emulator's,
and keeps checking as the adapters change.

## Goals

- Run the calls these two adapters really make against the emulator, in CI.
- Keep every existing fake-server test. The new tests are additional.
- Report where the emulator and our fakes agree and differ, with a keep-or-drop recommendation,
  in the pull request.

## Non-goals and anti-goals

- No Mac support: the emulator runs natively on Linux only. The new test files skip locally and say
  why.
- No product change. In particular the SQS adapter stays locked to
  `https://sqs.<region>.amazonaws.com` with configured endpoints ignored; the test reaches the
  emulator through the adapter's existing `requestHandler` option, which its own comment reserves
  for local qualification.
- No real AWS access, no stored credential: the emulator's keys are generated per run, read from the
  file it writes, and never become a workflow secret.
- No telemetry from CI to Amazon: start the emulator with `-t off`.
- Not a replacement for the separately authorised live rehearsals.
- A CI run with the emulator missing must fail, never silently skip.

## Approaches

1. **New emulator test files in each package, run by a dedicated CI job (chosen).** The
   trial runs on relevant path changes, nightly, and on demand.
2. Point the existing tests at the emulator. Rejected: they rely on what only a fake can do —
   hanging on purpose, counting requests, returning malformed replies.
3. A one-off script. Rejected: cheaper, but catches nothing after the day it runs.

## Design

- **Tests.** One emulator test file per package (naming left to the builder, but it must not be
  picked up by the package's normal `test` script, so the package suites stay unchanged).
  - Route 53: create a hosted zone for a synthetic suffix; through `createRoute53DnsProvider` with a
    client pointed at the emulator: publish a challenge TXT and see the adapter return only after
    `INSYNC`; remove it by exact value; see a remove with a different value refused
    (`InvalidChangeBatch`) and the newer value survive; point a venue CNAME and wait for `INSYNC`.
  - SQS: create the queue the validated config names, using account `000000000000` and region
    `eu-north-1` (the account passes the 12-digit check in `ses-feedback-config.ts`); through
    `createSesFeedbackQueue` with a `requestHandler` that forwards to the emulator: send a message,
    receive it, see it hidden while in flight, delete it, and see it gone.
- **Route 53 timing.** The emulator has no control to complete a change. On 1.0.512 (Docker on the
  owner's Mac, 2026-11-18) a change was `PENDING` straight after the write and `INSYNC` 1.0 seconds
  later, both through `createRoute53DnsProvider(...).present` and when polled directly. (An earlier
  note here of "one to two minutes" measured only how long I took to look again.) The adapter's
  75-second publish deadline (`route53-dns.ts`) is therefore not at risk; the tests keep the
  package's 30-second case limit.
- **SQS forwarding.** The adapter signs for `sqs.eu-north-1.amazonaws.com`, and Node takes the TLS
  name from that `Host` header, so a plain forward to `127.0.0.1` fails the certificate name check.
  The forwarding transport keeps the signed headers and checks the certificate against `127.0.0.1`
  (`servername: ''` and `checkServerIdentity` with `'127.0.0.1'`), still verifying it against the
  emulator's CA. Measured the same day: without that, `receive` refused with
  `ses_feedback_receive_failed`; with it, the adapter received a sent message and deleted it.
- **CI job.** Installs a pinned Debian package
  (`https://downloads.aws.com/aws-emulator/packages/aws-emulator/LTS/aws-emulator_<version>-1_amd64.deb`,
  about 200 MB), checks its SHA-256 before installing, starts the emulator on loopback with
  telemetry off and an idle timeout, waits on `/__admin/health` and runs the two emulator files.
  The hosted runner is discarded at the end of the job. Read the result in the separate
  `AWS Emulator tests` workflow before merging. Standard CI's `summary` covers its own jobs.
- **Locally.** Without the emulator the files skip with a message naming the reason.

## Left to the builder

File names, whether to cache the package, and how the test locates the emulator. The plan settles
the version (1.0.512, SHA-256 `557f7c2fbf4c4bd99ac50434cdbb36c2f18a111c36d78cfd3cc4f88f765c0962`,
whose `.sig` verified against Amazon's key `98BC F336 A3BE 53B7 34E9 67C5 2E5B F49B D940 F624` on
2026-11-18) and the selection: a standalone workflow, not part of `ci.yml`'s planner.
