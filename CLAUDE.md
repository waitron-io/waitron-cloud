# Waitron Cloud — working notes

Waitron Cloud is the paid service around Waitron: remote access, backups and recovery, hosted
instances, bookings and reporting for venues. **Waitron** is the point-of-sale application a venue
runs. It lives in a separate repository, `clintongormley/waitron`, and owns the tills, tax filing
and local backup and restore. Cloud owns the managed service, its infrastructure, its accounts and
its own backlog. [documentation-ownership.md](docs/documentation-ownership.md) gives the split topic
by topic, and the [integration contract](docs/waitron-integration-contract.md) covers what passes
between the two.

**No Cloud service is deployed.** Everything proved so far was proved locally
([launch-evidence.md](docs/launch-evidence.md)).

Waitron's own `CLAUDE.md` does not apply here, and neither do its commands: this repository has no
`wa-wt`, no `pnpm reap` and no Drizzle.

Each rule below is the rule, what it cost where that is known, and a pointer. Each says what enforces
it. "Nothing enforces this" means only people reading the change will catch a mistake.

## What makes a mistake here expensive

1. **The repository is public, and nothing scans it for secrets.** Anyone can read a commit at once,
   and it stays in Git history. GitHub's secret scanning is switched off here and no workflow scans.
2. **`main` has no protection.** There is no branch protection and there are no rulesets, so GitHub
   will merge a pull request with failing checks. Reading CI yourself is the only gate.
3. **A provider call can spend money or reach a real person.** See the safety limits.
4. **A migration that has run cannot be changed.** See Migrations.
5. **This code decides who can reach a venue's data and who can recover it.** Losing a key loses the
   backup: "An encrypted S3 copy cannot recover an application key that you never copied"
   ([aws-infrastructure.md](docs/aws-infrastructure.md)).
6. **A sentence can become a promise.** A local proof says nothing about a production account. Keep
   the two apart, as [launch-evidence.md](docs/launch-evidence.md) does.
7. **Two repositories have to agree.** Check Waitron before treating a question as new, and check its
   open pull requests as well as its `main`, because the interface you need may already be under
   review. Cloud reuses Waitron's restore engine, restore checks and bucket setup rather than
   building competing ones ([documentation-ownership.md](docs/documentation-ownership.md)).

## Safety limits

- **Get the owner's separate approval before "accessing AWS, creating accounts or resources, spending
  money or applying infrastructure"** ([aws-infrastructure.md](docs/aws-infrastructure.md)). Passing
  checks is not that approval. Enforced by `deploy/aws/check.mjs`, which requires every OpenTofu test
  run to say `command = plan` with a mocked provider, and by no workflow holding an AWS credential:
  `GITHUB_TOKEN` is the only secret any of them uses. Weaker than it sounds: the checker reads test
  source, and nothing stops someone with credentials running `tofu apply` by hand.
- **No production deployment.** Local receipts "do not qualify a production deployment"
  ([launch-evidence.md](docs/launch-evidence.md)). Nothing enforces this beyond the rule above.
- **No real email.** Use Mailpit, the local test inbox. `CLOUD_MAIL_TRANSPORT=smtp` is for an approved
  relay, and no provider account or sender is configured. Nothing enforces this.
- **No real data in the repository, tests, fixtures, logs or pull request text: no customer data, and
  no real account IDs.** Use synthetic data. The one exception is the cost measurement in
  [its design](docs/superpowers/specs/2026-10-14-cloud-cost-model-design.md), which runs in an isolated
  local network and keeps raw data on the owner's machine. Nothing enforces this across the repository.
- **No secrets in commits, pull request text or logs.** `.gitignore` covers `.env` and `.env.*`, and
  `.env.example` is the template. Nothing checks anything else.
- **Nothing goes to an AI provider.** `createOpenAiClient(...).respond(...)` always refuses without
  sending a request, even for harmless-looking menu text, until the owner accepts a privacy rule and
  supplier evidence ([translation README](packages/translation/README.md)). Enforced by
  `packages/translation/test/outbound-disabled.test.ts`. Tests use a fake server on loopback.
- **Tax rules stay in Waitron.** Never change invoice allocation, hash chains, immutable fiscal
  records or expected fiscal results from work here, in either repository: stop and ask the owner.
  Cloud's fiscal registry is retired; migration 038 and its dormant rows stay
  ([fiscal-allocation-registry.md](docs/fiscal-allocation-registry.md)).
