# Custom domains with one DNS record, and names that follow the venue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Dispatch every implementer as `subagent_type: "implementer"` (medium effort); reviews stay at high effort. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An owner's own staff or public name needs one CNAME; Cloud gets its certificate with Let's Encrypt's TLS-ALPN-01 check on port 443; every venue keeps the same assigned names when it moves cell; every certificate is issued and renewed with nobody acting; an owner whose record has moved is told in their language.

**Architecture:** Eight Cloud pull requests. PR 8 lands before PR 7. Names are stored once at placement under a configured country zone (PR 1) and Cloud keeps one CNAME per stable name pointing at the venue's current cell (PR 2). Owner certificate-expiry alerts go (PR 3). The renewal worker makes and publishes public keys and certificates itself, staff certificates use only the database exchange, and a move cannot commit before the destination holds the certificate (PR 4). Plain check files (one per name, delivered like public certificates) and a loopback TLS responder in the gateway answer `acme-tls/1` connections (PR 5); the worker gains support for them (PR 6). PR 8 wires a runnable worker, switches the portal and API to one record, and runs the local Pebble proof. The record-moved notice and email follow (PR 7), as the watcher cleared on 18 November at 12:43 CET.

**Tech Stack:** Node 26 TypeScript (type stripping), Node 24 in the gateway image, `node:test`, PostgreSQL through `scripts/test-postgres.mjs`, `acme-client` 5.4.0, HAProxy 3.2.26 (Alpine 3.23 `apk add haproxy`, measured), Docker, Pebble and pebble-challtestsrv (digests pinned in `scripts/remote-fixtures.mjs`), Lit portal.

**Spec:** [Custom domains with one DNS record](../specs/2026-11-17-custom-domain-one-record-design.md). The owner approved the design on 17 November 2026 at 16:49 CET (“yes”, session `29fb1f67-404b-49ce-b2e6-54ede24542d9`). The watcher released the corrected plan at 18:21 CET after the owner landed #1273 and #1275.

**The other plan:** Waitron's box-side part is a separate plan (`docs/superpowers/plans/2026-11-17-box-staff-name-from-cloud.md` in the Waitron repository). It starts only after **PR 1 of this plan** has landed. Nothing in this plan waits for it.

## Global Constraints

