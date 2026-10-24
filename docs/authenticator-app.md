# Protect password sign-in with an authenticator app

A stolen password can otherwise open your Cloud account. You can add an optional
authenticator app from **Account**, then use its six-digit code or a saved recovery
code when signing in with your password. Passkey sign-in remains available separately.

You can paste codes with spaces, such as `123 456`. The portal removes whitespace
from authenticator and recovery codes, keeping recovery-code hyphens. Blank codes
show “Enter your code.” without sending a request, so they do not spend a server
attempt. Missing passwords show “Enter your password.” Your other entries stay in
the form so you can correct the missing value and try again.

Scan the QR code or enter the setup secret in your authenticator, then confirm with
its current code. The portal renders the QR locally. Save the ten recovery codes
when they appear: each works once, and Cloud stores only their hashes. Setup secrets
and recovery codes stay in the current tab; leaving or reloading clears them.

Enrolment, replacement, removal and code regeneration end every Cloud session.
Sign in again afterwards. Each change requires your current password and live
session; an existing factor also requires a fresh authenticator or recovery code.
Starting replacement leaves the old factor active until you confirm the new one.

Resetting your password by email keeps your authenticator, unused recovery codes
and passkeys. Email access alone cannot remove the factor. If you lose the app,
saved codes and passkey, there is no automatic recovery or support bypass. A passkey
can still open your account, but cannot alone remove or replace the factor.

If a successful reply is lost, the portal checks your session and asks you to sign
in or reload account status. It does not automatically resend a consumed code or
retrieve previously issued recovery codes. Regenerate codes with fresh authority
if you need another set.

## Configure a local account worker

New factor operations require three explicit settings. Supply a separate encryption
key from your secret store; never reuse email, backup, pairing, recovery or request-limit
keys. Keep the same key ring and policy on every account worker.

```dotenv
CLOUD_FACTOR_ACTIVE_KEY_ID=factor-v1
CLOUD_FACTOR_KEYS={"factor-v1":"<separately generated 64 hexadecimal characters>"}
CLOUD_FACTOR_POLICY={"loginLifetimeMs":300000,"pendingLifetimeMs":300000,"challengeAttempts":10,"enrolmentAttempts":10,"loginAccount":{"limit":30,"windowSeconds":900},"completeIp":{"limit":30,"windowSeconds":60},"completeAccount":{"limit":30,"windowSeconds":900},"completeChallenge":{"limit":10,"windowSeconds":300},"manageIp":{"limit":30,"windowSeconds":60},"manageAccount":{"limit":30,"windowSeconds":900}}
```

Generate a fresh key with `openssl rand -hex 32` and store it in private external
configuration. The policy above is a **local test example**, not a production allowance.
Choose production budgets explicitly before enablement. Login and enrolment lifetimes
cannot exceed five minutes. Attempt counts must be positive integers; request limits
must be 1–1,000,000 and their windows 1–86,400 seconds. Every named field is required.

Fresh packaged local stacks persist independent factor keys in their private runtime
configuration. Set `CLOUD_FACTOR_POLICY` before starting the account service to enable
the local example. Older runtime configuration stays intact without invented replacement
keys. Add an explicit `factor` object with `activeKeyId` and `keys` to that private
runtime configuration before enablement; preserve any keys needed by existing data.

Missing policy or unreadable secrets refuse factor operations. Password sign-in without
an enrolled factor, passkeys and existing live sessions remain independent. An enrolled
factor is never silently treated as absent. Cancellation of pending setup remains
available with its exact live session and CSRF proof during a configuration outage.

## Call the API

Use the [account API's existing Origin, cookie and body protections](../packages/account-http/README.md).
All paths below start with `/api/account`. A proof is either
`{"kind":"totp","code":"123456"}` or `{"kind":"recovery","code":"<32 hexadecimal characters>"}`.
Recovery codes may also use four groups of eight characters separated by hyphens.

| Request | Body and authority | Successful reply |
| --- | --- | --- |
| POST `/login` | Email and password | 200 with account ID and cookies, or 202 with `factorRequired:true`, `challengeToken`, `expiresAt` and no cookies |
| POST `/login/factor` | `challengeToken`, `proof`, exact Origin | 200 with account ID and cookies |
| GET `/authenticator` | Live session | `active`, `version`, `recoveryCodesRemaining`, `available` |
| POST `/authenticator/begin` | Password, optional existing-factor proof, live session and CSRF | Pending token, setup secret, URI and expiry |
| POST `/authenticator/activate` | Password, pending token, new six-digit `code`, optional existing-factor proof, live session and CSRF | Changed active status and ten recovery codes; clears cookies |
| POST `/authenticator/regenerate` | Password, existing-factor proof, live session and CSRF | Changed active status and ten new codes; clears cookies |
| POST `/authenticator/remove` | Password, existing-factor proof, live session and CSRF | Changed inactive status; clears cookies |
| POST `/authenticator/cancel` | Pending token, exact live session and CSRF | 204 |

Challenges are not session credentials and expire after the supplied lifetime. Invalid
login proof returns 401 `credentials_invalid`; invalid management authority returns
403 with the same code. Invalid pending state returns 400 `invalid_input`, and unavailable
factor configuration returns 503 `temporarily_unavailable`. Responses disable caching.

## Rotate and recover encryption keys

Add the new key to the external ring, retain the old entries, and switch every account
writer to the new active key. Then run from a fully migrated checkout:

```sh
node --env-file=.env packages/registration/src/authenticator-keys-cli.ts --reencrypt
```

The command rechecks each account under its account lock and rewrites active and
retained pending ciphertext with the current key. It preserves factor versions,
sessions, challenges, recovery hashes and replay state. Its output contains only
the active key ID and rewritten counts, for example
`{"activeKeyId":"factor-v2","active":2,"pending":2}`.

Each account commits separately. If the command stops, retry with the same complete
ring: completed accounts are verified and left untouched, while the interrupted
account rolls back. The command does not choose key-retention periods or delete history.
Repeat after all writers use the new key; a writer still configured with the old active
key can create old-key ciphertext after an earlier account was processed.

Retain old keys until live and retained pending rows **and every retained database backup**
are accounted for. Re-encrypting the current database cannot rewrite an older backup.
Restore the database and its matching external keys together, then prove password-factor
sign-in before treating it as recovered. The [populated upgrade and restore rehearsal](database-recovery.md#rehearse-the-authenticator-upgrade)
tests matching, missing and wrong keys, account binding and one-use recovery proof.

Production custody, allowances, history retention, email delivery and provider recovery
remain deployment work. The local tests do not establish a public availability promise.