- **Do not change a test's check to make it pass** (owner, 2026-10-05). Change one only when the spec
  deliberately changes what it checks, at least as strictly as before. Stop and ask if the check
  broke as a side effect, if the change deletes or weakens it, or if it is a security, tenant
  isolation, permission, key or recovery-authority check whose new value the spec does not spell
  out. List every changed check in the pull request under "Changed test checks". Nothing enforces this.
- **Build nothing new on a Waitron "location"** (owner, 2026-11-01). Waitron is removing the idea: one
  venue is one box. Leave any existing read alone and tell the owner when your work touches it.

## Where things live

| Path | What it holds |
| --- | --- |
| `packages/` | Backend packages. `ui-smoke` tests the shared UI package |
| `apps/portal/` | The account portal, in English and Spanish |
| `deploy/` | AWS infrastructure, Kubernetes, and the local and test stacks |
| `scripts/` | CI planning, local proofs and the cost model |
| `docs/backlog.md` | What to work on. Long detail goes in `docs/backlog/` |
| `docs/superpowers/specs/`, `docs/superpowers/plans/` | Designs and plans, committed deliberately |
| `docs/reference/` | Historical documents. An "approved" heading there is not a current approval |
| `docs/receipts/` | Saved measurement results. CI treats these as data, not prose |

- **Update `docs/backlog.md` in the same pull request.** Rewrite the entry to say what is now proved
  and what stays open, and delete text that is no longer true. Nothing enforces this.
- **Fix loose ends; do not file them** (owner, 2026-11-06). A small thing found while working or in
  review is fixed in that pull request. If it really cannot be, it joins an existing backlog entry.
  It gets its own entry only if a person would notice it, it could cost money or a filing, or it
  breaks a written rule.
- **Shared screen controls come from Waitron** as the private package `@waitron-io/ui-core`. A
  Dependabot pull request for it is expected to fail until you update the smoke test and renew the
  review records ([shared-ui-release.md](docs/shared-ui-release.md)).

## Running things

