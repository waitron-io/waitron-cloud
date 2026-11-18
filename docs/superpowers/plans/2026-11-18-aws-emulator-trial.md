# AWS Emulator trial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run Cloud's real Route 53 and SQS adapters against Amazon's AWS Emulator in a CI workflow of their own, alongside the unchanged fake-server tests.

**Architecture:** Two new test files, one per package, under `test/emulator/` so the packages' own `test/*.test.ts` globs never pick them up. One root script runs both with the repository's required-case reporter, so a skipped case fails the run. A standalone workflow installs a pinned, checksummed emulator package on the Ubuntu runner, starts it on loopback with telemetry off, and runs that script.

**Tech Stack:** Node 26 `node:test`, `@aws-sdk/client-route-53` and `@aws-sdk/client-sqs` 3.1163.0 (already dependencies), AWS Emulator 1.0.512 Debian package, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-18-aws-emulator-trial-design.md`

## Global Constraints

- No product code changes. `packages/remote-access/src/route53-dns.ts` and `packages/registration/src/ses-feedback-queue.ts` stay byte for byte as they are; the SQS adapter stays locked to `https://sqs.<region>.amazonaws.com`.
- No existing test file changes. The fake-server suites stay as they are.
- Emulator package: `https://downloads.aws.com/aws-emulator/packages/aws-emulator/LTS/aws-emulator_1.0.512-1_amd64.deb`, SHA-256 `557f7c2fbf4c4bd99ac50434cdbb36c2f18a111c36d78cfd3cc4f88f765c0962`.
- Emulator always started with `-t off` (no telemetry) and its default loopback bind (never `-b`).
- The emulator's credentials file is read by the tests and never printed, logged or stored as a secret. No workflow gains a secret.
- Synthetic data only: the emulator's own account `000000000000`, names under `emulator.test.waitron.io`, the fixture config from `packages/registration/test/fixtures/mail-attempt.ts`.
- If the emulator answers differently from what a test expects, do not loosen the assertion and do not change product code: stop and report the request, the emulator's answer and the fake's answer to the driver.
- Every commit `git commit -s`. Follow Cloud's `CLAUDE.md`.

## Environment contract (set by the workflow, read by both test files)

| Variable | Value in CI |
| --- | --- |
| `AWS_EMULATOR_ENDPOINT` | `https://127.0.0.1:9297` |
| `AWS_EMULATOR_CREDENTIALS_FILE` | `$HOME/.aws/emulator/9297/emulator_credentials` |
| `NODE_EXTRA_CA_CERTS` | `$HOME/.aws/emulator/9297/ca.pem` |

Each test file reads the two `AWS_EMULATOR_*` variables itself (about ten lines: read the file, take `aws_access_key_id` and `aws_secret_access_key`). Do not add a shared helper under `scripts/`: `scripts/ci-scripts.mjs` refuses script-only changes outside its known families. When either variable is unset, every case in the file is skipped with this reason:

`AWS Emulator is not running: set AWS_EMULATOR_ENDPOINT and AWS_EMULATOR_CREDENTIALS_FILE (Linux CI only; see .github/workflows/aws-emulator.yml)`

**Optional local run (Docker, Apple silicon).** Not part of the deliverable; CI is the authority. Build from a Dockerfile:
`FROM public.ecr.aws/amazonlinux/amazonlinux:2023-minimal`, `ADD https://downloads.aws.com/aws-emulator/packages/aws-emulator/LTS/aws-emulator-1.0.512-1-aarch64.rpm /tmp/aws-emulator.rpm`, `RUN rpm -i /tmp/aws-emulator.rpm && rm /tmp/aws-emulator.rpm && mkdir -p /home/emulator && chown 1000 /home/emulator`, `USER 1000`, `ENV HOME=/home/emulator`, `ENTRYPOINT ["aws-emulator", "-b", "0.0.0.0"]`. Run it with `-p 127.0.0.1:9297:9297 -e HOME="$PWD/home" -v "$PWD/home/.aws/emulator:$PWD/home/.aws/emulator" <image> -p 9297 -t off`, then point the three variables at `$PWD/home/.aws/emulator/9297/`. Remove only the image and container you created.

## Review Focus

