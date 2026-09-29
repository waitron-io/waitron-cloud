# Staff certificate transport

The installation sends its own CSR over the existing signed machine envelope and
reads back a chain bound to that request. Its private key stays on the appliance.
This is local integration work; no deployment, provider account or Waitron edit.

Use two machine actions, `staff-certificate-submit` and `staff-certificate-status`,
with version 1 bodies. Submit carries the exact current hostname and configuration
revision, CSR, and previous request ID (null for the first request). The signed
operation ID identifies the submission. One PostgreSQL row per installation bounds
storage. An exact retry reads that row without rescheduling; conflicting reuse or an
outdated predecessor fails. Status never returns a superseded or stale chain.

The existing installation proof, live lease, placement, CSR hostname/key validation
and revocation lock remain authoritative. Customer input cannot select filesystem
paths, provider modules, credentials, tenant IDs or cells. The optional database
staff mode of the existing reconciler includes request identity in its desired
state and publishes under the job lease, installation and request locks. It keeps
the previous chain during failed issuance and fences changed requests, hostname,
revision, revocation and shutdown. Public certificates retain the file adapter.

Implementation and validation, inline under the campaign authorisation:

- [x] Add PostgreSQL/HTTP red-first tests in account-http for signed submission,
  exact retry, two tenants, predecessor/key conflicts, origin/lease/revocation and
  strict input. Add one bounded SQL migration and the machine actions, exchange
  store and HTTP route. Run through scripts/test-postgres.mjs.
- [x] Add red-first reconciler tests for successful publication, renewal, failed
  issuance retention, concurrent replacement and stale configuration/claim refusal.
  Implement optional database staff mode and trusted CLI configuration.
- [x] Run a two-installation Pebble/DNS proof using Waitron's unchanged CSR/install
  command. Check key/hostname matching and retained chain after failures, with all
  temporary state and owned containers removed. Document precise proof limits.
- [ ] Update the wire contract, remote-access guide and backlog. Run focused suites,
  migration guards and typecheck; delete critical guards in a disposable candidate.
- [ ] Finish with one Claude security/run-it review, triage, normal push and exact-head
  CI. Land under the shared lock and record exact-merge CI.

Review focus: replay after supersession, revocation during ACME, a new CSR during
issuance, retained old chain accidentally returned for a new key, and database/job
lock ordering. Tests exercise these before external review. Appliance scheduling,
authenticated transport client, local desired-state fencing and TLS reload remain
Waitron work; the local proof invokes its existing commands explicitly.
