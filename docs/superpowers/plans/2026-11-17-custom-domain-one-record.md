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

> **Built.** PRs 1–8 are on main; what is left is in the backlog. Their step-by-step text was removed on 24 November 2026; read it with
> `git show 3c69f4903:docs/superpowers/plans/2026-11-17-custom-domain-one-record.md`.