1. **An older branch's pull request touching a listed path** runs `main`'s workflow against files that lack the emulator tests. Expected: the job prints that the head predates the emulator tests and passes without installing anything (Task 3, presence step).
2. **The emulator fails to install or start in CI.** Expected: the job fails at that step, or the required-case reporter fails with `Required case did not pass exactly once`. Never a green run with skipped cases (Tasks 1–2 required-case entries, Task 3).
3. **A real mismatch between emulator and fake.** Expected: reported, not hidden (Global Constraints).
4. **The failure log.** Expected: on failure the job prints the emulator's own log tail, which carries paths but not keys, and never the credentials file (Task 3).
5. **An SDK bump** (a Dependabot change to either package's `package.json` or `pnpm-lock.yaml`). Expected: the workflow runs, because that drift is what the trial is for (Task 3 path list).

---

### Task 1: Route 53 adapter against the emulator

**Files:**
- Create: `packages/remote-access/test/emulator/route53-dns.test.ts`
- Modify: `package.json` (root): add script `test:aws-emulator`
- Modify: `scripts/ci-required-cases.json`: add this file's three case names

**Interfaces:**
- Consumes: `createRoute53DnsProvider(config:{zoneId:string;suffix:string}, client:Route53Client)` from `packages/remote-access/src/route53-dns.ts`.
- Produces: root script `test:aws-emulator`, exactly:
  `node --test --test-reporter=tap --test-reporter-destination=stdout --test-reporter=./scripts/ci-required-cases.mjs --test-reporter-destination=stdout --test-timeout=30000 packages/remote-access/test/emulator/*.test.ts packages/registration/test/emulator/*.test.ts`
  (Task 2 adds no script; its file is picked up by the second glob. `scripts/ci-required-cases-routes.test.mjs` accepts a required file only when a root script or package `test` script with this reporter names it through a `*.test.ts` pattern.)

Each case creates its own hosted zone (`CreateHostedZoneCommand`, `Name` = a fresh suffix such as `<8 random hex>.emulator.test.waitron.io`, `CallerReference` = `randomUUID()`), takes the zone id as the last path segment of `HostedZone.Id` (it matches the adapter's `/^Z[A-Z0-9]+$/`), and builds the provider with a `Route53Client({region:'us-east-1', endpoint, credentials})`. Read records back with `ListResourceRecordSetsCommand`; real Route 53 returns record names with a trailing dot, so compare names after removing one trailing dot (values are compared exactly). Challenge name: `_acme-challenge.staff-v-11111111-1111-4111-8111-111111111111.<suffix>`; token `'A'.repeat(43)`, newer token `'B'.repeat(43)`.

**Recording the propagation wait.** The client handed to the provider is wrapped so the test sees each command the adapter sends and, for `GetChangeCommand`, the `ChangeInfo.Status` it got back (wrap `client.send`, or add a `client.middlewareStack` step; either is fine). After `present` or `point` resolves, assert: at least one `GetChange` was sent; its statuses are zero or more `'PENDING'` followed by exactly one `'INSYNC'`, which is the last command sent. This is what fails if the adapter stopped waiting for `INSYNC`, which a record read-back alone cannot show.

- [ ] **Step 1: Write the test file with these three cases**

  - `emulator: a challenge TXT is published only after INSYNC, read back as one quoted value with TTL 60, and removed by its exact value`
    — `await dns.present(name, tokenA)` resolves; the propagation-wait assertion holds; the zone holds one TXT for `name` with `TTL === 60` and one value `'"' + tokenA + '"'`; `await dns.remove(name, tokenA)` resolves and sends no `GetChange`; no TXT for `name` remains.
  - `emulator: a remove with a stale value is refused and the newer challenge survives`
    — `present(name, tokenA)`; then write `tokenB` straight through an unwrapped client (UPSERT, same name, TXT, TTL 60); `await assert.rejects(dns.remove(name, tokenA), {name: 'InvalidChangeBatch'})`; `console.error` (mocked with `t.mock.method`) was called exactly once, with `'remote.dns_cleanup_failed'`; the zone still holds `'"' + tokenB + '"'`.
  - `emulator: a venue CNAME is pointed at its cell with TTL 60 only after INSYNC`
    — `await dns.point('staff-v-11111111-1111-4111-8111-111111111111.' + suffix, 'gw.cell-b.example.test')` resolves; the propagation-wait assertion holds; the zone holds one CNAME for that name with `TTL === 60` and value `'gw.cell-b.example.test'` exactly.

  All three take `{skip}` from the environment contract above.

- [ ] **Step 2: Add the root script and the three required-case entries**

  Entries are anchored names, as the file's other entries are: `"^emulator: a challenge TXT is published, read back as one quoted value with TTL 60, and removed by its exact value$"` and so on.

- [ ] **Step 3: Without an emulator, see the file skip and the CI command refuse**

  Run: `node --test packages/remote-access/test/emulator/route53-dns.test.ts`
  Expected: `ℹ skipped 3`, `ℹ pass 0`, each skip carrying the reason text above.
  Run: `pnpm test:aws-emulator`
  Expected: exit status not 0, with three `# Required case did not pass exactly once: <absolute path>/packages/remote-access/test/emulator/route53-dns.test.ts: …` lines.

- [ ] **Step 4: Against an emulator (optional local Docker run, otherwise CI in Task 3), see all three pass**

  Run: `pnpm test:aws-emulator` with the three variables set.
  Expected: `# Required cases: 3 passed`, `# fail 0`. Any failure here is a finding: stop and report (Global Constraints).

- [ ] **Step 5: Run the guards this touches**

  Run: `node --test scripts/ci-required-cases-routes.test.mjs scripts/ci-required-cases.test.mjs`
  Expected: `# fail 0`, with a non-zero `# pass` count.

- [ ] **Step 6: Commit**

  `git add packages/remote-access/test/emulator/route53-dns.test.ts package.json scripts/ci-required-cases.json && git commit -s -m "Test the Route 53 adapter against AWS Emulator"`

### Task 2: SQS adapter against the emulator

**Files:**
- Create: `packages/registration/test/emulator/ses-feedback-queue.test.ts`
- Modify: `scripts/ci-required-cases.json`: add this file's one case name

**Interfaces:**
- Consumes: `createSesFeedbackQueue(config, {credentials, requestHandler})` from `packages/registration/src/ses-feedback-queue.ts`; `config(region, country, providerAccountId)` from `packages/registration/test/fixtures/mail-attempt.ts`, called as `config('eu-north-1', 'ES', '000000000000')` (its `queueUrl` is `https://sqs.eu-north-1.amazonaws.com/000000000000/mail-feedback`); root script `test:aws-emulator` from Task 1.
- Produces: nothing later tasks use.

**The forwarding transport** (in the test file): an object `{handle(request, {abortSignal}), destroy()}` whose `handle` sends `request.method`, `request.path` (plus `request.query` when present) and `request.headers` unchanged, with `request.body`, through `node:https` `request` to `host: '127.0.0.1'`, `port` from `AWS_EMULATOR_ENDPOINT`, `signal: abortSignal`, `servername: ''`, and `checkServerIdentity: (_host, cert) => tls.checkServerIdentity('127.0.0.1', cert)`. It resolves `{response: {statusCode, headers, body: res}}`. Why the two TLS options: the signed `Host` header names `sqs.eu-north-1.amazonaws.com`, Node takes the TLS name from it, and the emulator's certificate names only `localhost`, `127.0.0.1` and `::1`. Measured 2026-11-18 on 1.0.512: without them `receive` refused with `ses_feedback_receive_failed`; with them it received and deleted a message. The CA check itself stays on, through `NODE_EXTRA_CA_CERTS`.

A direct `SQSClient({region: 'eu-north-1', endpoint, credentials})` creates the queue (`CreateQueueCommand`, `QueueName: 'mail-feedback'`) inside the case, sends the message and reads attributes.

- [ ] **Step 1: Write the test file with this one case**

  - `emulator: the adapter receives a sent message, sees nothing while it is in flight, and deletes it`
    — send `'synthetic envelope'` directly; `await q.receive(signal)` deep-equals `[{body: 'synthetic envelope', receiptHandle: <the handle>}]` with a non-empty string handle; a second `receive` returns `[]` (one 10-second long poll, inside the 30-second case limit); `await q.delete(handle, signal)` resolves; `GetQueueAttributes` reports `ApproximateNumberOfMessages === '0'` and `ApproximateNumberOfMessagesNotVisible === '0'`.

  Close the adapter in `finally`. The case takes `{skip}` from the environment contract. (A malformed-handle case was considered and left out: the adapter reports every failure, a broken connection included, as `ses_feedback_acknowledgement_failed`, so that case could not tell the queue's refusal from no answer at all, and the spec does not ask for it.)

- [ ] **Step 2: Add the required-case entry**

- [ ] **Step 3: Without an emulator, see the file skip and the CI command refuse**

  Run: `node --test packages/registration/test/emulator/ses-feedback-queue.test.ts`
  Expected: `ℹ skipped 1`, `ℹ pass 0`.
  Run: `pnpm test:aws-emulator`
  Expected: exit status not 0, with four `Required case did not pass exactly once` lines (three from Task 1, one from this file).

- [ ] **Step 4: Against an emulator (optional local run, otherwise CI), see all four pass**

  Expected: `# Required cases: 4 passed`, `# fail 0`.

- [ ] **Step 5: Confirm the package suite is unchanged**

  Run: `pnpm --filter @waitron-cloud/registration exec node --test --test-timeout=30000 test/ses-feedback-queue.test.ts`
  Expected: `# fail 0` and the same `# tests` count as on `main` (run it there first; it needs no database).

- [ ] **Step 6: Commit**

  `git add packages/registration/test/emulator/ses-feedback-queue.test.ts scripts/ci-required-cases.json && git commit -s -m "Test the SQS feedback adapter against AWS Emulator"`

### Task 3: The workflow and its documentation

**Files:**
- Create: `.github/workflows/aws-emulator.yml`
- Modify: `docs/ci-proof-selection.md`: one paragraph after the Kubernetes paragraph
- Modify: `CLAUDE.md`: in "What CI owns", "AWS and Kubernetes workflows start only for their declared paths" becomes "AWS, AWS Emulator and Kubernetes workflows start only for their declared paths"

**Interfaces:**
- Consumes: root script `test:aws-emulator` (Task 1); the environment contract above.

**Workflow shape.** Name `AWS Emulator tests`. Triggers: `pull_request` and `push` to `main`, each with this `paths` list, plus `workflow_dispatch`. No schedule: the emulator version is pinned, so a run on unchanged inputs repeats the last answer, and the path list names every input (a deliberate departure from the spec's "nightly", stated in the pull request).

```
- 'packages/remote-access/src/route53-dns.ts'
- 'packages/remote-access/src/manifest.ts'
- 'packages/remote-access/test/emulator/**'
- 'packages/remote-access/package.json'
- 'packages/registration/src/ses-feedback-*.ts'
- 'packages/registration/test/emulator/**'
- 'packages/registration/test/fixtures/mail-attempt.ts'
- 'packages/registration/test/fixtures/ses-feedback.ts'
- 'packages/registration/package.json'
- 'package.json'
- '*pnpm-lock.yaml'
- 'scripts/ci-required-cases.json'
- 'scripts/ci-required-cases.mjs'
- 'scripts/ci-setup-pnpm.mjs'
- 'scripts/ci-download.py'
- '.github/workflows/aws-emulator.yml'
```

The lockfile is written `'*pnpm-lock.yaml'` because `scripts/ci-setup-pnpm.test.mjs` reads any step-shaped line starting with `pnpm` as pnpm used before setup (the plan reviewer ran it: `'pnpm-lock.yaml'` fails the guard, `'*pnpm-lock.yaml'` passes). GitHub's `*` matches zero or more characters other than `/`, so it still matches the root lockfile; confirm on the pull request by checking that the run starts. Keep a one-line comment at that entry saying why.

There is no `summary` job and no stop step, deliberately: `ci.yml`'s `summary` covers only its own planned jobs, and the runner is discarded at the end of the job. `permissions: contents: read, packages: read`. Concurrency as in `kubernetes-proof.yml` (group `aws-emulator-<ref or run id>`, cancel in progress on pull requests). One job, `emulator-tests`, `runs-on: ubuntu-latest`, `timeout-minutes: 10`. Steps, in order:

1. `actions/checkout@v5`, `ref: ${{ github.event.pull_request.head.sha || github.sha }}`, `persist-credentials: false`.
2. Presence check (`id: presence`): when `packages/remote-access/test/emulator/route53-dns.test.ts` exists, write `present=true` to `$GITHUB_OUTPUT`. Otherwise write `present=false` and echo `Skipping: this head predates the AWS Emulator tests.` Every later step carries `if: steps.presence.outputs.present == 'true'`.
3. Node and pnpm exactly as the `packages` job in `ci.yml`: `actions/setup-node@v5` (`node-version: '26'`, `package-manager-cache: false`), `node scripts/ci-setup-pnpm.mjs` with the same `env`, the second `setup-node` with `registry-url: https://npm.pkg.github.com` and `scope: '@waitron-io'`, then `pnpm install --frozen-lockfile` with `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`. No dependency cache (Cloud's shared cache budget; a ten-minute job does not need it).
4. Install: download with `python3 scripts/ci-download.py --timeout 120 --attempts 2 --grace 10 --lock-wait 30 --retry-delay 5 -- curl -fsSL --connect-timeout 20 --max-time 110 -o "$RUNNER_TEMP/aws-emulator.deb" <pinned URL>`; then `echo "<pinned SHA-256>  $RUNNER_TEMP/aws-emulator.deb" | sha256sum -c -`; then install with `sudo python3 scripts/ci-download.py --timeout 120 --attempts 2 --grace 10 --lock-wait 30 --retry-delay 5 --lock /var/lib/dpkg/lock-frontend --lock /var/lib/dpkg/lock -- dpkg -i "$RUNNER_TEMP/aws-emulator.deb"`; then `aws-emulator -v`. No apt step: the package's control file declares only `Depends: libc6 (>= 2.17)` (read from the pinned `.deb` on 2026-11-18), which every Ubuntu runner has.
5. Start: `aws-emulator -p 9297 -t off --idle-timeout 900 > "$RUNNER_TEMP/aws-emulator.log" 2>&1 &`. Wait for `curl -fsS --cacert "$HOME/.aws/emulator/9297/ca.pem" https://127.0.0.1:9297/__admin/health` to print `ok`, for up to 60 seconds, else fail. Append the three environment-contract variables to `$GITHUB_ENV`.
6. `pnpm test:aws-emulator`.
7. `if: failure() && steps.presence.outputs.present == 'true'`: `tail -n 100 "$RUNNER_TEMP/aws-emulator.log"`. Never print the credentials file.

- [ ] **Step 1: Write the workflow**

- [ ] **Step 2: Run the repository's workflow guards**

  Run: `node --test scripts/ci-setup-pnpm.test.mjs scripts/ci-proof-inputs.test.mjs scripts/ci-scripts.test.mjs`
  Expected: `# fail 0`, with a non-zero `# pass` count. A guard that refuses the new file is satisfied by changing the workflow, never by weakening the guard.

- [ ] **Step 3: Write the documentation paragraph**

  In `docs/ci-proof-selection.md`, after the Kubernetes paragraph: the AWS Emulator workflow runs the two emulator test files on pull requests and `main` pushes touching its listed paths, and on demand; it installs version 1.0.512 checked by its SHA-256 and runs with telemetry off; the required `summary` check does not certify it, so read its result before merging; a head without the emulator tests skips it. In `docs/ci-nightly.md`, after the sentence saying Kubernetes prerequisites are separate, one sentence: the AWS Emulator tests are separate in the same way and have only a manual trigger besides their paths. Apply the `CLAUDE.md` one-line edit. Run `node --test scripts/ci-docs.test.mjs` and expect `# fail 0`.

- [ ] **Step 4: Check the backlog**

  Run: `grep -n -iE 'route ?53|sqs|fake' docs/backlog.md`. Rewrite only an entry that this branch's tests now prove. If none does, change nothing and say so in the handover.

- [ ] **Step 5: Commit, then the driver pushes and reads the run**

  `git add .github/workflows/aws-emulator.yml docs/ci-proof-selection.md docs/ci-nightly.md CLAUDE.md && git commit -s -m "Run the Route 53 and SQS adapters against AWS Emulator in CI"`
  On the pull request, the `AWS Emulator tests` run must start (which also confirms the `'*pnpm-lock.yaml'` entry is valid YAML GitHub accepts) and show `# Required cases: 4 passed` and `# fail 0` in its test step.

### Driver step (not an implementer task): the trial's answer

After the pull request's `AWS Emulator tests` run, the driver writes a section in the pull request description headed "What the emulator showed". For each of the four cases, it says whether the emulator agreed with what the fake-server suite assumes for that call, quoting the run, and lists any difference found while building. It ends with a keep-or-drop recommendation and its reason. That section is the answer to the owner's question; the pull request is not ready to land without it.
