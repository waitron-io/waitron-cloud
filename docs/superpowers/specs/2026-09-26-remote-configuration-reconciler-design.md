# Remote Configuration Reconciler Design

## Outcome

Cloud continuously publishes signed gateway routes and renews public and staff TLS certificates for every active remote-access placement. Work survives process restarts, duplicate workers cannot publish the same claim concurrently, hostname or placement changes fence late certificate results, and a failed renewal never replaces a usable certificate. This is local integration only: the worker uses explicitly configured DNS/ACME and filesystem adapters and does not enable live DNS or issuance.

## Boundaries

- Cloud owns desired placement, signed gateway manifests, ACME orchestration and public certificate material.
- Waitron owns the staff private key and its existing CSR/install commands. The Cloud worker reads a supplied CSR and publishes only the returned chain; it never receives the private key.
- The gateway continues to accept only signed, expiring manifests through its existing authority interface.
- No new Waitron API, live provider, deployment system or customer-facing activation is part of this change.

## Chosen approach

Use a PostgreSQL-backed target ledger and leased worker. A scheduler projects current cells and active placements into one route target per cell and two certificate targets per placement. Each target records a digest of the desired state, the last applied digest, its next due time, bounded attempts and a short claim lease. A changed digest becomes immediately due; unchanged routes refresh before the ten-minute gateway authority expires, while unchanged certificates are checked daily.

This is preferred over extending the current in-process `export --watch` loop because a file loop cannot reconcile duplicate processes or retain restart state. It is preferred over adding an external queue because PostgreSQL already owns the authoritative placement transaction and the repository already uses leased PostgreSQL workers.

## Desired state and claims

Route digests cover the exact ordered route projection for a cell, including valid staged moves and revocation. Certificate digests cover installation, kind, configuration revision, hostname and delegated ACME name. Scheduling is serialized in a short database transaction; targets that disappear are disabled, not deleted while a worker may still hold a lease.

A worker claims one due row with `FOR UPDATE SKIP LOCKED`, assigns a random claim ID and leases it for two minutes. Route publication generates a fresh signed manifest after the claim. Certificate work reads the current CSR and existing certificate from the configured artifact adapter; it skips issuance when the existing chain still matches the current hostname, key and renewal window. Failures release the lease with bounded exponential retry and a fixed redacted error code. Eight consecutive failures park the target until a desired-state change or an operator retry resets it.

## Publication and fencing

All filesystem writes use a same-directory temporary file, file sync, rename and directory sync. The prior file remains untouched if issuance or validation fails.

Certificate issuance may wait on DNS and ACME. Immediately before publication, the worker re-authorizes the CSR against the locked current installation and compares hostname, delegated name and configuration revision with the claimed target. A changed or revoked placement rejects the late result. The staff chain is then installed in the local proof through Waitron's landed `cloud-certificate.ts install` interface; staff key generation and storage remain entirely in Waitron.

Route manifests are generated from a fresh transaction after the claim, signed with the configured cell key, and atomically published. A concurrent placement change changes the scheduled digest and leaves another due run; every manifest retains the existing ten-minute authority limit. No failed write truncates or replaces the last usable manifest.

## Trusted adapter configuration

The reconciler CLI accepts one mode (`--once`, `--status`, or continuous) plus a trusted local JSON file. It names the manifest directory, an explicit cell-ID-to-Ed25519-signing-key mapping, ACME directory/account/email, a DNS module exposing the existing `present/remove` interface, and an explicit certificate mapping of installation ID + kind to CSR and output paths. Paths and modules are operator-controlled local inputs, never customer URLs or request fields. Missing mappings fail only their target and appear in status; they do not broaden filesystem access.

## Verification

Real PostgreSQL tests cover scheduling, concurrent claims, restart after an expired lease, bounded failure, revocation, hostname changes during an external wait and unchanged-certificate checks. Local Pebble and DNS fixtures prove initial issuance, renewal, duplicate suppression and failed renewal retaining the previous chain. The existing local two-venue gateway proof consumes reconciled signed manifests and installs the staff chain with Waitron's existing command, then checks public and staff TLS, restart and hostname isolation. A machine-readable receipt distinguishes local adapter evidence from live provider work.

## Remaining work after this change

Live DNS/provider credentials, public deployment, production key storage, provider-native gateway rollout and automatic transport of the staff CSR/chain to an appliance remain separate. Any new on-prem delivery protocol waits for free Waitron ownership and a reconciled contract.
