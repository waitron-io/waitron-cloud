# Retire CI diagnostics: D613 B

**Authority:** watcher 2026-11-08 15:58 approved the simpler direction, including password/relay faults moving from affected PRs to nightly. A landed #1105; B stands independently. Driver commits this plan, obtains one Claude source read and watcher approval **before build**. This plan grants neither.

**Outcome:** fewer affected-PR jobs, with every retained check owned by root/nightly. Readings only; runtime unverified. Root discovery is at `.github/workflows/ci.yml:177`; existing mutations ownership/12-minute limit at `.github/workflows/nightly.yml:44`.

**Exact edit scope:**

- Delete `.github/workflows/download-supervision-diagnostic.yml`, `.github/workflows/password-derivation-diagnostic.yml`, `.github/workflows/relay-counter-diagnostic.yml`; modify `.github/workflows/nightly.yml`.
- Modify `scripts/ci-download-linux.test.mjs`, `scripts/ci-download-diagnostics.test.mjs`, `scripts/ci-pnpm-diagnostics.test.mjs`, `scripts/ci-cache-location.test.mjs`, `scripts/ci-reuse-workflow.test.mjs`, `scripts/ci-workflow.test.mjs`.
- Update only stale current descriptions/remaining-work sentences in `docs/ci-nightly.md`, `docs/ci-merge-evidence.md`, `docs/backlog.md`, `docs/backlog/linux-download-supervision.md`, `docs/backlog/ci-pnpm-setup.md`, `docs/backlog/ci-cache-saving.md`. No finished narrative, new backlog entry or historical rewrite.

- [ ] **RED:** retarget owning diagnostic tests to the retained program; add nightly wiring checks in the existing workflow test. Run `node --test scripts/ci-{download-linux,download-diagnostics,pnpm-diagnostics,cache-location,reuse-workflow,workflow}.test.mjs`; observe expected failures and counts before moving anything. Remove only deleted-workflow rows from the three current-path reader lists; retain every surviving assertion.
- [ ] **GREEN:** preserve one literal download shell/Python program in the Linux test: 32 stale cases, eight workers, one CPU, 15 seconds/case. Retain nine modes/exact outcomes; diagnostics must exercise that actual program with every failure, timeout, log and count assertion. Move password/relay inline Python unchanged into existing mutations steps, retaining baseline, restoration, assertions and always-uploaded artifact logs. No new runner, selector, framework, jobs, wrappers or permanent self-mutation tests; package tests unchanged.
- [ ] **Qualify:** focused tests/counts, current-head hosted root contention and nightly real-PostgreSQL faults, normal Claude run-it, every current-head job, signed landing and exact-merge evidence. Report changed test checks and matched PR/merge job minutes.

Keep historical download reuse/native-plan/summary/evidence/source/fallback contracts and `scripts/fixtures/ci-execution-inputs.json` untouched. No `ci.yml`, browser-reconnect, D615 apt, weekly-cost C, cache/pin, app, CLAUDE/AGENTS/.codex changes; no local Docker/provider/real mail.

**Estimated lines added/deleted:** code +0/−0; tests +65–100/−10–20; workflows +130–155/−404; docs +35–60/−20–40. Driver-supplied `gh run view --json jobs` samples: mutations 42492693744/job128768290572 204s total; password 42342052596 45s/fault-step; relay 41842286340 24s/fault-step. Hosted rehearsal decides fit; no unmeasured timeout increase. **PR budget:** 180 minutes excluding watcher wait. No unresolved design decision; runtime qualification remains open.
