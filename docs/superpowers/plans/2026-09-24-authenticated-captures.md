# Authenticated captures implementation plan

Use superpowers:executing-plans inline with TDD and finish-branch/land-branch.
Spec: ../specs/2026-09-24-authenticated-captures-design.md.

1. Add failing HTTP tests in `packages/account-http/test/captures.test.ts` using real
   registration/leases and PostgreSQL. Implement `packages/backups/src/captures.ts`,
   catalogue mutation fences and the two signed machine actions. Add HTTP routing and
   explicit optional server configuration. Run focused capture/catalogue/lifecycle tests.
2. Add Waitron `apps/server/src/cloud-backup.ts` and its focused Vitest suite. Expose
   reserve/publish through the existing connection write gate; upload with scoped S3
   credentials. First assert failure for unbound responses and HTTP/storage refusals.
   Keep the archive/UUID caller-owned for retry. No automatic capture scheduling yet.
3. Update the existing real local backup runner to use the Waitron client and new HTTP
   authority. Run the two-server encrypted snapshot/restore proof, including exact retry,
   key rotation and revoked credential renewal. Preserve original content assertions.
4. Update both backlogs/runbooks, commit with sign-off, rebase and run one isolated
   Claude run-it review per branch. Triage with RED/GREEN, push through hooks, verify
   exact-head CI, land and remove managed worktrees/branches.

Review focus: lease expiry while locks/storage block; interrupted upload versus an
object that contains different bytes; destination/identity substitution; accidental
persistence or logging of secrets; continued issuance after service disable/revocation.
Each belongs to the focused tests in steps 1–3.
