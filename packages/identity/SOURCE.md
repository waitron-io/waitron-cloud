# Source and maintenance

The owner authorised reuse from Waitron tag `pre-sqlite-migration`, pinned to
commit `c9d80c59a30ab1ae7a4acc0a6999e6a342de924e`.

| Cloud code/tests | Waitron source at that commit | Adaptation |
| --- | --- | --- |
| `src/secret-hash.ts`, `test/secret-hash.test.ts` | [secret-hash.ts](https://github.com/clintongormley/waitron/blob/c9d80c59a30ab1ae7a4acc0a6999e6a342de924e/packages/identity/src/secret-hash.ts), [tests](https://github.com/clintongormley/waitron/blob/c9d80c59a30ab1ae7a4acc0a6999e6a342de924e/packages/identity/src/secret-hash.test.ts) | Same salted scrypt format and Node default parameters. Asynchronous derivation, strict full-length hexadecimal parsing and Node's test runner. Original positive/negative assertions retained. |
| `src/sessions.ts` login and registration's `test/identity.test.ts` | [manager-login.ts](https://github.com/clintongormley/waitron/blob/c9d80c59a30ab1ae7a4acc0a6999e6a342de924e/packages/identity/src/manager-login.ts), [tests](https://github.com/clintongormley/waitron/blob/c9d80c59a30ab1ae7a4acc0a6999e6a342de924e/packages/identity/src/manager-login.test.ts) | Adapted email/password flow, generic failures and one derivation for unknown, disabled or passwordless accounts. No by-ID login. Cloud owns signup and email password recovery; authenticator storage and login integration are separate Cloud adaptations. |
| `src/sessions.ts` lifecycle and registration's `test/identity.test.ts` | [management-session.ts](https://github.com/clintongormley/waitron/blob/c9d80c59a30ab1ae7a4acc0a6999e6a342de924e/packages/identity/src/management-session.ts), [tests](https://github.com/clintongormley/waitron/blob/c9d80c59a30ab1ae7a4acc0a6999e6a342de924e/packages/identity/src/management-session.test.ts) | Preserve 30-minute idle expiry, passive reads, logout and current suspension checks. Use PostgreSQL wall time and row locks, hashed opaque tokens and a 12-hour absolute lifetime. Local roles and locale are not copied into Cloud sessions. |
| Registration's `src/passkeys.ts`, `test/passkeys.test.ts` | [passkey.ts](https://github.com/clintongormley/waitron/blob/c9d80c59a30ab1ae7a4acc0a6999e6a342de924e/packages/identity/src/passkey.ts), [tests](https://github.com/clintongormley/waitron/blob/c9d80c59a30ab1ae7a4acc0a6999e6a342de924e/packages/identity/src/passkey.test.ts) | Independently adapted PostgreSQL ceremonies, opaque handles, session/CSRF/password-bound enrolment and generic failures. Failed ceremonies are consumed. |
| `src/secret-hash.ts` and `src/sessions.ts` password checks | [verify-password.ts](https://github.com/clintongormley/waitron/blob/c9d80c59a30ab1ae7a4acc0a6999e6a342de924e/packages/identity/src/verify-password.ts), [tests](https://github.com/clintongormley/waitron/blob/c9d80c59a30ab1ae7a4acc0a6999e6a342de924e/packages/identity/src/verify-password.test.ts) | Cloud calls its asynchronous secret verifier directly; password bounds belong to signup and account boundaries. |

The authenticator cryptography in `src/authenticator-crypto.ts` and
`test/authenticator-crypto.test.ts` adapts
[totp.ts](https://github.com/clintongormley/waitron/blob/3d6b31ac6b2ff9fb9a62e4081e1afe50000963c4/packages/identity/src/totp.ts),
[its tests](https://github.com/clintongormley/waitron/blob/3d6b31ac6b2ff9fb9a62e4081e1afe50000963c4/packages/identity/src/totp.test.ts),
[mfa.ts](https://github.com/clintongormley/waitron/blob/3d6b31ac6b2ff9fb9a62e4081e1afe50000963c4/packages/identity/src/mfa.ts) and
[encryption tests](https://github.com/clintongormley/waitron/blob/3d6b31ac6b2ff9fb9a62e4081e1afe50000963c4/packages/identity/src/mfa-encryption.test.ts).
Malformed-input, key-version and tamper refusals are retained. Cloud pins otplib,
returns every matched adjacent time step for transactional replay checks, and binds
AES-256-GCM ciphertext to the account, factor version, purpose, pending identity and
key ID. Recovery storage and account flows are not implemented by this primitive.

Cloud's registration `src/password-recovery.ts` and its tests have no Waitron
identity-package counterpart. Maintain and test that Cloud-owned flow here.

Last reviewed Waitron revision: `b9440c685e440d37d5bc65a7feade840ceacf1c9`.

When changing authentication in either repository, compare the corresponding source
and behavioural tests above, record applicable fixes in both backlogs, and port the
fix with a failing regression test. The Cloud repository owns adaptations here;
Waitron owns its local authentication. No automatic synchronisation or shared identity
package has been established. Account credentials are separate in the two products.

To check for later source or behavioural-test changes, run:

```sh
node scripts/identity-upstream.mjs ../waitron
```

The command reads the mapped Waitron paths above and reports commits after the
last reviewed revision through `origin/main`. It reads your existing local Git
references without fetching or changing Waitron. Pass an explicit revision as the
second argument when you need a fixed comparison. A target that does not descend
from the reviewed revision is refused rather than silently reported as current.
The report also checks each mapped path at its linked source revision and at the
target revision. If a file is renamed or deleted, update its mapped path and link
after reviewing that change; do not advance the reviewed revision blindly.
Keep the original copy revision; update the reviewed revision only after you have
classified every reported change. The [2026-10-12 review](../../docs/identity-upstream-review.md)
records applicable ports, already adapted properties and changes outside Cloud's
security scope. Passkey registration now offers and accepts EdDSA, ES256 and RS256
explicitly, so a runtime upgrade cannot add an algorithm without review.
