# Identity upstream review, 2026-10-12

You can reproduce this inventory with the source-report command in [SOURCE.md](../packages/identity/SOURCE.md). The original copy revision stays unchanged; the reviewed revision advances only after every mapped source and behavioural-test change has been considered.

Reviewed through Waitron `b9440c685e440d37d5bc65a7feade840ceacf1c9`. The report includes 18 commits across five existing source files and their tests (including the password-verifier wrapper; email recovery is Cloud-owned), including three test-only maintenance commits.

| Waitron commit | Cloud decision and evidence |
| --- | --- |
| [2741f60cdc2a (#426)](https://github.com/clintongormley/waitron/commit/2741f60cdc2a3acb93aef476a2f94d2ea5f9e241) | No port: Cloud keeps PostgreSQL foreign keys and checks current account state in resolveSession; identity lifecycle tests pass. |
| [e87d0f2b886a (#437)](https://github.com/clintongormley/waitron/commit/e87d0f2b886ac112cbbfd56b540eb8c8df0ddd4a) | No port: Vitest upgrade and a pending-person regression. Cloud uses node:test and has no pending account status; current suspension checks are covered by identity.test.ts. |
| [d3a6f8d92959 (#453)](https://github.com/clintongormley/waitron/commit/d3a6f8d9295928c13835ae5a9dd01fbc56ef19de) | Port algorithm pin to both registration halves. Cloud already uses server 14.0.3. Real-library regression rejects ML-DSA-44 and enrols ES256. |
| [a771d130d8e6 (#461)](https://github.com/clintongormley/waitron/commit/a771d130d8e6b7aae91d862ddafb427049137f0c) | No port: Waitron database-test helper replacement. Cloud uses isolated real PostgreSQL via scripts/test-postgres.mjs. |
| [aabdde6a8ee0 (#489)](https://github.com/clintongormley/waitron/commit/aabdde6a8ee0bd2dfeb64cd1b98739defa80f8f2) | No port: SQLite storage and email uniqueness adaptation; Cloud stays on PostgreSQL with normalized email and row-lock rechecks. |
| [fc8753a6601c (#492)](https://github.com/clintongormley/waitron/commit/fc8753a6601cd8232056c02b5c3880f61eef7624) | No port: remove PostgreSQL test comments after SQLite migration. Cloud still tests PostgreSQL. |
| [339a6391ef23 (#543)](https://github.com/clintongormley/waitron/commit/339a6391ef236ba6bb37ad745aca0758582a77c2) | Already adapted: permission checks can use passive session resolution. Cloud exposes `withPassiveRead` and `touch: false`; identity.test.ts verifies passive reads do not extend expiry. Uploaded-photo handling is Waitron-owned. |
| [56be8198a287 (#554)](https://github.com/clintongormley/waitron/commit/56be8198a287a7eb3eac9f6ff17a89870dbe3cc2) | Already adapted: token and CSRF hashes, opaque bearer values, passive reads and current suspension checks. identity.test.ts rejects a stored hash as a token. |
| [8636f36b2310 (#559)](https://github.com/clintongormley/waitron/commit/8636f36b2310c3e6c0b0253136356d52af5774f4) | No port: upstream comment shortening. Cloud comments describe its own lock ordering and credential recheck invariants. |
| [1cfd2551b025 (#729)](https://github.com/clintongormley/waitron/commit/1cfd2551b0256b47d3274ff4169b1e390a555779) | Already adapted: hashSecret and verifySecret use asynchronous scrypt and strict full-length hexadecimal parsing. secret-hash.test.ts and identity.test.ts pass. |
| [8af89171a458 (#900)](https://github.com/clintongormley/waitron/commit/8af89171a458386b67916123db57e768efdee788) | Already adapted: awaited password verification and dummy derivation for unknown/disabled/passwordless accounts. identity.test.ts verifies generic failure and one derivation. |
| [34eb1c15d45f (#912)](https://github.com/clintongormley/waitron/commit/34eb1c15d45f70a8a24c677766b801c374ae8b31) | Already adapted: asynchronous secret checks; no synchronous verifier export. secret-hash.test.ts passes. Print-agent and join-status callers are Waitron-owned. |
| [9488fee2daf3 (#926)](https://github.com/clintongormley/waitron/commit/9488fee2daf30856351352fb43e3e83930c69e56) | No port: required authenticator key for promotion/by-ID login. Cloud has neither path; its optional authenticator design awaits an owner decision. |
| [51caa167c308 (#930)](https://github.com/clintongormley/waitron/commit/51caa167c3086925b52e19434fdb5a8ec2f4005c) | Already adapted: email-login refusals expose only credentials_invalid. Cloud has no by-ID login or enrolled authenticator yet. identity.test.ts covers wrong/unknown/disabled/missing-password attempts. |
| [eff6dd3f7028 (#939)](https://github.com/clintongormley/waitron/commit/eff6dd3f702808adbe1fc0b0746f036d643cf94b) | Already adapted: registration uses Cloud email for both passkey names (Cloud has no separate account display name). Real options test checks the email. |
| [4ff93586171a (#945)](https://github.com/clintongormley/waitron/commit/4ff93586171a2ca034e4136106346e901e616939) | Security property already adapted: last-used time and nondecreasing counters. Provider-name display is an optional UI enhancement, outside this security port; existing passkeys.test.ts covers counters and listing. |
| [7c17c5bd58a9 (#948)](https://github.com/clintongormley/waitron/commit/7c17c5bd58a908de824b44f89c8756859099a7e2) | No security port: browser credential synchronization and a distinct unknown-key error are UX changes. Cloud retains its generic passkey_invalid contract; identity display names are not needed by Cloud sessions. |
| [b0f1cdb5b5c6 (#1117)](https://github.com/clintongormley/waitron/commit/b0f1cdb5b5c66011d847fe6050e26f81062decb5) | Already adapted for PostgreSQL: login derives before account/credential row locks and rechecks both afterwards. Failed-password lock and changed-password/suspension contention tests pass. Cloud has no SQLite-wide write queue or PIN path. |

Run these focused checks from the Cloud checkout:

```sh
node --test scripts/identity-upstream.test.mjs
pnpm --dir packages/identity test
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test test/identity.test.ts test/passkeys.test.ts test/password-recovery.test.ts
```

The passkey regression uses the real WebAuthn library, generated public keys and real PostgreSQL. Removing either algorithm argument independently fails its corresponding regression. A further real-library test signs in with a pre-existing ML-DSA credential and advances its counter, so narrowing new registration does not remove that existing access. Failed new registration cannot reuse its consumed ceremony. Browser credential synchronization and provider-name display remain optional follow-ups, not security fixes.