Use Node 26 or later and pnpm 9.15.0 (`package.json`; CI uses Node 26). Installing needs
[GitHub package access](docs/shared-ui-release.md#install-locally). There are no Git hooks here,
so nothing runs when you commit or push; older plans that mention a pre-push hook are out of date.

```sh
pnpm typecheck
# One package's tests against a throwaway PostgreSQL and Mailpit (needs Docker):
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/monitoring.test.ts
# One whole package:
node scripts/test-postgres.mjs --filter @waitron-cloud/identity test
# Scripts that need no database:
node --test scripts/ci-docs.test.mjs
```

`pnpm test` runs every package's tests one package at a time. It does not run the `scripts/` tests.
For the whole local stack, follow [local-deployment.md](docs/local-deployment.md).

- **Name the test files you mean.** A bare `node --test` searches every folder under where you are.
  Cost: on 2026-11-04 a review ran one from near the top of the Mac, and about 5,900 other people's
  test files ran. Nothing enforces this.
- **Read the test count, never just the exit status.** `pnpm --filter <mistyped name> test` prints "No
  projects matched" and exits 0, having run nothing.
- **Use the real database wherever locking or transactions matter**, through
  `scripts/test-postgres.mjs`, which gives each run its own container and random port.
- **For AWS infrastructure, follow [aws-infrastructure.md](docs/aws-infrastructure.md).** A native
  `tofu` run on a Mac is early feedback only; the pinned workflow has to pass before you finish.

## What CI owns

- **Run focused tests while you work; CI owns the full package suites** (owner, 2026-10-18). Do not run
  everything locally before a push. The repository is public, so GitHub's standard runners bill
  nothing. Run a whole package only when chasing a failure.
- **A pull request runs only what its changed files select**: the changed package and one level of
  packages that use it ([ci-package-selection.md](docs/ci-package-selection.md)). The cost and venue
  proofs select separately ([ci-proof-selection.md](docs/ci-proof-selection.md)). A green pull request
  says nothing about what was not selected.
- **The nightly run at 03:17 UTC runs everything** ([ci-nightly.md](docs/ci-nightly.md)). Start one with
  `gh workflow run nightly.yml --ref main`.
- **A change to anything but prose must carry renewed review records, or CI fails.** Follow
  [ci-root-input-ownership.md](docs/ci-root-input-ownership.md), then
  [ci-documentation-audit.md](docs/ci-documentation-audit.md). Enforced by `scripts/ci-root-review.mjs`
  and `scripts/ci-docs.mjs --audit`.
- **Prose means ordinary Markdown at the repository root or under `docs/`.** A prose-only pull request
  runs just `changes`, `documentation` and `summary`. A README inside a package, `docs/receipts/`,
  `docs/waitron-integration-contract.md` and `docs/cloud-cost-model.md` are not prose.
- **Do not edit `docs/cloud-cost-model.md` or `docs/cloud-cost-calculator.html` by hand.** Rebuild them
  with `node scripts/cloud-cost/cli.mjs build`. `pnpm test:cloud-cost` checks that they match.
- **A branch can fail on a file it never had.** GitHub runs a pull request with main's workflows but
  `ci.yml` checks out the branch's own files. A new workflow that names a repository file must leave
  out older branches that lack it; try it on a live, unrelated pull request.

## Migrations

- **Migrations are hand-written SQL in `packages/registration/migrations/`, listed in `migrationNames`
  in `packages/registration/src/migrate.ts`.** No other package has any. Tests pin the number and the
  latest names, so a new migration updates them too.
- **Never edit one that has landed, not even a comment.** `migrate` compares each file's digest with
  the one stored when it ran, and refuses with `Applied migration has changed`. Weaker than it
  sounds: it can refuse only on a database that already ran that file. Tested 2026-11-06: a comment
  edit was refused on such a database and accepted on a fresh one.

## Landing and review

- **Work on a branch in its own worktree:** `python3 ~/workspace/tools/worktree.py new cloud <branch>
  --headless`.
- **Sign off every commit with `git commit -s`, and never run `gh pr update-branch`**: its merge commit
  carries no sign-off. Nothing enforces sign-off.
- **One pull request per change, and each leaves `main` working on its own.** If it cannot land without
  the next one, it is cut wrongly.
- **Before landing, read every job of every workflow that ran on the current head.**
  `gh run view <id> --json jobs` shows them; `cancelled`, `queued` or `in_progress` is not green, and
  a skipped job needs a reason from the planner. CI's `summary` job (`scripts/ci-summary.mjs`) checks
  that the planned jobs ran, but only for its own workflow, and nothing makes GitHub wait for it.
  Never merge red.
- **After merging, read the run for the exact merge commit** and follow
  [ci-merge-evidence.md](docs/ci-merge-evidence.md). A green label on `main` proves nothing by itself.
- **A pull request that is only behind `main` is not rebased for that alone** (owner, 2026-11-01).
  Rebase when it conflicts, when `main` changed a code file it also changed, when a workflow on `main`
  calls a file it lacks, or when it is a code branch opened before #965.
- **Every branch except a documentation-only one gets a whole-branch review that runs the code, from
  the model that did not write it.** Claude also reads any plan Codex writes, before the build starts
  (owner, 2026-11-06). Every review opens by asking whether the change should exist and what the
  simplest alternative is.
- **Build what was asked, the simplest way that works** (owner, 2026-11-06). Add no record, ledger,
  protocol, proof system, deadline or approval step the work does not ask for. Cost: the owner
  cancelled #1018 and its build-evidence plan for a one-page replacement.

## Writing claims

- **A sentence about behaviour names the command that was run or a `file:line`.** Otherwise it says
  "assumption". Reading is not verification: run it, and say so when a review only read.
- **State the experiment, not the conclusion.** "Proved locally" means only that.
- **"Pre-existing", "harmless" and "unreachable" are claims.** Check with `git log` first.
- **A correction is a new claim** and gets the same scrutiny as the text it replaces.
- **A test failure is evidence.** It is never a reason to remove an assertion or weaken an ownership
  check.
- **A behaviour change updates every guide it makes stale, in the same pull request.**
- **Comments state an invariant or a non-obvious reason, never history.** History belongs in the commit.
- **Write commits and pull requests in plain English** and define any term a reader would have to
  decode.
- **Product text is as short as the meaning allows, in English and Spanish** (owner, 2026-10-09).
- **Look at every visual change:** English and Spanish, light and dark, 390 and 1280 wide.
  `apps/portal/test/accessibility.test.ts` covers both languages and both themes, but only at 375 wide.

## This file

Claude maintains this file (owner, 2026-11-06). Codex reads it too, through a fallback setting in its
own configuration. If it looks wrong, say so rather than working around it.

**Never add `AGENTS.md`, `AGENTS.override.md` or `.codex/` to this repository.** Codex reads
`CLAUDE.md` only when no `AGENTS.md` is there, so one such file silently hides everything here. A
Codex hook refuses writing `AGENTS.md` at the repository root. It is weaker than this rule: tested
2026-11-06, it let `AGENTS.override.md` and `.codex/` through, and no check in this repository looks
for any of them.

Add a rule when a defect could recur or a trap costs real time, in the shape used above. Check it
against the repository first. A count goes stale, so describe the property instead. Delete rules that
stop being true.
