# Source and maintenance

The owner authorised reuse from Waitron tag `pre-sqlite-migration`, pinned to
commit `c9d80c59a30ab1ae7a4acc0a6999e6a342de924e`.

| Cloud code/tests | Waitron source at that commit | Adaptation |
| --- | --- | --- |
| `src/secret-hash.ts`, `test/secret-hash.test.ts` | [secret-hash.ts](https://github.com/clintongormley/waitron/blob/c9d80c59a30ab1ae7a4acc0a6999e6a342de924e/packages/identity/src/secret-hash.ts), [tests](https://github.com/clintongormley/waitron/blob/c9d80c59a30ab1ae7a4acc0a6999e6a342de924e/packages/identity/src/secret-hash.test.ts) | Same salted scrypt format and Node default parameters. Asynchronous derivation, strict full-length hexadecimal parsing and Node's test runner. Original positive/negative assertions retained. |
| `src/sessions.ts` login and registration's `test/identity.test.ts` | [manager-login.ts](https://github.com/clintongormley/waitron/blob/c9d80c59a30ab1ae7a4acc0a6999e6a342de924e/packages/identity/src/manager-login.ts), [tests](https://github.com/clintongormley/waitron/blob/c9d80c59a30ab1ae7a4acc0a6999e6a342de924e/packages/identity/src/manager-login.test.ts) | Adapted email/password flow, generic failures and one derivation for unknown, disabled or passwordless accounts. No by-ID login. MFA and recovery-code paths have not been copied; accounts are provisioned through trusted setup only. |
| `src/sessions.ts` lifecycle and registration's `test/identity.test.ts` | [management-session.ts](https://github.com/clintongormley/waitron/blob/c9d80c59a30ab1ae7a4acc0a6999e6a342de924e/packages/identity/src/management-session.ts), [tests](https://github.com/clintongormley/waitron/blob/c9d80c59a30ab1ae7a4acc0a6999e6a342de924e/packages/identity/src/management-session.test.ts) | Preserve 30-minute idle expiry, passive reads, logout and current suspension checks. Use PostgreSQL wall time and row locks, hashed opaque tokens and a 12-hour absolute lifetime. Local roles and locale are not copied into Cloud sessions. |

When changing authentication in either repository, compare the corresponding source
and behavioural tests above, record applicable fixes in both backlogs, and port the
fix with a failing regression test. The Cloud repository owns adaptations here;
Waitron owns its local authentication. No automatic synchronisation or shared identity
package has been established. Account credentials are separate in the two products.
