# Customer remote-access setup implementation

Execute inline under standing autonomous authority. Design: customer remote-access setup.

1. Add HTTP regression tests in `packages/account-http/test/remote-access.test.ts` using
   real migrations, owner signup/login and operator-provisioned placements. First request
   to `/api/account/remote-access/status` must fail before the route exists. Cover the
   authority and DNS-wait races named in the design.
2. Add public status/instructions/apply handlers in `packages/account-http/src/remote-access.ts`.
   Extend `RemoteAccessStore.setHostname` with a transaction-local authorization callback;
   preserve existing callers and add a package export/dependency. Wire a bounded DNS resolver
   into the account app as an internal test seam. Verify focused HTTP and placement tests.
3. Add `remote-controller.ts`, `remote-types.ts`, `remote-screen.ts` and focused failing
   controller/browser tests under `apps/portal`. Integrate with account/venue reset and
   request validation, use shared UI controls and English/Spanish copy. Validate only
   display metadata, not operator fields. Confirm then apply a revision-bound hostname.
4. Run real bilingual mobile browser journeys, accessibility and overflow checks; inspect
   screenshots, run scoped types and update `docs/local-remote-access.md` and backlog.
5. Signed commits, initial rebase, one isolated Claude run-it review, fix findings using
   reproductions, push normally, verify current-head CI, merge and clean up.

Review focus: owner loss during DNS; stale revision; delayed response crossing accounts;
custom name occupying operator namespace; false-ready status before certificate install.