- **Migration numbers are taken at build time.** This plan names migrations by purpose: `NNN_stable_remote_names.sql` (PR 1), `NNN_remote_name_records.sql` (PR 2), `NNN_retire_certificate_expiry_incidents.sql` (PR 3), `NNN_remote_certificate_orders.sql` (PR 6), `NNN_record_moved_incidents.sql` (PR 7). Each takes the next free number on `main` when its PR is built. A collision is likely: the `cloud-feat-billing-tax-details` worktree already holds `069_billing_tax_details.sql`. Each migration adds its name to `migrationNames` in `packages/registration/src/migrate.ts` and moves the pinned last-name assertions in `packages/registration/test/migration-history.test.ts`, `packages/registration/test/cloud-action-store.test.ts` and `packages/registration/test/forward-observations-migration.test.ts`.
- Error codes the design names stay exactly: `dns_not_verified`, `hostname_conflict`, `unexpected_challenge`, `placement_changed`. New codes: `zone_conflict`, `zone_unavailable`, `invalid_name_record`, `order_in_flight`, `challenge_not_answerable`, `move_destination_incomplete`.
- Exact values:
  - Cloud's stable-name CNAMEs have a TTL of **60** seconds.
  - Set `GATEWAY_CHALLENGES` to the private check folder, mounted read-only in the gateway and writable only by the role allowed to present checks. With the setting absent, the gateway answers no checks. It holds one file per name, `<hostname>.json`, containing `{hostname, certificate, key, expiresAt}`. The gateway reads at most **128** files: the most names a cell's 64 routes can carry (`config.ts` refuses more than 64 routes).
  - The gateway's check listener is `127.0.0.1:8445`, ALPN protocol `acme-tls/1`, behind the HAProxy rule `use_backend acme_alpn if { req.ssl_alpn -m str acme-tls/1 }`, placed before every other `use_backend`.
  - Each check gets a throwaway ECDSA P-256 key.
  - Custom names keep the **237**-character limit.
  - Certificate jobs (`certificate_staff`, `certificate_public`) hold a **300**-second claim; route jobs hold **120** seconds and name jobs hold **180** seconds (Task 6.3, builder's call 13).
- Incident kinds added: `public_record_moved`, `staff_record_moved`. Incident kinds no longer raised: `public_certificate_expiring`, `staff_certificate_expiring`.
- Copy is fixed in Tasks 8.2 and 7.1; English and Spanish change together.
- By construction, a gateway never serves a public certificate for a name that is not a route: HAProxy sends a name to the public TLS frontend only through a `use_backend public_tls if { req.ssl_sni -m str <publicHostname> }` line rendered per route (`packages/remote-access/src/config.ts:25-26`). Every other name falls to `default_backend denied`. Public certificate files sitting in `/input/public-certs` therefore never widen what is served.

## Builder's calls made in this plan (one line each)

1. **Country zone storage:** a `remote_country_zones(country, environment, suffix)` table, one zone per country and environment. If `createCell` is given no zone, it uses the recorded zone for that country and environment, or records the cell's own suffix when none exists. The operator `cell` command requires `zone`.
2. **Stored assigned names:** a new `assigned_hostname` column on `remote_hostnames`, because `setHostname` overwrites `remote_hostnames.hostname` with the custom name (`packages/remote-access/src/placement.ts:211`). The migration writes existing rows' names under the zone, never under a cell suffix.
3. **Cloud's record target:** the hostname part of the cell's `endpoint` column (the load balancer that already serves TCP 443 and WireGuard).
4. **Record TTL:** 60 seconds. A switch takes effect once Route 53 reports the change in sync, plus up to 60 seconds for resolvers holding the old answer.
5. **When the record switches:** a new `name` job whose desired state names `remote_placements.cell_id`, which only `completeMove` changes (`placement.ts:166`). A staged move therefore never switches it, and a cancel leaves it alone. The name job is never parked; it keeps retrying with the 900-second backoff ceiling, because a parked job could leave a name on a cell that no longer serves it. An operator signal for a long-failing name job belongs to the monitoring-thresholds work (`docs/superpowers/specs/2026-10-22-cloud-monitoring-thresholds-design.md`).
6. **Public keys:** a fresh RSA-2048 key and CSR per issuance (`acme-client`'s `crypto.createCsr`, which `validateCsr` accepts). They are kept with the chain in the worker's private key folder, and every copy is published through `publishAuthorizedCertificate` with that CSR.
7. **`GATEWAY_CERTIFICATE_REFRESH`** defaults to `1`; `0` stays accepted. Task 4.7 measures traffic-measurement mode first.
8. **Staff file path:** the reconciler's `staffExchange` option and setting go; the database exchange is the only staff path. Waitron's `cloud-certificate.ts csr|install` command stays, because Cloud's `scripts/staff-certificate-receipt.mjs` drives the database exchange with it.
9. **Check files (revised design, approach b):** one plain `<hostname>.json` for each routed name. Only the authorised check writer can create these files in the private directory; staff names also use this responder. PR 6 writes atomically (temporary file, then rename, mode 0600), deletes a file when the order ends and sweeps expired files on write. The file's `expiresAt` is the job's `lease_until`. The gateway refreshes files in its existing one-second loop.
10. **Loopback listener:** a sibling of the public gate inside the gateway process (`AlpnResponder`), not part of `public-gate.ts`.
11. **Restart:** a gateway holds no check state of its own. After a restart it reads the folder again and answers only unexpired files for current route names, so there is no older list to fall back to.
12. **What "answerable" means, and how the proof reads it:** each gateway's `status.json` gains `challenges: {answerable: string[]}`. A name is answerable only when its file is unexpired and well formed, its secure context was built, HAProxy is running, and the name is a route in the gateway's currently accepted manifest. The worker waits until its own name is answerable on every gateway of every cell it wrote to, so one venue's unanswerable file never holds up another's. The worker uses an injected `GatewayChallengeStatus`; the local proof reads each status file through its existing gateway reader.
13. **Claim and deadline:** bounded, not renewed. Certificate jobs get a 300-second claim, route jobs keep 120 s, and name jobs get 180 s for two Route 53 writes of up to 75 s each. The order's deadline is `lease_until` − 15 s, which leaves 285 s.
    - **DNS-01 worst case, about 110 s:**
      - Route 53 publication: up to 75 s (`route53-dns.ts:14`);
      - Let's Encrypt validation wait: about 10 s (`issueCertificate`'s client backoff, 5 attempts between 0.5 and 3 s, so 0.5+1+2+3+3 = 9.5 s, plus requests);
      - cleanup: up to 10 s (the DNS delete's own budget);
      - finalize and download: about 10 s (the same backoff);
      - account, order and authorization requests: about 5 s.
    - **TLS-ALPN-01 worst case, about 81 s:** writing the files (about 1 s), the 45-second gateway wait, about 10 s of validation, deleting the files (about 1 s), about 10 s to finalize, and about 5 s of requests, plus 10 s for one slow status read.
    - Both leave at least 175 s of margin inside the 285-second deadline. The gateway wait still gives up at the earlier of 45 s and the deadline minus 30 s.
14. **One order per name, for both checks:** a `remote_certificate_orders(hostname)` row is written before any order, DNS-01 or TLS-ALPN-01. It records the claim ID and lives until the job's `lease_until` + 300 s, one more certificate claim. A worker that finds a live row from another claim refuses with `order_in_flight` and starts no order. `acme-client`'s `auto()` takes no abort signal, so this time-based row is the real protection. The gap left is one ACME call that hangs for longer than the row lives.
15. **Custom-name retries:** a moved record or a gateway that cannot yet answer a check uses the existing 900-second ceiling without parking the job.
16. **Where the moved state lives:** a `record_moved_at` column on `remote_hostnames`, scoped to the venue's name row. `schedule()` resets `last_error` whenever a job's desired digest changes (any revision bump), and a staff request at an old revision disables the staff job (`reconciler.ts:101`), so `last_error` would make the notice flicker. A wrong or missing DNS record sets the column. A lookup failure leaves that state in place and retries. A successful record check or a change of name clears it. The date shown is the latest probe observation's `certificate_not_after` for that service; with no observation the notice uses the no-date variant.
17. **237-character limit:** kept.
18. **Leftover expiry incidents:** a PR 3 migration suppresses open `*_certificate_expiring` incidents, their open episodes and their waiting reminders (chosen over a lasting filter in `diagnostics.ts`). The CHECK keeps the two kinds, so no rows are deleted.
19. **Proof staff issuance before Waitron's change:** `scripts/test-local-remote.mjs` seeds the request row in `staff_certificate_exchange` from the box's CSR (taken over the fixture's existing `csrHostname` IPC), runs the worker, and installs over the existing `certificate` IPC. The signed HTTP endpoints stay proved by `scripts/staff-certificate-receipt.mjs`.
20. **HAProxy pin:** none. HAProxy 3.2.26 from the image accepts `req.ssl_alpn` (`haproxy -c` passed; a control with an unknown fetch failed), and the gateway already runs `haproxy -c` on every configuration it writes.
21. **Worker DNS lookups:** `verifyDelegation` in the worker and in **Check again** uses `boundedResolveCname` (1-second resolver timeout, 1 try, 3-second overall bound). It moves from account-http's private `boundedResolve` (`packages/account-http/src/remote-access.ts:15-19`) into `packages/remote-access/src/dns-lookup.ts`, and account-http imports it from there.
22. **Move gate:** `completeMove` refuses `move_destination_incomplete` unless the destination holds the public certificate (Task 4.8). The existing readiness sequence checks the route. A move increments the revision, so an order for the previous revision cannot publish.

## Review Focus

1. **A record the owner fixes while the job waits.** A custom name whose renewal hit `dns_not_verified` must start an order within 15 minutes of the record being right again, with or without **Check again**. Test owned by Task 6.6.
2. **A move commit while resolvers hold the old answer.** For up to the TTL after commit, cached answers send visitors to the old cell, which drops the route at its next export. The doc must say so; the cell-move work owns the overlap. Tests owned by Task 2.2 (the record switches only on commit) and the doc line in Task 2.3.
3. **Traffic-measurement mode with refresh on by default.** A public certificate change must not add traffic-coverage rows beyond what a new HAProxy process under the same manifest adds today. Task 4.7's first step measures it.
4. **Common name length.** Waitron's CSR and the worker's public CSR put the whole name in the common name. A reviewer read Let's Encrypt's server code: Boulder's `csr/csr.go` (`maxCNLength = 64`, `CNFromCSR`) leaves out a common name over 64 characters rather than refusing the request. That was read, not run here. Because the name is also the single SAN, no task tests this.
5. **An unanswerable or stray check file.** A file whose route has not reached the gateway yet must never be declared ready (Task 6.5). A malformed file, a file whose name and contents disagree, or a file beyond the 128-file read limit must leave every other name answerable (Task 5.1).

---

## PR order and dependencies

| PR | Slice | Depends on | Tasks | Est. product lines | Est. test lines | Est. docs/proof lines | Risk trigger (full review) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Venue names stored once under the country zone | — | 4 | ~150 (migration ~60) | ~400 | docs ~40 | Yes: migration; who can claim a name; the box's staff name (cross-repo) |
| 2 | Cloud keeps each stable name's record on the current cell | 1 | 3 | ~110 | ~200 | proof modules ~20, docs ~20 | Yes: migration; DNS writes; cell moves |
| 3 | No owner certificate-expiry alerts | — (may land any time) | 2 | ~+30 / −150 (migration ~15) | ~150 changed | docs ~30 | Yes: migration (light otherwise) |
| 4 | Public certificates are Cloud's alone; staff only through the database exchange; move gate | 1 | 8 | ~330 | ~500 | proofs ~250, docs ~80 | Yes: certificates and keys; cell moves |
| 5 | Plain check files and the gateway's check responder | 4 (shares `gateway-cli.ts`) | 4 | ~200 | ~380 | docs ~40 | Yes: keys; gateway routing decides who reaches a venue |
| 6 | Worker support for TLS-ALPN-01 with the existing DNS path retained | 1, 4, 5 | 7 | ~300 (migration ~8) | ~575 | docs ~90 | Yes: certificates; name checks; migration |
| 8 | Runnable worker, one-record portal and API, and the two-cell Pebble proof | 2, 6 | 3 | ~130 | ~280 | proof ~280, docs ~70 | Yes: worker configuration and portal/API contract |
| 7 | Telling the owner their record moved | 3, 8 | 4 | ~330 | ~500 | docs ~30 | Yes: owner-only reads; migration |

The estimates are judged from each PR's tasks and the files they touch, not measured. They count added and changed lines, and leave out lockfiles and test fixtures copied verbatim.

---

## PR 1 — Venue names stored once under the country zone

Names become `v-<venue-id>.<zone>` and `staff-v-<venue-id>.<zone>`, written once at placement and never recomputed from a cell. The box's installation configuration reply already carries `staffHostname`, because the placement is stored as `{version:1,...placement}` in `installation_services.configuration` (`placement.ts:84,114,168,213`). The staff exchange's discovery reply already carries `hostname` (`staff-exchange.ts`). This PR pins the first with a test; that test is what Waitron's plan waits for.

### Task 1.1: Migration — country zones and stored assigned names

**Files:**
- Create: `packages/registration/migrations/NNN_stable_remote_names.sql`
- Modify: `packages/registration/src/migrate.ts` and the three pinned migration tests
- Modify (they insert `remote_hostnames` rows directly and must now give `assigned_hostname`; re-check with `grep -rln "INSERT INTO remote_hostnames" packages apps scripts deploy`): `packages/registration/test/monitoring.test.ts`, `packages/registration/test/monitoring-quiet.test.ts`, `packages/registration/test/email-reminders.test.ts`, `packages/operations/test/status.test.ts`, `packages/remote-access/test/manifest-route-reads.test.ts`, `packages/account-http/test/diagnostics.test.ts`, `packages/account-http/test/installations.test.ts`, `apps/portal/test/monitoring-browser.test.ts`
- Modify: `packages/remote-access/src/placement.ts:110` (the one product insert gives `assigned_hostname`, still under the cell suffix until Task 1.2)
- Test: `packages/registration/test/stable-remote-names-migration.test.ts`

**Interfaces:**
- Produces: table `remote_country_zones(country text CHECK (country='ES'), environment text CHECK (environment IN ('test','production')), suffix text NOT NULL UNIQUE CHECK (length(suffix) BETWEEN 1 AND 180), PRIMARY KEY(country,environment))`; column `remote_hostnames.assigned_hostname text NOT NULL UNIQUE`.

- [ ] **Step 1: Write the failing test** `the migration writes every assigned name under the zone, including a venue in a second cell`. On a database migrated to the previous migration, create two test/ES cells (`a.example.test`, `b.example.test`), venue X placed in `a`, and venue Y placed in `b` whose public name was changed to `menu.cafe.example.test`. After `migrate`:
  - `remote_country_zones` is exactly `[('ES','test','a.example.test')]` (the lowest suffix);
  - Y's `assigned_hostname` values are `v-<Y>.a.example.test` / `staff-v-<Y>.a.example.test`, and its staff `hostname` was rewritten to the same zone name;
  - Y's public `hostname` stays `menu.cafe.example.test`;
  - Y's `installation_services.configuration` (`remote_access`) `staffHostname` is the zone name, and its `configuration_revision` went up by one;
  - no `assigned_hostname` ends in `.b.example.test`;
  - inserting a second `('ES','test',…)` zone fails with `23505`.
- [ ] **Step 2: Run** `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/stable-remote-names-migration.test.ts`; expect FAIL (`relation "remote_country_zones" does not exist`).
- [ ] **Step 3: Write the migration.**
  - Create the table and insert one zone per `(country, environment)` from the `min(suffix)` of existing cells.
  - Add the column (nullable) and backfill it as `(CASE kind WHEN 'staff' THEN 'staff-' ELSE '' END)||'v-'||venue_id||'.'||<zone>`.
  - Rewrite `hostname` to the new name where it equals the old cell-suffix name. Rewrite the two names in that installation's `remote_access` configuration (`jsonb_set`) and bump `configuration_revision`.
  - Make the column NOT NULL and UNIQUE.
  - Then update the eight test files and `placement.ts:110`, and move the pinned last-name assertions.
- [ ] **Step 4: Run** the new test, the three pinned tests and each of the eight test files with its package's `test-postgres.mjs` command; PASS (read the counts).
- [ ] **Step 5: Commit** `git commit -s -m "Store each venue's assigned remote names under one country zone"`.

### Task 1.2: Cells carry a zone; placement writes zone names

**Files:**
- Modify: `packages/remote-access/src/placement.ts` (`CellInput`, `createCell`, `provisionInTransaction`)
- Modify: `packages/remote-access/src/operator-cli.ts` (`cell` requires `zone`)
- Modify every direct `INSERT INTO remote_cells` site so it also inserts the zone row: `deploy/test-cloud/remote-runtime.mjs`, `packages/registration/test/billing-trial-usage.test.ts`, `packages/registration/test/traffic-schema.test.ts`, `packages/translation/test/billing-allowance-worker.test.ts` and the eight files of Task 1.1 (re-check with `grep -rln "INSERT INTO remote_cells"`)
- Test: `packages/remote-access/test/placement.test.ts`, `packages/remote-access/test/operator-cli.test.ts`

**Interfaces:**
- Produces: `CellInput.zone?: string`, with the same rule as `suffix` (`isHostname`, ≤ 180). `createCell` refuses `zone_conflict` when a given zone differs from the recorded one, and `invalid_cell` for a bad zone. `provisionInTransaction` writes `hostname` and `assigned_hostname` as `staff-v-<venue>.<zone>` / `v-<venue>.<zone>`, and refuses `zone_unavailable` when no zone row exists.

- [ ] **Step 1: Write the failing tests** in `placement.test.ts`:
  - `a placement is named under the country zone, not the cell suffix` — `createCell({...cell, suffix:'cell-a.example.test', zone:'venues.example.test'})`, then `provision` gives `staffHostname === 'staff-v-'+venueId+'.venues.example.test'` and `publicHostname === 'v-'+venueId+'.venues.example.test'`.
  - `a second cell in the same country and environment shares the zone` — without `zone` it succeeds; with `zone:'other.example.test'` it throws `zone_conflict`.
  - `a cell created without any zone records its own suffix`.
  - `placement refuses zone_unavailable for a cell inserted without a zone`.

  In `operator-cli.test.ts`: `the cell command refuses a cell file without zone`.
- [ ] **Step 2: Run** `node scripts/test-postgres.mjs exec pnpm --dir packages/remote-access exec node --test test/placement.test.ts test/operator-cli.test.ts`; the new cases FAIL.
- [ ] **Step 3: Implement**, and update the direct cell inserts.
- [ ] **Step 4: Run** both files and `node scripts/test-postgres.mjs exec node --test deploy/test-cloud/runtime.test.mjs`; PASS.
- [ ] **Step 5: Commit** `git commit -s -m "Name new placements under the country zone"`.

### Task 1.3: Bring existing remote-access tests to the zone

**Files:**
- Modify: only the `packages/remote-access/test/*.test.ts` files that fail in Step 1

- [ ] **Step 1: Run** `node scripts/test-postgres.mjs --filter @waitron-cloud/remote-access test` and list the failures. The expected kind: a test that creates two cells with different suffixes and expects a name under the second cell's suffix now gets the shared zone.
- [ ] **Step 2:** Change each such expectation to the zone name. Change nothing else: a failure of any other kind is a defect in Task 1.2 and goes back there. List every changed assertion for the PR's "Changed test checks".
- [ ] **Step 3: Run** the package again; read the counts; PASS.
- [ ] **Step 4: Commit** `git commit -s -m "Expect zone names in remote-access tests"`.

### Task 1.4: Every reader uses the stored names; the namespace refusal covers the zone; docs

**Files:**
- Modify: `packages/remote-access/src/placement.ts` (`certificateAuthorization`, `#assigned`, `setHostname` namespace and reserved checks)
- Modify: `packages/remote-access/src/reconciler.ts` (`desiredTargets` certificate rows read `assigned_hostname`, with no `remote_cells` join)
- Modify: `packages/account-http/src/remote-access.ts` (status `names[kind].assigned` from `assigned_hostname`)
- Modify: `docs/local-remote-access.md` ("Keep a local gateway configured": cell file `zone`; "Reconcile routes and certificates": delete the paragraph that says certificate authorization derives its challenge name from the destination cell's suffix; "Move a venue between existing cells": names never change), `docs/waitron-integration-contract.md` ("Staff certificate exchange, version 1": the box takes its staff name from the `remote_access` `configuration.staffHostname` of the installation configuration reply; it is stable across moves), `docs/backlog/decisions-in-progress.md` (the "Cells" row: stable names built, when to fail over still open), `docs/backlog.md`
- Test: `packages/remote-access/test/movement.test.ts`, `packages/remote-access/test/placement.test.ts`, `packages/remote-access/test/installation-configuration-names.test.ts` (new)

**Interfaces:**
- Produces: `CertificateAuthorization` becomes `{hostname:string; assigned:string; dnsName:string; revision:number; binding?:…}` with `dnsName === '_acme-challenge.'+assigned`. `#assigned` returns the stored `assigned_hostname`.

- [ ] **Step 1: Write the failing tests**:
  - `movement.test.ts`: `a venue moved to a cell with a different suffix keeps both names and its certificate check names`. Cell A is `a.example.test`, cell B `b.example.test`, zone `venues.example.test`. After stage, ready and commit: placement names are unchanged; `authorizeCertificate(id,'staff',csr).dnsName === '_acme-challenge.staff-v-'+venue+'.venues.example.test'` before and after; `hostnameInstructions(id,'staff','staff.cafe.example.test')[0].value` is unchanged.
  - `placement.test.ts`: `a name under the country zone or any cell suffix is refused as a custom name` — `x.venues.example.test`, `venues.example.test` and `x.b.example.test` each throw `hostname_conflict` with zero resolver calls; another venue's assigned name throws `hostname_conflict`.
  - `installation-configuration-names.test.ts`: `the installation configuration reply carries the current staff name after placement, a custom name and a move` — through `InstallationStore`'s `configuration` action, the `remote_access` `configuration.staffHostname` equals the stored current staff name at each step. (Waitron's plan depends on this.)
- [ ] **Step 2: Run** `node scripts/test-postgres.mjs exec pnpm --dir packages/remote-access exec node --test test/movement.test.ts test/placement.test.ts test/installation-configuration-names.test.ts`; the move and namespace cases FAIL.
- [ ] **Step 3: Implement**; edit the docs.
- [ ] **Step 4: Run** the three files plus `test/reconciler.test.ts test/staff-reconciler.test.ts`, `node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test test/remote-access.test.ts` and `node --test scripts/ci-docs.test.mjs`; PASS.
- [ ] **Step 5: Commit** `git commit -s -m "Read stored venue names everywhere and reserve the country zone"`.

---

## PR 2 — Cloud keeps each stable name's record on the current cell

### Task 2.1: CNAME writes in the DNS module

**Files:**
- Modify: `packages/remote-access/src/certificates.ts` (`DnsChallengeProvider` gains `point`), `packages/remote-access/src/route53-dns.ts`, `packages/remote-access/src/reconciler-cli.ts` (the module must export `point`)
- Test: `packages/remote-access/test/route53-dns.test.ts`, `packages/remote-access/test/reconciler-cli.test.ts`

**Interfaces:**
- Produces: `interface DnsChallengeProvider {present(name,value,signal?):Promise<void>; remove(name,value,signal?):Promise<void>; point(name:string,target:string,signal?:AbortSignal):Promise<void>}`. The Route 53 `point` sends one `UPSERT` of `Type:'CNAME', TTL:60, ResourceRecords:[{Value:target}]` and waits for `INSYNC` within the existing 75-second budget. It refuses `invalid_name_record` unless the name is exactly `v-<uuid>.<suffix>` or `staff-v-<uuid>.<suffix>` and the target passes `isHostname`.

- [ ] **Step 1: Write the failing tests**:
  - `point upserts one CNAME with a 60-second TTL and waits for INSYNC` — the stub client records `Action:'UPSERT'`, `Type:'CNAME'`, `TTL:60`, `Value:'gw.cell-b.example.test'`.
  - `point refuses names outside the venue pattern` — `x.<suffix>`, `staff-v-<uuid>.other.example.test` and `_acme-challenge.v-<uuid>.<suffix>` send no command.
  - `reconciler-cli.test.ts`: `a DNS module without point is refused`.
- [ ] **Step 2: Run** `pnpm --dir packages/remote-access exec node --test test/route53-dns.test.ts` and `node scripts/test-postgres.mjs exec pnpm --dir packages/remote-access exec node --test test/reconciler-cli.test.ts`; FAIL.
- [ ] **Step 3: Implement** `point`, reusing the abort and polling shape of `change`.
- [ ] **Step 4: Run both again**; PASS. **Commit** `git commit -s -m "Let the DNS module point a venue's stable name at a cell"`.

### Task 2.2: The `name` job switches the record when a move commits

**Files:**
- Create: `packages/registration/migrations/NNN_remote_name_records.sql` (job kind CHECK gains `'name'`)
- Modify: `packages/remote-access/src/reconciler.ts` (`RemoteConfigurationKind`, `desiredTargets`, `runOnce` dispatch, `#name`, and `#release` for `name`)
- Test: `packages/remote-access/test/name-records.test.ts`

**Interfaces:**
- Consumes: `DnsChallengeProvider.point` (Task 2.1).
- Produces:
  - `RemoteConfigurationKind` gains `'name'`, and the reconciler option `pointName?:(name:string,target:string,signal:AbortSignal)=>Promise<void>`.
  - Each placed installation gets one `name` job, with a digest over `{staff, public, target}`: the two assigned names, and the host part of the placement cell's `endpoint`.
  - A failed `name` job is released `pending` with `available_at` = now + `min(900, 30*2^(attempts-1))` s and `attempts = least(attempts,7)`, so it is never parked.

- [ ] **Step 1: Write the failing tests** (a fake `pointName` records calls):
  - `a placed venue's stable names point at its cell` — the calls equal `[['staff-v-<venue>.venues.example.test','gw.cell-a.example.test'],['v-<venue>.venues.example.test','gw.cell-a.example.test']]`.
  - `a staged or ready move does not switch the record; the commit does`.
  - `a cancelled move leaves the record on the old cell`.
  - `a name job that keeps failing is never parked` — after nine failures, `status` is `pending` and `available_at` is ≤ now + 900 s.
- [ ] **Step 2: Run** `node scripts/test-postgres.mjs exec pnpm --dir packages/remote-access exec node --test test/name-records.test.ts`; FAIL.
- [ ] **Step 3: Write the migration and implement**; wire `pointName` to `dns.point` in `reconciler-cli.ts`.
- [ ] **Step 4: Run** the file plus `test/reconciler.test.ts test/reconciler-cli.test.ts test/staff-reconciler.test.ts`; PASS. **Commit** `git commit -s -m "Keep each venue's stable names pointing at its current cell"`.

### Task 2.3: Proof DNS modules point names; docs

**Files:**
- Modify: every DNS module a proof writes for the reconciler (`scripts/remote-fixtures.mjs`'s `dns-provider.mjs` writer, `scripts/remote-reconciler-receipt.mjs`, and any other hit of `grep -rln "dnsModule" scripts deploy`) so that `point` calls pebble-challtestsrv `POST /set-cname {host:name+'.', target:target+'.'}`. The pinned image answers 200 (measured).
- Modify: `docs/local-remote-access.md` (Route 53 permissions add `CNAME` for `v-*`/`staff-v-*` under the zone; TTL 60; after a commit, resolvers holding the old answer reach the old cell for up to 60 s more), `docs/backlog.md`

- [ ] **Step 1:** Update the modules; run `node scripts/test-local-acme.mjs` (Docker) and read the `PASS` lines.
- [ ] **Step 2:** Edit the docs; `node --test scripts/ci-docs.test.mjs`. **Commit** `git commit -s -m "Point stable names in local proofs and document the record switch"`.

---

## PR 3 — No owner certificate-expiry alerts

Independent; may land before PR 1.

### Task 3.1: Monitoring, configuration and email stop raising expiry incidents; leftover rows suppressed

**Files:**
- Create: `packages/registration/migrations/NNN_retire_certificate_expiry_incidents.sql` — sets `status='suppressed'` (revision +1, `changed_at` now) on open `public_certificate_expiring`/`staff_certificate_expiring` incidents, `status='suppressed'` on their open episodes, and `reminder_status='cancelled'` on their waiting recipients.
- Modify: `packages/registration/src/monitoring.ts` (drop the `${service}_certificate_expiring` transition, the `certificateWarningDays` option, and the two kinds in the owner selection query at line 165)
- Modify: `packages/registration/src/monitor-config.ts` (drop `certificateWarningDays` and `CLOUD_REMOTE_CERTIFICATE_WARNING_DAYS`)
- Modify: `packages/registration/src/service-alert.ts` (`incidentKinds` and the `certificate` branch)
- Modify: `packages/registration/src/account-mail.ts` — delete both kinds' EN/ES text and labels. The route-failure sentence "Gateway and certificate changes still require operator tools." becomes "Gateway changes still require operator tools." / "Los cambios de pasarela aún requieren herramientas de operador."
- Modify: `packages/registration/src/email-outbox.ts` (the kind list at line 319), `packages/account-http/src/venue-overview.ts` (the kind list at line 21)
- Modify: `scripts/test-local-remote.mjs` (drop the `CLOUD_REMOTE_CERTIFICATE_WARNING_DAYS` setting and the `furthestExpiry` expiry phase near line 247)
- Test: `packages/registration/test/monitoring.test.ts`, `packages/registration/test/monitor-config.test.ts`, `packages/registration/test/service-alert.test.ts`, `packages/registration/test/monitoring-action-mail.test.ts`, `packages/account-http/test/installations.test.ts`, `packages/account-http/test/diagnostics.test.ts`

- [ ] **Step 1: Write the failing tests**:
  - `monitoring.test.ts`: `a certificate inside the old warning window raises no owner incident` — no `%certificate_expiring` row and no outbox row.
  - `monitor-config.test.ts`: `CLOUD_REMOTE_CERTIFICATE_WARNING_DAYS is no longer a setting` — the result has no `certificateWarningDays` key.
  - `service-alert.test.ts`: `validServiceAlert` refuses `issue:'public_certificate_expiring'`.
  - `diagnostics.test.ts`: `a leftover open expiry incident is suppressed by the migration and not listed` — insert the open row before the migration runs, migrate, read diagnostics: its kind is absent.
- [ ] **Step 2: Run** `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/monitoring.test.ts test/monitor-config.test.ts test/service-alert.test.ts test/monitoring-action-mail.test.ts` and the two account-http files; FAIL.
- [ ] **Step 3: Write the migration and implement.** Existing assertions that list `*_certificate_expiring` change deliberately: `monitoring.test.ts:135,164,168,174`, `service-alert.test.ts:22,35,45`, `monitoring-action-mail.test.ts:11`, `installations.test.ts:124,129`, and the warning-days cases in `monitor-config.test.ts`. List them under Changed test checks.
- [ ] **Step 4: Run again**; PASS. **Commit** `git commit -s -m "Stop emailing owners about certificate expiry"`.

### Task 3.2: Portal drops the kinds and their text; docs

**Files:**
- Modify: `apps/portal/src/installation-types.ts`, `apps/portal/src/diagnostic-types.ts`, `apps/portal/src/alert-screen.ts`, `apps/portal/src/locale.ts`
- Modify: `docs/local-monitoring.md` (the `CLOUD_REMOTE_CERTIFICATE_WARNING_DAYS` setting and owner expiry alerts), `docs/local-remote-access.md`, `docs/backlog/service-monitoring.md`, `docs/backlog.md`
- Test: `apps/portal/test/installation-controller.test.ts`, `apps/portal/test/monitoring-check-status-browser.test.ts`, `apps/portal/test/monitoring-regions-browser.test.ts`, `apps/portal/test/dates-browser.test.ts`

- [ ] **Step 1: Write the failing test** `an installation reply naming a certificate-expiry incident is refused` in `installation-controller.test.ts`.
- [ ] **Step 2: Run** `node scripts/test-postgres.mjs exec pnpm --dir apps/portal exec node --test test/installation-controller.test.ts`; FAIL.
- [ ] **Step 3: Implement**; update the three browser fixtures that use the kind (Changed test checks); edit the docs.
- [ ] **Step 4: Prove no owner-facing expiry text remains.** Run `grep -rn -i -E "certificate_expiring|CERTIFICATE_WARNING_DAYS|caduca pronto|expires soon|Renewal and installation still require|renovación y la instalación" apps/portal/src packages/registration/src packages/account-http/src docs/local-monitoring.md docs/local-remote-access.md`. Expected output: nothing, except the migration-name string in `migrate.ts` and the CHECK in old migrations, which are outside these paths.
- [ ] **Step 5: Run** the four portal files and `node --test scripts/ci-docs.test.mjs`; PASS. Look at the alert screen in EN/ES, light/dark, at 390 and 1280 wide. **Commit** `git commit -s -m "Remove certificate-expiry alerts from the portal"`.

---

## PR 4 — Public certificates are Cloud's alone; staff only through the database exchange; move gate

The tasks are ordered so every commit is green: new artifact methods are added before the old ones go, and the proofs move to the new configuration before the operator command is removed.

**Pre-build corrections, 18 November:** Claude read this slice against current main. The watcher cleared the following corrections at 03:02 and requested this single revision with no further plan read. Gateway public files use the venue ID, while private copies remain per installation; pass `venueId` to the publisher. Test a public-name change and a staged move during failed renewal. Keep the test Cloud's existing `remote/<id>/{key,request,certificate}.pem` layout and its HTTP-01 adapter; run `deploy/test-cloud/remote-runtime.test.mjs` as well as `runtime.test.mjs`. All actual old-artifact and staff-mode consumers migrate with their behavioral checks preserved, including the reconciler, certificate, forward-observation, venue-boundary, traffic-publication and staff-receipt tests. The two-venue proof runs the certificate worker after staging a move; its worker route outputs use scratch files. Cell lists include only staged/ready moves at the installation's current revision. The move gate reads an enabled job without a row lock, preserving the existing installation/job lock order. Add `GATEWAY_PUBLIC_CERTIFICATES`, default `/input/public-certs`; missing folders are empty and host-run fixtures use private temporary folders. Keep Task 4.7's actual traffic-mode measurement before choosing its default. No new migration, table, provider action or live upgrade is part of this slice.


### Task 4.1: The worker makes its own public key and CSR

**Files:**
- Modify: `packages/remote-access/src/reconciler.ts` (`ReconcilerArtifacts` gains two methods; `#certificate` public path)
- Modify: `packages/remote-access/src/reconciler-files.ts` (`FileReconcilerArtifacts` accepts `keyDirectory` and per-route `publicCertificates`, alongside today's fields)
- Modify: `deploy/test-cloud/remote-runtime.mjs` (implements the two methods; drops `publicRequest`)
- Test: `packages/remote-access/test/public-certificates.test.ts` (new), `packages/remote-access/test/reconciler-files.test.ts` (new)

**Interfaces:**
- Produces:
  - `ReconcilerArtifacts.readPublicCertificate(installationId:string):Promise<{pem:string;csr:string}|undefined>` — `pem` is key followed by chain.
  - `ReconcilerArtifacts.publishPublicCertificate(installationId:string,venueId:string,cellIds:string[],copy:{pem:string;csr:string}):Promise<{copied:string[];complete:boolean}>`.
  - File artifacts keep `<keyDirectory>/<installationId>.public.pem` and `<keyDirectory>/<installationId>.public.csr` (mode 0600), and write `<publicCertificates>/<venueId>.pem` for each named cell, each atomically. Keep issued material privately before independent cell writes. Return the copied cell IDs and whether all writes/cleanup completed; missing mappings retry without another order.

- [ ] **Step 1: Write the failing tests**:
  - `public-certificates.test.ts` (a fake `issueCertificate` signs the CSR with a local test CA, as `deploy/test-cloud/remote-runtime.mjs` does): `a newly placed venue gets a public certificate with no configuration entry and no operator command`. One pass publishes `<cell>/<venueId>.pem`; its chain covers the stored public name, and its key matches the stored CSR.
  - `public-certificates.test.ts`: `a failed issuance keeps the last good copy` (the bytes are unchanged).
  - `reconciler-files.test.ts`: `publishes key and chain to every named cell and keeps key and CSR private` (mode 0600).
  - `reconciler-files.test.ts`: `an unmapped cell writes nothing`.
- [ ] **Step 2: Run** `node scripts/test-postgres.mjs exec pnpm --dir packages/remote-access exec node --test test/public-certificates.test.ts` and `pnpm --dir packages/remote-access exec node --test test/reconciler-files.test.ts`; FAIL.
- [ ] **Step 3: Implement**: `acmeCrypto.createCsr({commonName:hostname,altNames:[hostname]})` (RSA 2048), issue, check with `certificateNeedsRenewal`, then publish inside `#complete` through `publishAuthorizedCertificate(client,id,'public',csr,authority,…)`.
- [ ] **Step 4: Run** both files plus `test/reconciler.test.ts` and `node scripts/test-postgres.mjs exec node --test deploy/test-cloud/runtime.test.mjs`; PASS. **Commit** `git commit -s -m "Make public certificate keys in the renewal worker"`.

### Task 4.2: Copies follow the venue's cells, authorized on every pass

**Files:**
- Create: `packages/remote-access/src/certificate-digest.ts` (`certificateDigest`, `routeCells`; `reconciler.ts` imports them, and so will `placement.ts` in Task 4.8)
- Modify: `packages/remote-access/src/reconciler.ts`
- Test: `packages/remote-access/test/public-certificates.test.ts`

**Interfaces:**
- Produces:
  - `routeCells(client:PoolClient,installationId:string):Promise<string[]>` — sorted ids of the cell holding the active placement and of any `staged`/`ready` move target.
  - `certificateDigest(installationId,kind,authority,cells:string[]):string`, and the `certificate_public` digest includes `cells`.
- The flow on every pass: read the current public name and private copy. A copy with the wrong name needs a fresh CSR before authorization. Publish a matching, still-valid copy to `routeCells` through `publishAuthorizedCertificate` and record its copied-state digest before attempting renewal. Outside the renewal window, complete. Inside it, renew with a fresh key; failure keeps the copied-state digest and uses the existing retry backoff. Expired or wrong-name copies never qualify. Preserve the last good private copy until a valid replacement exists; add no saved candidate-key protocol.

- [ ] **Step 1: Write the failing tests**:
  - `a certificate inside its renewal window is renewed and reaches every cell holding the venue's route` — move the clock to 29 days before expiry and stage a move: both cells hold the new chain with a new key.
  - `a staged move copies the existing certificate to the destination without reissuing` — the issuer call count is unchanged and the destination file equals the source.
  - `a name change during a copy refuses placement_changed and keeps the old chain` — change the public name between the authorization and the publication (a hook in the fake artifacts); the job fails with `placement_changed` and the destination file is not written.
- [ ] **Step 2: Run** the file (same command as Task 4.1); FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** it plus `test/reconciler.test.ts test/reconciler-route-reads.test.ts test/plan-permissions.test.ts`; PASS. **Commit** `git commit -s -m "Copy public certificates to every cell holding the venue's route"`.

### Task 4.3: Staff only through the exchange; the configuration names no venues

**Files:**
- Modify: `packages/remote-access/src/reconciler.ts` (remove the `staffExchange` option and the file staff path; drop `readCsr`/`readCertificate`/`publishCertificate` from `ReconcilerArtifacts`)
- Modify: `packages/remote-access/src/reconciler-files.ts`, `packages/remote-access/src/reconciler-cli.ts`, `deploy/test-cloud/remote-runtime.mjs` (drop `staffExchange:true`)
- Test: `packages/remote-access/test/reconciler-cli.test.ts`, `packages/remote-access/test/staff-reconciler.test.ts`, `packages/remote-access/test/staff-exchange-fixture.ts`, `packages/remote-access/test/plan-permissions.test.ts`, `packages/remote-access/test/cli-color.test.ts`

**Interfaces:**
- Produces: the configuration is `{forwardReports?:boolean; keyDirectory:string; routes:{cellId:string; output:string; signingKeyFile:string; publicCertificates:string}[]; acme:{directoryUrl;email;accountKeyFile;dnsModule}}`, with every path absolute. A `certificates` or `staffExchange` key is refused.

- [ ] **Step 1: Write the failing tests**:
  - `reconciler-cli.test.ts`: `a configuration with no per-venue list is accepted` (`--status`, exit 0).
  - `reconciler-cli.test.ts`: `a configuration with a certificates list or staffExchange is refused` (exit 1, the existing generic message).
  - `staff-reconciler.test.ts`: `a staff job without a database request does nothing`. Existing cases drop `staffExchange:true` from their setup (Changed test checks).
- [ ] **Step 2: Run** them through `test-postgres.mjs`; FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the five files and `deploy/test-cloud/runtime.test.mjs`; PASS. **Commit** `git commit -s -m "Use only the database exchange for staff certificates and name no venues in the worker configuration"`.

### Task 4.4: Reconciler receipt on the new configuration

**Files:**
- Modify: `scripts/remote-reconciler-receipt.mjs`, `scripts/verify-remote-reconciler-receipt.mjs`, `scripts/verify-remote-reconciler-receipt.test.mjs`

- [ ] **Step 1: Write the failing test** in the verifier test. A receipt carrying the old file-based staff check (`waitronInstallCommand`) is refused. One with `publicWithoutOperatorFiles: true` and `staffThroughDatabaseExchange: true` is accepted.
- [ ] **Step 2: Run** `node --test scripts/verify-remote-reconciler-receipt.test.mjs`; FAIL.
- [ ] **Step 3: Rewrite the receipt.** Public certificates come from the worker under the new configuration; staff certificates from a seeded `staff_certificate_exchange` row and the worker. Keep the route publication, lease, parking, retention and fence checks.
- [ ] **Step 4: Run** `WAITRON_CHECKOUT=/absolute/path/to/waitron pnpm proof:remote-reconciler` (Docker); read the `PASS` lines; run the verifier test; PASS. **Commit** `git commit -s -m "Prove reconciliation without per-venue files"`.

### Task 4.5: Two-venue proof — public certificates from the worker

**Files:**
- Modify: `scripts/test-local-remote.mjs` (public issuance, around lines 141–145)

- [ ] **Step 1:** Replace public `acme.issue({operator:…})` and the hand-built `publicMaterial` writes with the worker. Use a `RemoteConfigurationReconciler` with file artifacts mapping both cells' `public-certs` folders and the Pebble DNS module, and run it until both venues' files exist. Keep every existing assertion.
- [ ] **Step 2: Run** the proof as in `docs/local-remote-access.md` "Run the proof"; read every `PASS` line. **Commit** `git commit -s -m "Issue the two-venue proof's public certificates through the worker"`.

### Task 4.6: Two-venue proof — staff certificates through the exchange row

**Files:**
- Modify: `scripts/test-local-remote.mjs` (staff issuance around lines 138–140 and renewal around lines 201–204)

- [ ] **Step 1:** Take the CSR with `ipc(server,{csrHostname})`, insert the request row (revision and hostname from the placement) into `staff_certificate_exchange`, and run the worker until the row holds a certificate. Then call `ipc(server,{certificate,hostname})`. Do the same for the renewal. Keep the hot-reload, key-absence and fingerprint assertions.
- [ ] **Step 2: Run** the proof and both receipt verifiers (`scripts/verify-remote-monitoring-receipt.mjs`, `scripts/verify-cell-movement-receipt.mjs`); PASS. **Commit** `git commit -s -m "Issue the two-venue proof's staff certificates through the database exchange"`.

### Task 4.7: Operator command removed; gateway refresh on by default

**Files:**
- Modify: `packages/remote-access/src/operator-cli.ts` (remove `certificate`), `packages/remote-access/src/gateway-cli.ts` (`GATEWAY_CERTIFICATE_REFRESH` defaults to `'1'`), `deploy/test-cloud/runtime.mjs` (line 24 no longer sets it), `scripts/remote-fixtures.mjs` (the `operator` branch of `issue`)
- Test: `packages/remote-access/test/operator-cli.test.ts`, `packages/remote-access/test/gateway-traffic-command.test.ts`

- [ ] **Step 1: Measure first (Review Focus 3).** Add `a public certificate change in traffic mode under the same manifest adds no coverage row` (refresh on) to `gateway-traffic-command.test.ts` and run `pnpm --dir packages/remote-access exec node --test test/gateway-traffic-command.test.ts`. If a coverage row appears, keep the default at `'0'` when traffic mode is on, assert that, and say so in the doc. Otherwise the default is `'1'` everywhere.
- [ ] **Step 2: Write the failing tests**: `the certificate command is gone` (the usage lists no `certificate`) and `a gateway with no refresh setting reloads changed public certificates`.
- [ ] **Step 3: Run** both files; FAIL. **Implement**; run again and `deploy/test-cloud/runtime.test.mjs`; PASS.
- [ ] **Step 4: Commit** `git commit -s -m "Remove the operator certificate command and refresh gateway certificates by default"`.

### Task 4.8: A move commits only after the destination holds the public certificate; docs

**Files:**
- Modify: `packages/remote-access/src/placement.ts` (`completeMove`)
- Modify: `docs/local-remote-access.md` (rewrite the "Reconcile routes and certificates" configuration example; rewrite "Issue and renew certificates"; "Exchange staff certificates without shared files" loses the `staffExchange` key; the refresh default; the move gate under "Move a venue between existing cells"), `docs/waitron-integration-contract.md` (staff v1: the database exchange is the only Cloud path), `docs/backlog/service-candidates.md` (the Remote access row), `docs/backlog.md`
- Test: `packages/remote-access/test/movement.test.ts`

**Interfaces:**
- Consumes: `certificateDigest`, `routeCells` (Task 4.2).
- Produces: `completeMove` refuses `move_destination_incomplete` unless the `certificate_public` job's `applied_digest` equals the digest recomputed in the transaction, with `routeCells` including the target. The route part stays the existing readiness check.

- [ ] **Step 1: Write the failing tests**:
  - `a ready move whose destination has no public certificate refuses move_destination_incomplete and keeps the source placement`.
  - `after the worker copies the certificate to the destination the commit succeeds`.
- [ ] **Step 2: Run** `node scripts/test-postgres.mjs exec pnpm --dir packages/remote-access exec node --test test/movement.test.ts`; FAIL.
- [ ] **Step 3: Implement**; update the existing move tests that commit without a worker pass to run one first (Changed test checks); edit the docs.
- [ ] **Step 4: Run** `test/movement.test.ts test/operator-cli.test.ts`, the two-venue proof's movement phase and `node --test scripts/ci-docs.test.mjs`; PASS. **Commit** `git commit -s -m "Commit a move only once the destination holds the public certificate"`.

---

## PR 5 — Plain check files and the gateway's check responder

The gateway can answer a locally supplied TLS-ALPN-01 check. PR 6 wires the worker to present checks and retains ownership of issuance. Budget: about 200 production, 380 test and 40 documentation lines.

### Task 5.1: Read and validate each routed name's check file

In `packages/remote-access/src/challenge-files.ts`, read one file per current staff/public route name, up to 128. Open without following symlinks or blocking on special files; read at most 16 KiB of regular-file content. Require the exact JSON fields `hostname`, `certificate`, `key` and `expiresAt`, a matching valid hostname and an unexpired deadline. Require one exact DNS SAN, a matching private key and a critical RFC 8737 identifier with a 32-byte digest in the certificate's extensions. Cache the secure context for unchanged files. A missing folder or invalid file gives no answer for that name. Keep worker write/delete/sweep helpers in Task 6.5.

Test in `test/challenge-files.test.ts` with actual files and certificates. Run it before implementing and again afterward.

### Task 5.2: Serve checks on loopback

In `src/alpn-responder.ts`, use `ALPNCallback` and `setKeyCert` with no default certificate. Refuse unknown names, withdrawn routes, expired files, missing SNI and missing/wrong ALPN. Answer new routes on the next refresh, recheck route membership and expiry at handshake time, and close without application data. Test real TLS exchanges in `test/alpn-responder.test.ts`, including file deletion and loss of the check directory.

### Task 5.3: Route check traffic in both gateway modes

In `src/config.ts`, put the `req.ssl_alpn` check first in ingress, using a short backend timeout, connection cap and port 8445 by default. Reject port collisions. In `src/gateway-cli.ts`, enable the loopback listener only with `GATEWAY_CHALLENGES`, refresh it in the existing loop, close it at shutdown and report `challenges.answerable` only while HAProxy is ready.

Extend `test/haproxy.test.ts` and `test/gateway-traffic-command.test.ts`. Check rule order in both modes, and that a file appears in status without a new HAProxy process or traffic lifetime. Test that a non-route file and a gateway with no folder setting cannot answer. Preserve existing traffic assertions and refresh CI reader pins.

### Task 5.4: Prove the check stays within the gateway

Extend the real HAProxy image test with a synthetic certificate and a counting staff backend. An `acme-tls/1` connection gets the check certificate with zero venue connections; a normal connection to the same name reaches the venue. Exercise the rendered rule in the Node 24 image. In a disposable copy, remove the rule once and watch the venue count fail. Update the gateway guide and Cloud backlog, retaining worker issuance, live qualification and multi-gateway delivery as open.

---

## PR 6 — Worker support for TLS-ALPN-01 custom names

A worker with injected gateway status and private check folders can present the gateway's port-443 check. The command-line worker keeps DNS-01 for custom names and the account portal and API keep their two records. The watcher cleared this smaller cut on 18 November at 11:08 CET after both branch reviews. PR 8 adds the runnable wiring and changes the portal and API together. The Amazon test Cloud adapter has its own queued work.

### Task 6.1: Choose the ACME check in `issueCertificate`

**Files:**
- Modify: `packages/remote-access/src/certificates.ts` and its callers in `reconciler-cli.ts` and `scripts/remote-acme-worker.mjs`.
- Test: `packages/remote-access/test/certificates.test.ts`.

**Interfaces:**
- `CertificateValidation` is either DNS-01 with a challenge name and DNS provider or TLS-ALPN-01 with callbacks to present and withdraw a check file.
- `issueCertificate` requests only the selected check. Its handlers refuse a different hostname or challenge type. The TLS-ALPN-01 certificate uses a temporary P-256 key.
- Keep both CNAMEs in `dnsInstructions` and `verifyDelegation`. PR 8 changes the shared response and the portal together.

- [ ] **Step 1:** Write the callback checks for a valid temporary certificate, wrong name and wrong challenge type. Preserve the two-record test.
- [ ] **Step 2:** Run the focused tests before and after the change, then run `node scripts/test-local-acme.mjs` to verify the existing DNS path.

### Task 6.2: Migration — certificate orders and the moved-record column

**Files:**
- Create: `packages/registration/migrations/NNN_remote_certificate_orders.sql`:
  - `remote_certificate_orders(hostname text PRIMARY KEY, claim_id uuid NOT NULL, expires_at timestamptz NOT NULL)`
  - `remote_hostnames.record_moved_at timestamptz`
- Modify: `packages/registration/src/migrate.ts` and the three pinned migration tests
- Test: `packages/registration/test/certificate-orders-migration.test.ts`

- [ ] **Step 1: Write the failing test** `the certificate orders table holds one row per hostname`: a second insert for the same hostname fails with `23505`; `record_moved_at` is null on existing `remote_hostnames` rows.
- [ ] **Step 2: Run** `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/certificate-orders-migration.test.ts`; FAIL. **Write the migration**; run it and the pinned tests; PASS.
- [ ] **Step 3: Commit** `git commit -s -m "Add certificate order rows and the moved-record column"`.

### Task 6.3: One order per name for both checks, and a longer claim for certificate jobs

**Files:**
- Modify: `packages/remote-access/src/reconciler.ts`:
  - the claim at line 157 becomes `lease_until = clock_timestamp() + CASE WHEN kind LIKE 'certificate_%' THEN interval '300 seconds' WHEN kind = 'name' THEN interval '180 seconds' ELSE interval '120 seconds' END`;
  - `RemoteConfigurationJob.leaseUntil` is read from `lease_until`;
  - an order guard goes around every `issueCertificate` call;
  - the order's deadline is checked against the reconciler's injected `now` and backed by a real timer.
- Modify: `packages/remote-access/src/route53-dns.ts:13` (the comment names the 300-second certificate claim)
- Test: `packages/remote-access/test/certificate-orders.test.ts`

**Interfaces:**
- Produces:
  - `RemoteConfigurationJob.leaseUntil:number`.
  - Before ordering, the job inserts `remote_certificate_orders(hostname, claim_id, expires_at = lease_until + 300 s)`, replacing an expired row. A live row from another claim refuses `order_in_flight`, and no order starts. The row is deleted in `finally`.
  - `deadline = leaseUntil − 15 000` ms. The order's signal is `AbortSignal.any([signal, AbortSignal.timeout(deadline − now())])`. In addition, `deadline` is compared with `this.#now()` after each order step (publication, wait, validation) and before `#complete`; past it, the job ends the order without publishing.

- Give `#release` an explicit reason code. For `challenge_not_answerable` and `dns_not_verified`, reuse the bounded retry with a 900-second ceiling and cap attempts at 7 so staff jobs never park for either reason.

- [ ] **Step 1: Write the failing tests** (a fake issuer that blocks until released; an injected `now`):
  - `two workers never hold orders for one name at once, for DNS-01 and for TLS-ALPN-01` — the first blocks inside the order; force its `lease_until` into the past; the second claims and refuses `order_in_flight`; the issuer was called once.
  - `the order row is removed after success and after failure`.
  - `certificate jobs claim 300 seconds, name jobs claim 180 and route jobs claim 120` — read `lease_until − updated_at` after each claim.
  - `a DNS-01 order whose Route 53 step takes the full 75 seconds still completes and publishes inside its claim`. The fake DNS `present` advances the injected clock by 75 000 ms; the fake validation and finalize advance it by another 30 000 ms. The order is not cut short, the certificate is published, and the job completes while its claim is still live.
  - `an order past its deadline ends without publishing` — the injected clock passes `leaseUntil − 15 000`.
- [ ] **Step 2: Run** `node scripts/test-postgres.mjs exec pnpm --dir packages/remote-access exec node --test test/certificate-orders.test.ts`; FAIL. **Implement**; run it again plus `test/public-certificates.test.ts test/staff-reconciler.test.ts test/reconciler.test.ts test/name-records.test.ts`; PASS.
- [ ] **Step 3: Commit** `git commit -s -m "Hold one certificate order per name and give certificate jobs room to finish"`.

### Task 6.4: Reading the gateways and waiting for an answerable name

**Files:**
- Create: `packages/remote-access/src/gateway-status.ts`
- Test: `packages/remote-access/test/gateway-status.test.ts`

**Interfaces:**
- Produces:
  - `interface GatewayChallengeStatus {read(cellId:string):Promise<ReadonlySet<string>[]>}` — one set of answerable names per known gateway.
  - `awaitAnswerable(status:GatewayChallengeStatus,cellIds:string[],hostname:string,options:{signal:AbortSignal;giveUpAt:number;pollMs?:number}):Promise<void>` — resolves once every gateway of every cell in `cellIds` lists `hostname` as answerable; otherwise rejects `challenge_not_answerable` at `giveUpAt`. Default poll is 500 ms.

- [ ] **Step 1: Write the failing tests**:
  - `waits until every gateway reports the name answerable`.
  - `a gateway that has the file but does not list the name keeps it waiting` — this is the file-present, route-absent case.
  - `gives up with challenge_not_answerable at the deadline`.
  - `a cell without gateway status stays unready`.
- [ ] **Step 2: Run** `pnpm --dir packages/remote-access exec node --test test/gateway-status.test.ts`; FAIL. **Implement**; run again; PASS.
- [ ] **Step 3: Commit** `git commit -s -m "Read the gateways' answerable check names"`.

### Task 6.5: The worker orders custom names with TLS-ALPN-01

**Files:**
- Modify: `packages/remote-access/src/reconciler.ts` (`CertificateIssueTarget.validation`, `#certificate`, `#staffCertificate`; option `gatewayStatus:GatewayChallengeStatus`). Keep `CertificateIssueTarget.dnsName` for the existing injected DNS issuers.
- Modify: `packages/remote-access/src/reconciler-files.ts`. Accept an optional absolute `challenges` directory per route when constructing `FileReconcilerArtifacts`. Injecting gateway status enables TLS-ALPN-01 for custom names. If that worker lacks a writable folder for any route cell, it refuses with `challenge_not_answerable` before ordering. A worker without that injection keeps its existing DNS path.
- Modify: `packages/remote-access/src/challenge-files.ts`. Write the four existing `ChallengeFile` fields through a mode-0600 temporary file named independently of the hostname, then rename. Sweep expired files on write, and delete the order's file on withdrawal. Expose these operations through `ReconcilerArtifacts` as `writeChallenge(cellId,file)` and `deleteChallenge(cellId,hostname)`.
- Test: `packages/remote-access/test/alpn-reconciler.test.ts`, `packages/remote-access/test/challenge-files.test.ts`.

**Interfaces:**
- Assigned names and custom names on the existing worker use `dns-01` with `_acme-challenge.<assigned>`. A worker with injected gateway status uses `tls-alpn-01` for its custom names.
- `present` writes to each cell from `routeCells` with `expiresAt = leaseUntil`, then waits for all their gateways with `awaitAnswerable` until the earlier of 45 seconds and 30 seconds before the order deadline.
- `withdraw` deletes the files in those cells. The order's `finally` also cleans them up.

- [ ] **Step 1: Write the failing tests**:
  - A custom order for a venue with a staged move writes to both cells and sends ready only once the gateway status includes its name. Both files are removed when the order ends, including after failure. Assigned names and custom names on the existing worker keep DNS-01.
  - A custom staff job with an unanswerable gateway keeps retrying after eight attempts.
  - A real `createAlpnCertificate` result survives a write and read through `readChallengeFolder`. A 237-character hostname fits on disk. Withdrawal and expiry sweep remove the intended files.
- [ ] **Step 2: Run** `test/alpn-reconciler.test.ts` through PostgreSQL and `test/challenge-files.test.ts` directly. Implement after RED. Re-run both, plus the affected public, staff and route tests.
- [ ] **Step 3: Commit** `git commit -s -m "Order custom-name certificates with the gateway's check"`.

### Task 6.6: A moved record stops renewal before any order

**Files:**
- Create: `packages/remote-access/src/dns-lookup.ts` (`boundedResolveCname`, moved from `packages/account-http/src/remote-access.ts:15-19`; add `"./dns-lookup"` to the package `exports`)
- Modify: `packages/account-http/src/remote-access.ts` (import it), `packages/remote-access/src/reconciler.ts` (a routing CNAME check with `boundedResolveCname` before a TLS-ALPN-01 order; accept `resolveCname` in `ReconcilerOptions`; write and clear `record_moved_at`)
- Modify: `packages/remote-access/src/placement.ts` (`setHostname`'s UPDATE also sets `record_moved_at = NULL`)
- Test: `packages/remote-access/test/record-moved-renewal.test.ts` and `packages/remote-access/test/dns-lookup.test.ts`. The existing account HTTP refusal test stays.

**Interfaces:**
- Produces:
  - `boundedResolveCname(name:string, custom?):Promise<string[]>` (1 s per try, 1 try, 3 s overall, rejecting `dns_not_verified`). Keep the existing resolver injection for the account API.
  - Use the reason-aware retry from Task 6.3 for `dns_not_verified`.
  - `remote_hostnames.record_moved_at` is set when DNS confirms a wrong or missing record. A failed lookup retries without changing the column. A passing record check or `setHostname` clears it.

- [ ] **Step 1: Write the failing tests**:
  - `a renewal for a custom name whose CNAME has moved starts no order and records dns_not_verified` — the issuer is called 0 times; `record_moved_at` is set; the last good chain stays.
  - `after eight moved-record failures the job is still pending and retries within 900 seconds` (Review Focus 1).
  - `a revision bump while the record is still moved keeps record_moved_at` — `schedule()` resets `last_error`; the column stays.
  - `once the record is right again the next pass orders and clears record_moved_at`.
  - The DNS lookup test checks a resolver that never answers is cut off at 3 seconds.
- [ ] **Step 2: Run** `node scripts/test-postgres.mjs exec pnpm --dir packages/remote-access exec node --test test/record-moved-renewal.test.ts`; FAIL. **Implement**; run it plus `node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test test/remote-access.test.ts`; PASS.
- [ ] **Step 3: Commit** `git commit -s -m "Check a custom name's record before renewing it"`.

### Task 6.8: Document the worker's two configurations

Describe the injected gateway status reader, the private check folders, readiness and the order reservation in `docs/local-remote-access.md`. Keep the existing owner instructions for two records. Explain in the integration contract that the box supplies the same CSR for either challenge. Update the backlog and service candidates with the wiring and one-record switch still open.


---

## PR 7 — Telling the owner their record moved

Build this after PR 8. The watcher cleared that sequence at 12:43 CET on 18 November
and the revised notice plan at 12:53 CET.

### Task 7.1: Incident kinds and the email text

**Files:**
- Create: `packages/registration/migrations/NNN_record_moved_incidents.sql` (`venue_incidents_kind_check` gains `public_record_moved` and `staff_record_moved` and keeps every current kind)
- Modify: `packages/registration/src/service-alert.ts` (`ServiceAlert.hostname?`, `target?`; record-moved alerts require both as hostnames, `certificateNotAfter` is optional, `checkedAt` is absent), `packages/registration/src/account-mail.ts`
- Test: `packages/registration/test/service-alert.test.ts`, `packages/registration/test/account-mail.test.ts` (or the file that already renders `service_alert` mail: `grep -ln "service_alert" packages/registration/test`)

Email text, `issues.<service>_record_moved` with substitution (EN / ES). The labels reuse "Public website"/"Sitio público" and "Staff access"/"Acceso del personal".
- With date: "Your DNS record for {hostname} no longer points at Waitron Cloud. Point it back to {target}, or this address stops working when its certificate expires on {date}." / "Tu registro DNS de {hostname} ya no apunta a Waitron Cloud. Vuelve a dirigirlo a {target}; si no, esta dirección dejará de funcionar cuando caduque su certificado el {date}."
- No date: "Your DNS record for {hostname} no longer points at Waitron Cloud. Point it back to {target}, or this address stops working when its certificate expires." / "Tu registro DNS de {hostname} ya no apunta a Waitron Cloud. Vuelve a dirigirlo a {target}; si no, esta dirección dejará de funcionar cuando caduque su certificado."
- `{date}` uses `Intl.DateTimeFormat(locale,{dateStyle:'medium',timeZone:'UTC'})`.

- [ ] **Step 1: Write the failing tests**:
  - `validServiceAlert accepts a record-moved alert without a date and refuses one without target`.
  - `the record-moved email reads the exact sentence in English and in Spanish, with and without a date`.
- [ ] **Step 2: Run** the two files through `test-postgres.mjs`; FAIL. **Write the migration and implement**; run again; PASS.
- [ ] **Step 3: Commit** `git commit -s -m "Add the record-moved alert and its wording"`.

### Task 7.2: Monitoring opens and clears the incident

**Files:**
- Modify: `packages/registration/src/monitoring.ts` — per service: enabled when the venue has remote access and the current name differs from `assigned_hostname`; bad when `remote_hostnames.record_moved_at` is set; evidence `{hostname, target:assigned_hostname, certificateNotAfter?}`; the two kinds join the owner selection query at line 165
- Modify: `packages/registration/src/email-outbox.ts` (the kind list at line 319), `packages/account-http/src/venue-overview.ts` (the kind list at line 21)
- Test: `packages/registration/test/record-moved-monitoring.test.ts`

- [ ] **Step 1: Write the failing tests**:
  - `the incident opens when record_moved_at is set and clears when it is cleared`.
  - `an opted-in owner gets the email in their saved language` — one EN and one ES owner; the outbox holds the exact sentences with `staff.cafe.example.test`, the target and the date.
  - `a revision bump while the record is still moved keeps the incident open and sends no second opening email`.
  - `an assigned name never opens it`.
- [ ] **Step 2: Run** `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/record-moved-monitoring.test.ts`; FAIL. **Implement**; run it plus `test/monitoring.test.ts test/monitoring-action-mail.test.ts test/email-reminders.test.ts`; PASS.
- [ ] **Step 3: Commit** `git commit -s -m "Alert owners when their DNS record stops pointing at Cloud"`.

### Task 7.3: The owner's reading and Check again

**Files:**
- Modify: `packages/account-http/src/remote-access.ts` — status `names[kind]` gains `recordMoved:boolean` (from `record_moved_at`) and `certificateNotAfter:string|null`; new action `recheck` with fields `installationId`, `kind`
- Modify: `packages/remote-access/src/placement.ts` (`recheckHostname`)
- Test: `packages/account-http/test/remote-record-moved.test.ts`

**Interfaces:**
- Produces: `RemoteAccessStore.recheckHostname(id:string,kind:'staff'|'public',resolve=boundedResolveCname):Promise<void>`.
  - It runs under the same plan check as `#assigned`.
  - For a custom name it runs `verifyDelegation`. On success, in one transaction, it clears `record_moved_at` and sets the `certificate_<kind>` job to `status='pending', available_at=clock_timestamp(), attempts=0, last_error=NULL` when that job is not running.
  - On failure it throws `dns_not_verified` and changes nothing.
  - The route uses `status`'s session, owner check and `remote-account` rate rule, and maps `dns_not_verified` to 400.

- [ ] **Step 1: Write the failing tests**:
  - `status shows recordMoved only for the affected name, with its target and expiry`.
  - `another venue's owner and a non-owner member get 403 and no reading`.
  - `recheck with the record right clears the notice and makes the job due now`.
  - `recheck with the record still wrong answers dns_not_verified and changes nothing` (the job row and the hostname row are byte-identical).
  - `a later successful certificate also clears it`.
- [ ] **Step 2: Run** `node scripts/test-postgres.mjs exec pnpm --dir packages/account-http exec node --test test/remote-record-moved.test.ts`; FAIL. **Implement**; run it plus `test/remote-access.test.ts test/remote-refusal-guidance.test.ts`; PASS.
- [ ] **Step 3: Commit** `git commit -s -m "Show owners a moved record and let them check again"`.

### Task 7.4: Portal notice, button and alert list; docs

**Files:**
- Modify: `apps/portal/src/remote-types.ts`, `apps/portal/src/remote-controller.ts` (`recheck(kind)`; on 400 `dns_not_verified`, the existing `remoteDnsWait` error), `apps/portal/src/remote-screen.ts` (the notice beside the affected name), `apps/portal/src/locale.ts`, `apps/portal/src/installation-types.ts`, `apps/portal/src/diagnostic-types.ts`, `apps/portal/src/alert-screen.ts` (the two kinds beside the route kinds)
- Modify: `docs/local-remote-access.md` (the notice, Check again, and when it shows: only at renewal attempts, from 30 days before expiry), `docs/local-monitoring.md` (the two kinds), `docs/backlog/service-monitoring.md`, `docs/backlog.md`
- Test: `apps/portal/test/remote-record-moved-browser.test.ts`, `apps/portal/test/remote-controller.test.ts`, `apps/portal/test/accessibility.test.ts`

Copy: `remoteRecordMoved` and `remoteRecordMovedNoDate` use Task 7.1's exact EN/ES sentences. `remoteCheckAgain` is "Check again" / "Comprobar de nuevo".

- [ ] **Step 1: Write the failing tests**:
  - `the notice shows for the affected name only, in English and in Spanish, with its target and date`.
  - `Check again clears it after a successful reply`.
  - `a still-wrong record shows the existing DNS refusal`.
  - `recheck posts installationId and kind and reloads status`.
- [ ] **Step 2: Run** `node scripts/test-postgres.mjs exec pnpm --dir apps/portal exec node --test test/remote-record-moved-browser.test.ts test/remote-controller.test.ts`; FAIL. **Implement**; edit the docs; run them again plus `test/accessibility.test.ts` and `node --test scripts/ci-docs.test.mjs`; PASS. Look at it in EN/ES, light/dark, at 390 and 1280 wide.
- [ ] **Step 3: Commit** `git commit -s -m "Tell owners in the portal when their record has moved"`.

---

## PR 8 — Wire the worker, switch to one record and run the two-cell Pebble proof

### Task 8.1: Pebble checks on 443; measure CNAME following

**Files:**
- Modify: `scripts/remote-fixtures.mjs` — `startAcme` writes a copy of the image's `test/config/pebble-config.json` with `"tlsPort": 443` (the pinned image says `5001`), mounts it and passes `-config /config/pebble-config.json`; export `setCname(name,target)`, `addA(name,address)` and `connectGateway(container)` (joins the gateway to the ACME network)

- [ ] **Step 1: Measure.** Set `setCname('staff.cafe.example.test','staff-v-<id>.venues.example.test')` and `addA('staff-v-<id>.venues.example.test',<gateway IP>)`, then order TLS-ALPN-01 for `staff.cafe.example.test`. Rule: if Pebble reaches the gateway through the CNAME, the proof uses CNAME + A. If not, it also adds an A record for the custom name and records `"cnameFollowed": false` in the receipt and the doc.
- [ ] **Step 2: Run** `node scripts/test-local-acme.mjs`; read the `PASS` lines. **Commit** `git commit -s -m "Let local Pebble check TLS-ALPN-01 on the gateway's 443"`.

### Task 8.2: Wire custom issuance and switch the portal and API together

Give the runnable worker its own status-only path. The gateway writes the answerable-name status there and the worker reads it. The worker never reads the gateway's WireGuard key directory. Mount check folders read-only on the gateways and writable only by the worker that presents certificates.

In the same pull request, change `dnsInstructions` to return only the routing CNAME and make `verifyDelegation` check that record. Share the response shape with `validRemoteDns`. Preserve the 237-character limit, refusal of incorrect or missing targets, and every venue and owner check. Update the operator DNS command test, the account API response and apply tests, and the portal and browser fixtures together. Verify that a venue with an existing two-record setup still renews after the switch. Reloading the portal updates an open old form.

Copy (EN / ES):
- `remoteDnsHelp`: "Create this CNAME record with your domain provider. It directs your name to the venue, and lets Cloud get its certificate." / "Crea este registro CNAME con tu proveedor de dominio. Dirige tu nombre al local y permite que Cloud obtenga su certificado."
- `remoteDnsApex`: "Use a subdomain such as staff.your-cafe.es. Keep this record while you use this name. DNS updates may take time to appear." / "Usa un subdominio como personal.tu-cafe.es. Conserva este registro mientras uses este nombre. Los cambios de DNS pueden tardar en aparecer."
- `remoteDnsWait`: "The DNS record must point to the shown target. Check it with your provider, allow time for propagation, then try again." / "El registro DNS debe apuntar al destino indicado. Compruébalo con tu proveedor, espera a que se propague y vuelve a intentarlo."
- Any other "both records" / "ambos registros" / `_acme-challenge` string: find with `grep -n "both\|ambos\|_acme-challenge" apps/portal/src/locale.ts`.

Run the setup and browser tests before and after the switch. Look at English and Spanish in light and dark at 390 and 1280 pixels.

**Proof wiring:**
- Modify: `scripts/test-local-remote.mjs` — the worker gets the two private check folders in `FileReconcilerArtifacts`, an injected `gatewayStatus` and a `resolveCname` that uses Pebble's test DNS; one venue's custom staff and public names are saved through `setHostname` with one CNAME; issuance goes through the real gateway; one of them is renewed
- In that script, wire both `startGateway` (source) and `startTargetGateway` (destination) to set `GATEWAY_CHALLENGES` and mount their own private check folder read-only. Only the proof worker writes the folders. Read only each cell's `status.json` through the existing `gatewayFile` path, including its Linux fallback. Check both launches for the setting and read-only mount, and include the new mount in the existing box-key absence check.
- The custom-name proof runs the certificate command with Pebble's test root and a test-only
DNS adapter. The command reads the status-only file as the Linux test user. The watcher
cleared this proof on 18 November at 13:39 CET, including a destination renewal and a
separate run of the same move using assigned names.

- [ ] **Step 1:** Add the phase. It asserts that both custom names answer with certificates from Pebble's root, that the renewed one has a new serial, and that the box's private key is absent from the gateway (the existing check).
- [ ] **Step 2: Run** the proof (as in "Run the proof"); read every `PASS`. **Commit** `git commit -s -m "Prove one-record custom names through the real gateway"`.

### Task 8.3: A two-cell move with the owner's record untouched; docs

**Files:**
- Modify: `scripts/test-local-remote.mjs` (after the existing move: both addresses answer through the new cell; the owner's CNAME is unchanged; Cloud's stable-name CNAMEs switched at commit), `scripts/verify-cell-movement-receipt.mjs`, `scripts/verify-cell-movement-receipt.test.mjs` (the receipt gains `customNames:{staff,public,renewed,cnameUntouched}`)
- Modify: `docs/local-remote-access.md` ("Run the proof"'s list of checks; delete "The single-suffix trial does not exercise that move" and the unqualified cross-suffix paragraph), `docs/launch-evidence.md` (if it lists remote proof checks), `docs/backlog/decisions-in-progress.md`, `docs/backlog/service-candidates.md`, `docs/backlog.md` — say what is proved locally and what stays open: live Let's Encrypt, the real zone, production keys, multi-gateway coordination carrying the answerable check-list signal, when to fail over, readying a replacement cell

- [ ] **Step 1: Write the failing verifier test**: a receipt without `customNames.renewed===true`, or with `cnameUntouched!==true`, is refused.
- [ ] **Step 2: Run** `node --test scripts/verify-cell-movement-receipt.test.mjs`; FAIL. **Extend the proof**; run the proof and both verifiers; PASS. Edit the docs; `node --test scripts/ci-docs.test.mjs`.
- [ ] **Step 3: Commit** `git commit -s -m "Prove a two-cell move keeps the owner's record and the venue's names"`.

PR4 run-it corrections cleared by the watcher on 2026-11-18 at 04:03: public jobs keep retrying with the existing 900-second backoff cap; move readiness uses the destination copy even when its old source is unavailable; the worker removes venue-named gateway copies from mapped cells without the route. Staff and route parking remain unchanged. No new table or delivery ledger.

The watcher cleared final-read delivery corrections at 04:33 on 18 November: keep valid issued private material before gateway delivery, attempt every mapped current cell, record actual copied cell IDs in the existing digest, expose retrying CLI jobs, and test recovery of an expired eighth public claim. A move gate reads the latest worker delivery fact; the running worker clears that fact on observing expiry. The file checks now retain the new private copy and the old bytes at an undelivered gateway; manifest failed-write checks stay unchanged.
