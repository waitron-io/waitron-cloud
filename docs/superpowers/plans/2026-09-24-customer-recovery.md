# Guided snapshot recovery implementation

Execute inline under standing autonomous authority. Complete Cloud and Waitron companion
branches, then finish/land them without another approval pause. Use the existing local
backup runner and setup restore path; do not implement continuous recovery or live AWS.

1. Cloud request handshake: add `packages/backups/src/recovery-request.ts`, its tests and
   migration15. Signed fresh-target start/status proofs bind origin, request ID, public key,
   matching code and timestamp. Persist the code hash, expiry and failed attempts. Add
   owner inspect/approve with exact code checks and test-only snapshot selection. Extend
   BackupRecovery.start to participate in that caller transaction, keeping existing callers
   unchanged. Add a proof-bound metadata-only target action so the target can learn the
   approved digest without receiving secret keys. Test failure before implementation,
   exact retries, code lockout, cross-owner/venue and expiry at lock waits.
2. Cloud HTTP: add machine request/info/read/progress and owner inspect/approve/status/close
   handlers. Use live sessions, CSRF/origin, persistent rate limits and fixed public errors.
   Issue one-object restore grants through existing CaptureOptions, recheck target proof,
   owner authority and operation state after the storage wait, and return the archive key
   only. Update every migration-count assertion and startup migration guard. Test real
   PostgreSQL plus the scoped-storage fixture, including cancellation during grant issuance.
3. Cloud portal: capture the replacement's request link, show matching-code confirmation in
   snapshot history, require a verified snapshot and explicit stopped-server/data-loss
   acknowledgements, and show expiry/closure separately from restore completion. Reuse the
   backup selection/default and shared UI. Add delayed-reply/account-reset/uncertain-write
   controller tests and bilingual real-browser journeys. No keys or storage fields in
   browser responses; continuous recovery remains clearly unavailable in this local test.
4. Waitron target client: private fresh key/request state outside captured file lists;
   bounded control calls to configured Cloud origin; no browser-selected network targets.
   Signed metadata and read requests, HTTPS scoped download bounded by expiry/size, exact
   digest check, then return the artifact/key internally to existing stageRestoreRequest.
   Test restart, bad bindings/digests, cancellation, bounded download, expired approvals and
   no credentials in public view. Keep database activation out of the Cloud client.
5. Waitron setup: add a Cloud restore screen and API methods/routes through the existing
   setup operation serialization. Show code/link, refresh approval, inspect capture time,
   then explicit local restore confirmation. Reuse validated artifact staging and restart;
   do not report local restore complete at staging. Trace existing setup input/authentication,
   destructive operation gates, and recovery/restore hooks before wiring. Preserve existing
   file restore and all behavioral assertions. Run server and setup focused tests, real
   browser checks and boot wiring tests.
6. Extend `scripts/test-local-backups.mjs` with owner HTTP approval and real replacement
   client retrieval/staging/restore. Sources are stopped. Assert restored venue content,
   no Cloud re-enrolment/routing mutation, wrong-key refusal, bound one-object authority,
   restart/lost reply reconciliation. Keep all existing backup proof assertions.
7. Docs/backlogs: explain self-service steps, snapshot age and unavailable continuous/planned
   handover, credential lifetime and shutdown/retry bounds. Signed commits and one isolated
   run-it review per production branch; triage with receipts, clean-head local proof,
   current-head CI and normal merge/cleanup. No AGENTS.md in Waitron.

Review focus: transaction lock order, pairing-code attempts committed on refusal, target
identity reuse, key disclosure, authority revoked during grant/download waits, stale UI
crossing accounts, and falsely reporting staged data as an activated restored server.
