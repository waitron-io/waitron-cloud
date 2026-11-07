# Staff problem reports implementation plan

D603 implements [monitoring §§10,11,16](../specs/2026-10-24-cloud-monitoring-alerting-status-design.md): Cloud receiving/owner inspection. Documentation only; no usable runtime. Watcher authority, lane D questions 2026-11-07 14:21: “Write its one-page plan now and get the Claude read; build once lane K’s D601 lands, reusing D601’s table and cleaning.” No AI/triage runs, paging, mail, accounts, spending, production setup or Waitron implementation.

- [ ] Before build, obtain Claude's read through `~/workspace/tools/claude-seat.sh review-branch`. Await D601 PR1073's merge; re-read its landed contract and send material amendments for Claude review.

## Read-only inputs and provisional builder defaults

D601 candidate, not landed, `c0f96898c93b4fd1bcb53ee1e4548bc692b19886`: `docs/superpowers/plans/2026-11-07-box-error-reports.md`, `docs/box-error-reports.md`, migration `052_box_error_reports.sql`, `packages/{registration,account-http}/src/box-error-reports.ts`.

Waitron read-only `75a489b9dae5d356f72a5f44aa578e6e4013e868`: `docs/superpowers/plans/2026-10-22-a982-one-touch-problem-reports.md:61` bounds optional descriptions at 2000 Unicode codepoints/8 KiB; `docs/backlog/alerts.md:86` assigns forwarding/admin send to A1047. No runtime verified; do not forward A982's broader local bundle.

Provisional builder defaults, not owner decisions: signed `staff-report`/`staff-description` actions, corresponding `/api/installations/` POST routes, staff body ≤16384 bytes (automatic stays 4096), bounded allowlisted version/hosting/device/equipment/upgrade details, descriptions retaining both Waitron limits. Reuse D601 code/version validation and structural log cleaning: level/code/source only, no text.

## Inline TDD tasks

Each task: behavior tests, observed expected failure, minimal implementation, same tests passing; preserve checks. Read the TDD skill before code. Use synthetic fixtures and real PostgreSQL.

- [ ] **Store and receive.** Extend `packages/registration/src/box-error-reports.ts`; wire actions through `installation-proof.ts`, exports through `index.ts`, and routes through `packages/account-http/src/{box-error-reports,app}.ts`. Trace every action/table reader first. Append the next migration under `packages/registration/migrations/` and register in `src/migrate.ts`; never edit 052. Keep one `installation_error_reports` table: constrained automatic/staff row kinds, nullable staff description/details and description retry identity/digest; staff rows allow null code/source/occurrences and empty attachments. Preserve populated automatic rows/digests.
- [ ] Test `packages/{registration,account-http}/test/staff-problem-reports.test.ts`: absent description/logs/errors, duplicates/concurrent retry, changed-body conflict, durable-write failure, late description, tenant/environment isolation and revocation/key/lease expiry during waits. Reuse signed proof/current-lease parent/installation locks and rechecks. Bind venue/environment from authentication. Initial operation identifies the report; description action targets it with separate retry identity. Only Waitron admin send supplies description; add no Cloud permission. Acknowledge received promptly after commit. Manual attachments consent independently of automatic opt-in; preserve automatic privacy.

Run failure/pass: `node scripts/test-postgres.mjs exec node --test packages/registration/test/staff-problem-reports.test.ts packages/account-http/test/staff-problem-reports.test.ts packages/registration/test/box-error-reports.test.ts packages/account-http/test/box-error-reports.test.ts`

- [ ] **Owner work list.** Add `packages/operations/src/staff-problem-reports.ts` grouped reader and `staff-reports-cli.ts`; test `packages/operations/test/staff-problem-reports.test.ts`. Follow existing `src/cli.ts` fixed diagnostics. Explicit owner invocation selects environment and emits JSON stdout only. Exact environment+version+real attached-code matches join staff and D601 groups; unmatched reports remain individual. Count distinct staff reports across multiple codes, never sum overlapping groups. Exclude staff rows from every automatic release-incidence query. Test groups/errors, duplicate submissions, cross-environment grouping, unchanged release holds and hostile/free text confined to owner output, absent from logs/metrics/public feeds. No queue.

Run failure/pass: `node scripts/test-postgres.mjs exec node --test packages/operations/test/staff-problem-reports.test.ts packages/operations/test/cli.test.ts`

- [ ] Verify migration/retry preservation in registration's new suite, run `pnpm typecheck`, read test counts; CI owns package suites. No permanent mutation test. Update `docs/box-error-reports.md`, `docs/local-monitoring.md` and existing monitoring bundle in `docs/backlog.md`; remove completed D603 detail only when runtime lands, retaining broader monitoring work. Use `git commit -s`; announce ready for `finish-branch`, including Claude whole-branch run-it review and current-head CI.
