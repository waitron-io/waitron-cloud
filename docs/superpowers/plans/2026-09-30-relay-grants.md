# Disabled relay grants and account reservations

**Goal:** implement slice 1 of [the relay contract](../../transactional-email-relay-contract.md) without a send route or production enablement.

**Design:** Keep this core in registration, beside support grants. A constructor without configuration refuses grant creation and reservations. The only configured mode is `local-proof`, limited to `test` installations. It requires an explicit owner-consent version, a trusted origin verifier and a complete allowance policy. There is no environment-variable wiring or HTTP adapter. A production origin-verification adapter, consent UI and enablement policy remain separate owner decisions.

The trusted verifier receives the installation ID, canonical HTTPS management origin and a fresh challenge. It must return that exact binding, successful domain-control and HTTPS checks, and an expiry. No request field can supply verification evidence. Verification runs before taking database locks; approval rechecks its expiry after acquiring locks. Tests exercise the boundary with synthetic verifier evidence; this is not a live domain-verification proof.

A single grant per installation binds the consenting verified account, organisation, venue, environment, installation public key, origin, consent version, revision and expiry. Reapproval requires the current revision and advances it; revocation is terminal for that revision. New ownership requires new explicit consent. Reservations recheck all stored authority, even on replay. Nothing reads or activates paid services.

Each reservation has an installation/message identity and a nonsecret replay binding. The core never receives recipient/token/code fields. The account is derived from the grant. Account serialization and a persistent account-to-policy binding prevent several venues, retries, re-pairing or a different process configuration from minting more allowance. Policies specify positive unit count, UTC epoch, fixed period duration, version, retained admission debit and explicit refusal at excess. Changing an account's policy is unsupported until a separate migration policy is approved. Original period attribution survives replay after rollover.

Lock order: approval resolves account/session, verifies credentials, then locks owner membership, venue, installation, an installation advisory lock (including first approval), and the grant. Reservations lock account/credentials, membership, venue, installation and grant before taking the account allowance advisory lock and policy locks. Revocation resolves account/session and locks membership before updating the grant; it needs neither advisory lock. Use row-share locks on authority to fence deletion/revocation. After lock waits, read database wall-clock time for deadlines and period selection. A savepoint probe refuses autocommit clients before writing; the transaction-scoped reservation method lets slice 2 insert its encrypted queue record atomically; trusted callers must authenticate the installation under the same transaction, never pass payload identity as authority.

## Tasks and checks

- [x] Add PostgreSQL behavior tests for disabled startup, consent/CSRF/ownership, verifier binding, revision changes, account disablement/unverified email, installation expiry/replacement/key change, revocation and origin changes. Observe failures before implementation.
- [x] Add migration 031, `relay-grants.ts` and registration migration manifest entry. No change to machine action catalogue, HTTP routes, startup, paid services or existing mail code.
- [x] Add reservation tests for two accounts, several venues, concurrent distinct and duplicate operations, body conflicts, forged account attribution, rollover, rollback and a new process using the same database. Implement reservation tables and transaction-scoped method after observing failures.
- [x] Run `node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/relay-grants.test.ts test/account-mail.test.ts test/email-outbox.test.ts test/schema-compatibility.test.ts`, plus typecheck. Preserve all existing assertions.
- [x] Update contract/backlog and explain local-only configuration, verifier evidence boundary and remaining production decisions. Run critical-guard mutations in the disposable finish-branch review candidate.
- [ ] Signed-off commit, initial rebase, one Claude security/run-it review, triage, normal push and exact-head CI. Land under the shared lock, install dependencies, clean up the owned branch/worktree and record exact-merge CI.

## Review focus

Exercise grant replacement racing reservations, identity changes while waiting for a lock, expiry during contention, forged account/public-key attribution, two stores with different policy values, and admission rolled back after a successful reservation. Confirm no relay route exists on normal startup and existing account mail remains independent. No production values are implied by test fixture numbers.
