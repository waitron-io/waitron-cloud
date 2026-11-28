# D530 mail fixture timeout diagnostics

Proposed diagnostics for two SQL timeouts, pending watcher clearance. D530 stays open for root repair under `~/waitron-campaign-shared/ci-failure-rule.md`. The 28 November 11:35 watcher handoff asked Lane J to read #1452 diagnostics and find the cause. [Earlier plan](2026-11-27-d530-migration-setup.md)

Main Standard CI run 46134889343, attempt 1, shard 2, head `15eb314ecc5c23474164beb4591757d3b2796710`, logged `57014` during migrations 035 and 038 in `ses-feedback-store.test.ts`. Both cases used the bare migration runner through `mail-attempt.ts`. The log contained zero `cloud-test-setup-waits` events. The separate Sent reports deadline had no stack identifying its wait. [Job 140947986646](https://github.com/waitron-io/waitron-cloud/actions/runs/46134889343/job/140947986646)

Each shard starts its own disposable PostgreSQL server. Three file workers shared the baseline server. PostgreSQL 18.7 used `fsync`, `full_page_writes` and `synchronous_commit`, all on, with `fdatasync` and one ext4 mount for data and write-ahead logs. All 278 cases passed. Across 386 samples, no process showed `WALWrite` in consecutive half-second samples. Disk-pressure comparison is in progress. [Job 140951611723](https://github.com/waitron-io/waitron-cloud/actions/runs/46136091691/job/140951611723)

After clearance, switch the `migrate` import in `packages/registration/test/fixtures/mail-attempt.ts` to `./setup-waits.ts`. The wrapper samples during setup, stays silent on success and adds a bounded activity snapshot after a statement timeout.

Reuse the disposable server control that delayed this fixture’s `CREATE TABLE` by six seconds. The fixture returned `57014` and logged the migration stage. The snapshot assertion failed. After the import change, require all three. Run the eight `setup-wait-diagnostics.test.ts` cases and the ten files that call `fixture()`, including `mail-attempts.test.ts` and `ses-feedback-store.test.ts`. The emulator imports only `config`. Preserve production code, migrations, settings, test behaviour, shard selection, checks and deadlines. Update D530 in `docs/backlog/worker-scheduling.md`.

Estimate one import line, zero new test-support lines, zero permanent test lines and four backlog lines.

To support a root cause, match the migration’s live wait and any blocker to server activity and disk timings, then reproduce the wait and timeout with one factor varied against a matched control.
