# Read a gzip-compressed authorised backup in the Cloud fixture

The Cloud fixture should read the manifest from a new Waitron backup and continue
through verification, ordinary restore, and both refusal checks. The same
fixture still runs with the pinned `8eed667ab058` verifier image, whose backup
writer emits an uncompressed archive. Waitron #3245 added gzip before encryption.

1. Use `deploy/test-cloud/test-fixtures/snapshot-authorised-archive.test.ts` as
   the regression test. On Waitron #4108 and its exact base, the current fixture
   fails at the archive header before verification. Run the existing test in an
   isolated Linux copy with `pnpm exec vitest run
   src/cloud-authorised-archive.test.ts --maxWorkers=1` from `apps/server`.
2. In that fixture, decrypt once, detect gzip by its header, and use Node's
   `gunzipSync` before the existing manifest lookup when the header matches.
   The older uncompressed bytes go directly to the existing unpacker. Keep using
   the original encrypted bytes for verification, delivery and restore. Keep
   every assertion, timeout, image pin and Waitron source file as it is.
3. Run the fixture with the current writer and the pre-compression pin to check
   both forms. The same case owns verification, ordinary restore and the two
   refusal checks. Run `node --test scripts/ci-docs.test.mjs` for the backlog edit
   and let Cloud CI run the selected suites. After landing, run the merged
   fixture against #4108's exact head and post the command, count and result.

Update `docs/backlog.md` under Recovery deployment qualification to record which
format the local authorised fixture exercises while keeping deployment checks
open. Expect roughly 6 added and 1 removed fixture lines, up to 4 added backlog
lines, and zero production lines or new test cases.
