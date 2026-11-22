# Keep Test Cloud running when Compose replaces a container

An operator can change Test Cloud settings and restart the account even if a
container disappears between Docker's list and inspect commands. Unrelated
inspection errors and real resource, ownership and Waitron health failures
still stop the deployment.

On the local Linux test box, a normal settings restart passed. The controlled
rehearsal held a real container list until after Compose had removed the old
account and storage containers. Bootstrap exited zero. Docker returned two
`no such object` lines, and the monitor cancelled Compose before the new account
started. The Stockholm helper discarded the original error message, so the
hosted failure's cause remains unknown.

1. In the private pairing-window rehearsal, pass a wrapper through the driver's
   existing `execute` option. Report the failed command and its error and
   rethrow the original. Prove this on the disposable synthetic fixture. Keep
   raw output in that rehearsal's receipts. No credentials or environment
   contents go into logs. The deployment driver's public output stays as it is.
2. Add two tests in `scripts/test-cloud-deploy.test.mjs`. The first supplies
   Docker's observed missing-ID error with partial output and asserts that
   inventory returns the replacement container and its health from one fresh
   list and inspect. The second verifies that mixed or unrelated errors and a
   missing protected Waitron container still fail. If the fresh read fails,
   propagate that error without another retry. Watch the first test fail before
   editing the driver.
3. In `scripts/test-cloud-deploy.mjs`, retry only the list and watched-container
   inspection, once, when inspect exits 1 and every stderr line names an exact
   missing ID from the inspected Cloud project rows. Exclude the protected
   Waitron names. Discard the partial output and use the existing guard on the
   fresh inventory. Use the same ownership checks, deadlines and cleanup.
4. Run `node --test scripts/test-cloud-deploy.test.mjs scripts/test-cloud-project-admission.test.mjs`.
   Run `node --test deploy/test-cloud/deployment.test.mjs` through the test-box
   helper and repeat the disposable Compose replay. Check that the replacement
   account starts and cleanup leaves no fixture resources. Add the verified
   result to the existing LAN test Cloud entry in `docs/backlog.md`. Stockholm
   stays parked until a fix lands.

Expect 25–40 implementation lines and 45–70 test lines, plus a short backlog
note and the private rehearsal adjustment. The PR uses the existing driver and
test files and adds no dependency.
