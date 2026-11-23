# Read a gzip-compressed authorised backup in the Cloud fixture

The existing Cloud fixture should reach the verifier, ordinary restore and both
refusal checks on current Waitron. The same fixture runs with the pinned
`8eed667ab058` verifier image, whose backup writer emits an uncompressed archive.
Waitron #3245 added gzip before encryption.

1. Use `deploy/test-cloud/test-fixtures/snapshot-authorised-archive.test.ts` as
   the regression test. It fails with `bad_magic` before verification on Waitron
   #4108, its exact base `2d69e1a3095a`, and current Waitron main `9ec25b111151`.
2. In that fixture, decrypt once. Use Node's `gunzipSync` before the existing
   manifest lookup when the decrypted bytes start with `0x1f, 0x8b`. Send older
   uncompressed bytes directly to the existing unpacker. Use the original
   encrypted bytes for verification, delivery and restore. Keep every assertion,
   timeout, image pin and Waitron source file as it is.
3. Run the fixture on the exact #4108 base and on the pinned source
   `8eed667ab0586a3144ed7911b57cf50fcb3b0766` before opening the Cloud PR. In an
   isolated Linux copy of each commit, generate its release metadata and run
   `pnpm --dir apps/server build`. Mount the copy at `/waitron` and the Cloud
   fixture at `/waitron/apps/server/src/cloud-authorised-archive.test.ts`, both
   read only. With networking disabled, run `pnpm exec vitest run
   src/cloud-authorised-archive.test.ts --maxWorkers=1` from `/waitron/apps/server`.
   Report any failure beyond manifest lookup before expanding the repair. Both
   passes and green Cloud CI are required for landing. Cloud CI does not run
   this image-backed case. After landing, repeat the same run against #4108's
   exact head and post the command, count and result there.

This changes one fixture, about 5 added lines and 1 removed line. No production
code or new cases. There is no backlog entry for this fixture repair.
