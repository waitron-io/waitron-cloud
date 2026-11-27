# Set up venue email signing after owner save

A Connected or Hosted test owner saves a sending address and gets the DNS alias to publish. Once it resolves, the existing test email worker sets up and verifies signing with fake providers. This is the next step of the [Cloud plan](2026-11-25-paid-venue-email-cloud.md#2b-show-verified-domain-records).

## Use the saved address

The owner receives the first alias in the save response, so the setup needs another chance after DNS changes. Use the choice already stored by `packages/account-http/src/venue-email.ts`. Run one serial signing pass in `deploy/test-cloud/email-worker.mjs` through its existing worker loop and one-shot path. Keep save and **Refresh status** independent of provider calls, which can wait up to 75 seconds for a Route 53 change. The tick still confirms that the alias resolves.

Enable the pass only in test venue levels with explicitly injected signing settings and fake SES, Route 53 and DNS from the local test harness. The default worker starts without signing. Read test venues with a saved selector and a domain on the test allowlist, in stable order. Run each once per pass and wait a minute between passes. Log the venue ID on a failed attempt and continue. On shutdown finish the current attempt before closing the pool.

Reuse [the signing operation from #1456](2026-11-27-paid-venue-email-signing.md) for eligibility, exact alias and key checks, and holds after uncertain writes. The saved address and claim are the only persisted state. If the venue changes domains, reuse the operation's exact retirement of that venue's older claim and pick up the new alias on the next pass. Use the existing [operator procedure](../../test-cloud-service-controls.md#investigate-held-venue-email-signing-cleanup) for held claims or venues without a saved address. General listing and key rotation can wait. Live provider wiring, portal signing status, and using the venue's From address and falling back to Waitron are later work.

## Prove the owner flow locally

- In `deploy/test-cloud/free-services-relay.test.mjs`, add **Owner save reaches signing after the exact alias is published**. Save through the owner route and finish a worker pass with no DNS match. Check that no provider writes occurred. Set the fake resolver to the alias returned by the route and run the worker again without a refresh. Check the matching claim, identity and key and the absence of duplicate writes on rerun. Reuse `packages/remote-access/test/fixtures/venue-mail-signing.ts`.
- In the same file add **A changed domain retires the old claim before signing the new alias**. Check one pass retires the exact old claim and the next sets up the new choice.
- In `deploy/test-cloud/email-worker.test.mjs`, check that the signing pass stays off by default and drains its active attempt on shutdown. The existing signing tests own uncertain provider writes and the existing route tests own alias statuses.

Run the new cases red, then green. Use `scripts/test-postgres.mjs` for the owner cases and run `pnpm typecheck`. Update the [backlog](../../backlog.md#venue-email-from-cloud-sent-as-the-venues-own-domain), the [setup guide](../../backlog/venue-email.md#set-up-the-sending-domain) and the linked Cloud plan with what the local test proves. Estimate 55–90 implementation lines and 105–150 test lines. Check the test diff during the build and stop before 225 added test and fixture lines for a watcher decision on any growth.
