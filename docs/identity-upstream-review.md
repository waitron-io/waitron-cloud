# Identity upstream review

You can reproduce this inventory with the source-report command in [SOURCE.md](../packages/identity/SOURCE.md). The original copy revision stays unchanged; the reviewed revision advances only after every mapped source and behavioural-test change has been considered.

Reviewed through Waitron `60dcf75a5132af8878d8a88aee36d78deb125c54`. Later commits are outside this review.

## 2026-10-12

The original review through `b9440c685e440d37d5bc65a7feade840ceacf1c9` includes 18 commits across five existing source files and their tests (including the password-verifier wrapper; email recovery is Cloud-owned), including three test-only maintenance commits.

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

## 2026-11-10

The source-report command found these 11 mapped commits after the October marker through `0b7f37048f4bc5dff92b0b527d33c7767fbf49eb`. Each decision below comes from its mapped source/test diff; no production or test code changes were needed.

| Waitron commit | Cloud decision and evidence |
| --- | --- |
| [69fb3fdf0fd6 (#2032)](https://github.com/clintongormley/waitron/commit/69fb3fdf0fd6714b98f6719ae2478d5fd84bc54a) | No port: the mapped delta changes a disabled staff passkey test and comment for Waitron’s credential deletion. Cloud has no local staff Disable operation; its account-state checks remain Cloud-owned (`packages/identity/src/sessions.ts:86–90`). Source review only. |
| [80563e1420e9 (#2036)](https://github.com/clintongormley/waitron/commit/80563e1420e9b19235c27d8c0e196e49f2c19255) | No port: extracts `SECRET_HASH_PREFIX` for the staff personal-data export. The stored scrypt format is unchanged; Cloud has no consumer for that exported constant. |
| [521292d7fb97 (#2257)](https://github.com/clintongormley/waitron/commit/521292d7fb979deb68f04f0e40188e467c61877e) | Already adapted for Cloud’s two kinds: `packages/registration/src/passkeys.ts:208–221` binds each challenge to registration or authentication; registration also checks account and session. The existing `expired and wrong-kind ceremonies cannot be completed or revived` case passes. The new own-passkey action check is a separate Waitron flow, not added here. |
| [d4cb66280385 (#2331)](https://github.com/clintongormley/waitron/commit/d4cb662803856f665e0ee946c0344b5465dd04ea) | No port: protects box timestamps against a backward JavaScript-clock step. Cloud uses PostgreSQL time for session creation/touch and ceremony creation/expiry (`002_identity.sql:10–12`, `sessions.ts:96–106`, `passkeys.ts:94–98,140–143,210–221`). This source distinction does not test or rule out a database-clock rollback. |
| [ccbec1f3c178 (#2473)](https://github.com/clintongormley/waitron/commit/ccbec1f3c17896b2374bdd360c38359961624494) | No security port: replaces a client-supplied passkey name with a verified provider name. Provider-name display remains optional Cloud UI work; no challenge-verification change in this delta. |
| [da87ffa7d846 (#2484)](https://github.com/clintongormley/waitron/commit/da87ffa7d84601ce0473887799babc3e5e0b295f) | No port: adds `personIdForLoginEmail`, including a process-keyed synthetic ID for an unknown address, for a handover seam that signs in by ID. Cloud’s password-login store passes the email directly to its own authority check (`packages/registration/src/password-login.ts:89`), rather than using this handover lookup. Source review only. |
| [cc8bab7db1ac (#2512)](https://github.com/clintongormley/waitron/commit/cc8bab7db1ac6229c7c8ca4ea96c32a2238b94a7) | No port: moves the `PersonRoleValue` type import to `@waitron/shared`. Cloud keeps its own account and platform permissions. |
| [2aa12bf9689a (#2516)](https://github.com/clintongormley/waitron/commit/2aa12bf9689a808787b2783269686f011223e4e1) | No port: moves table imports to `@waitron/db`. Cloud’s PostgreSQL tables and handwritten migrations remain separate. |
| [eed41cc3c02b (#2539)](https://github.com/clintongormley/waitron/commit/eed41cc3c02b7b0406963c662ede0183f59aed15) | No port: changes upstream test migration setup after the SQLite migration squash. Cloud’s applied SQL migration files are not changed. |
| [fb497ef8ede8 (#2525)](https://github.com/clintongormley/waitron/commit/fb497ef8ede821aba35ddc873d63a570249c2edd) | Already covered in source by the retention worker, rather than on each login-options request: `packages/registration/src/history-cleanup.ts:122–129` selects expired unconsumed ceremonies without an account filter, subject to its retention cutoff. No existing test directly proves never-consumed anonymous cleanup; this decision is source-only. |
| [049ddd9db95f (#2666)](https://github.com/clintongormley/waitron/commit/049ddd9db95fe6bf837be77046c5efc7fc50c7cc) | No port: adds an assertion that a new Waitron session has no fresh action proof. Cloud has no `proved_at` action-proof session field; it retains its own password re-entry flows. Source review only. |

Run the existing ceremony check against throwaway PostgreSQL:

```sh
node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec node --test --test-name-pattern='expired and wrong-kind ceremonies cannot be completed or revived' test/passkeys.test.ts
```

The campaign runs that command through `test-box-run.sh G <checkout>`. The upstream-report tests and an empty `commits` array at the fixed target check the inventory, not the source-only decisions.

## 2026-11-20

The source report found 17 commits across 14 mapped source and test files after `0b7f37048f4b`. The decisions below come from reading those diffs alongside Cloud’s source. The review found no identity change to port.

| Waitron commit | Cloud decision and evidence |
| --- | --- |
| [`eb2bfdb10864` (#2786)](https://github.com/clintongormley/waitron/commit/eb2bfdb10864b959fc087e5f79eced7216eb4e31) | Cloud already supports session reads that leave the idle deadline alone. The Waitron change serves long-lived box event streams. Cloud session reads use PostgreSQL account and session locks (`packages/identity/src/sessions.ts:89–123`). |
| [`204951dda0d9` (#3037)](https://github.com/clintongormley/waitron/commit/204951dda0d98c679d3328e9786e94d38ea5e2ef) | The change reads Waitron person permissions. Cloud checks its own platform grants (`packages/identity/src/sessions.ts:174–178`). |
| [`8fab2694144f` (#3068)](https://github.com/clintongormley/waitron/commit/8fab2694144f5472b0c39e5ce6581aeae40f369e) | The change puts Waitron's local roles in membership rows. Cloud retains its own organisation memberships and platform grants (`packages/identity/src/sessions.ts:174–178`, `packages/identity/src/organisation-scope.ts:5–8`). |
| [`139916df0dd1` (#3135)](https://github.com/clintongormley/waitron/commit/139916df0dd1ec20a47a5c182ab83716e69a6af9) | Waitron exports its normalised email lookup for joining a spare box. Cloud already folds email before looking up account credentials (`packages/identity/src/sessions.ts:47–64`). |
| [`737efc2adf19` (#3216)](https://github.com/clintongormley/waitron/commit/737efc2adf19e13607e7c2d3bf796779c8f2f8ae) | Cloud already uses asynchronous scrypt to create and verify password hashes (`packages/identity/src/secret-hash.ts:8–23`). |
| [`c783bf26a47d` (#3347)](https://github.com/clintongormley/waitron/commit/c783bf26a47d8f0881bd51d1802c3d93ae7a1993) | The change admits Waitron's separate box addresses for passkeys. Cloud pins its configured portal origin for both ceremonies (`packages/registration/src/passkeys.ts:57–73,114–116,185–188`). |
| [`911d500d3031` (#3364)](https://github.com/clintongormley/waitron/commit/911d500d3031a77da064a450230a6eff61134700) | Waitron adds a passkey check for its emergency switch. That check belongs to the box’s switch action. Cloud uses its own login assertion and records the credential counter and last use (`packages/registration/src/passkeys.ts:181–200`). |
| [`f587e672df03` (#3476)](https://github.com/clintongormley/waitron/commit/f587e672df034fb89c7d15ab5906e41d467a3d73) | Waitron adds security notices including passkey enrolment. Cloud already sends password and email change notices. Passkey enrolment mail is a separate product change (`packages/registration/src/account-security.ts:37,72`). |
| [`c3df226914df` (#3490)](https://github.com/clintongormley/waitron/commit/c3df226914dfde5c5601986f2b7c0bc900457d18) | Waitron adds a restricted invoice-inspector sign-in for its local reporting screen. Cloud uses its own account and permission checks (`packages/identity/src/sessions.ts:174–178`). |
| [`8b60f3e74de0` (#3554)](https://github.com/clintongormley/waitron/commit/8b60f3e74de0621d832ccec3a0834365e25d61b2) | The change ties Waitron sessions to their person rows. Cloud sessions already reference Cloud accounts in the database (`packages/registration/migrations/002_identity.sql:9`). |
| [`30c1c1c56498` (#3573)](https://github.com/clintongormley/waitron/commit/30c1c1c56498d3adeb7c8065cc6f03eb63dfdfb4) | Waitron consolidates challenge tables and derives passkey display names. Cloud already checks the challenge kind, session and expiry, and its retention job removes old challenges (`packages/registration/src/passkeys.ts:224–244`, `packages/registration/src/history-cleanup.ts:123–131`). |
| [`ee033c733fc9` (#3586)](https://github.com/clintongormley/waitron/commit/ee033c733fc93e8290face900ca70bac722aa5f8) | Waitron records local sign-ins and stops copying email targets. Cloud retains ended sessions. Before changing email, it checks the pending request against the initiating session, security revision and prior credential (`packages/identity/src/sessions.ts:126–130`, `packages/registration/src/account-security.ts:64–73`). |
| [`8c549477da71` (#3603)](https://github.com/clintongormley/waitron/commit/8c549477da7153af63d3fd153ff716c0f5bbdb8d) | Waitron changes its folded person-key rules and fixtures. Cloud already stores a unique normalised credential email (`packages/registration/migrations/002_identity.sql:1–5`). |
| [`285daba145b6` (#3618)](https://github.com/clintongormley/waitron/commit/285daba145b65e623375751efd0abc73eff22af9) | Waitron uses purpose-specific vault keys for authenticator secrets and email codes. Cloud binds factor encryption to account, version and purpose, hashes codes with their challenge, and encrypts queued email payloads (`packages/identity/src/authenticator-crypto.ts:11–27,43–71`, `packages/registration/src/sign-in-check.ts:22,42–47`, `packages/registration/src/email-outbox.ts:96–101`). |
| [`9abd56cf6949` (#3680)](https://github.com/clintongormley/waitron/commit/9abd56cf6949210f49650b13f38212f3e0102c79) | Waitron exports its recovery-code hash for emergency-copy sign-in. The mapped change leaves the hash itself as it was. Cloud already binds its recovery-code hashes to the account and factor version (`packages/registration/src/account-recovery-codes.ts:16–19`). |
| [`9f064e293677` (#3712)](https://github.com/clintongormley/waitron/commit/9f064e2936775f86e961945c53cc136b67e791e0) | The mapped change removes references to retired design documents from comments. |
| [`b30eade710d2` (#3807)](https://github.com/clintongormley/waitron/commit/b30eade710d214635ea65003341f317833223c58) | Waitron's by-ID box join prompts for an authenticator only when the main box requires one. Cloud checks password authority before issuing its email sign-in factor challenge (`packages/registration/src/password-login.ts:81–108`). |

Recheck the inventory from the main Cloud checkout with a sibling Waitron checkout.

```sh
node scripts/identity-upstream.mjs ../waitron 60dcf75a5132af8878d8a88aee36d78deb125c54
node --test scripts/identity-upstream.test.mjs
```

The inventory should report an empty `commits` array. These commands check the inventory. The table records the source comparison.
