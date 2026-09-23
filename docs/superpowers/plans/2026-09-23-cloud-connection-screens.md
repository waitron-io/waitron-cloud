# Cloud connection screens implementation plan

> Use superpowers:executing-plans inline. Owner delegates decisions and authorises
> finish/land in both repositories without further questions. This is programme task 2.

**Goal:** connect two real Waitron installations through their local manager and Cloud account screens.
**Architecture:** local server signs task 1's version 1 exchange after live manager checks;
Cloud's `/connect` screen records the Cloud half, and Waitron requires the final confirmation.
**Tech stack:** Hono, Node crypto/filesystem, Waitron SQLite/identity, Lit shared UI, Chromium.
**Spec:** `2026-09-23-cloud-connection-screens-design.md` copied into each repository.

## Global constraints

- Local integration only, no AWS resources, no fiscal/payment calls.
- Private key remains on the installation; no Cloud password enters Waitron.
- Derive venue from provisioned location. Production maps to production; preproduction/dev maps to test.
- Only `system.manage` on the serving primary may start/complete. Status reads are passive.
- Existing operation survives a lost reply; no automatic completion or background mutation.
- English and Spanish, shared controls, actionable failure/expiry states, phone accessibility.
- Follow each repository's focused local checks and current-head CI; signed-off commits.

## Review focus

- Losing local authority during a slow Cloud read must prevent completion signing.
- Reload, language change or another Cloud login must not silently approve a pending request.
- Bad Cloud response/redirect/body must not overwrite a saved local identity or selected business.
- Restart or lost completion reply must recover the recorded request, not issue a new identity.
- Mirrors, fenced/secondary nodes and ordinary staff must not register as the primary.

### Task 1: Cloud confirmation screen

Cloud files: `apps/portal/src/{app,links,api,locale,screens}.ts`, new pairing controller/view,
`packages/account-http/src/portal.ts`, browser tests and docs.
Produces `/connect#request=<uuid>` fragment capture and a session-bound code/business form.

- [ ] Write tests for fragment scrubbing, malformed/duplicate/wrong-route IDs, login then return,
  only permitted business choices, retained code on language switch, code refusal, no automatic
  approval, stale reply after logout/account switch, lost reply/retry and expired sessions.
- [ ] Run failing tests; implement a separate pairing controller with generation fencing.
  Request `/pairing/businesses`, `/inspect`, `/approve` through the same-origin account helper,
  which adds CSRF for pairing POSTs and validates response shapes.
- [ ] Render shared controls, error summary/focus and explicit approve action. One business is
  selected by default; multiple choices show organisation and business. Do not infer attempts left.
- [ ] Run browser/API tests and typechecking. Keep the branch for the cross-repository proof.

### Task 2: Waitron local adapter and screen

Waitron files: new `apps/server/src/cloud-{client,state,api}.ts` and tests; config/errors/boot;
new `apps/dashboard/src/screens/cloud-services-screen.ts` and browser/a11y tests;
API client/shell/navigation/i18n, docs/backlog and local configuration example.
Produces GET local status, POST start and POST complete under `/management-api/cloud`.

- [ ] Write real SQLite/session tests for anonymous/staff/suspended/expired and non-primary
  refusal, derived venue identity and environment, passive reads, session recheck before signing.
- [ ] Add client tests against an actual HTTP test server: correct signature vectors, strict
  response binding, timeout/redirect/oversize/HTTP refusal, stable key and operation across restart,
  duplicate calls and discarded completion reply. Observe RED before implementation.
- [ ] Persist private key and pending state before network writes, with restricted permissions
  and atomic file publication. Serialize local operations; fail closed on corrupt state. Only
  operator configuration selects Cloud origin. Validate HTTPS except explicit loopback development.
- [ ] Wire boot with provisioned location and current role checks, existing manager permission,
  fixed errors and exact allowed browser origin. Keep network calls off the trading path.
- [ ] Add dashboard Settings entry and shared-control screen: Connect, code/Open Cloud, Check
  connection, chosen business/final Connect, then separate unconfigured service statuses.
  Tests read native controls, assert no private key in JSON/DOM, and cover both languages/themes.
- [ ] Run focused server and browser tests/types, inspect phone rendering, update docs/backlog.

### Task 3: real two-installation proof and finish

Cloud files: `scripts/test-waitron-pairing.mjs` plus documented fixture/harness, and receipts.
Waitron owns its fixture using real SQLite/migrations/management API and shared state adapter.
Use an explicit WAITRON_CHECKOUT path for local integration; do not make CI depend on a sibling
checkout or import Cloud's PostgreSQL package into Waitron.

- [ ] Run actual Cloud server/portal with disposable PostgreSQL and two isolated real Waitron
  instances. Use real manager and Cloud logins. Complete both UI journeys and assert separate IDs.
- [ ] Restart between Cloud approval and local confirmation; discard a committed completion
  reply and retry. Attempt staff/expired local session, swapped request/key and different venue.
- [ ] Record exact source revisions and commands. Finish/review/CI/land each repo's branch.
  Update both main checkouts/dependencies, clean owned worktrees/branches, proceed to programme task 3.
