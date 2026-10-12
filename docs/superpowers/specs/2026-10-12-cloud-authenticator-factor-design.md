# Optional Cloud authenticator-app second factor

**Status: awaiting owner recovery and session decisions.** Design only; this PR does not implement the feature.

## Intent and boundary

If your password is stolen, an optional authenticator code adds a second check to password sign-in. You opt in per Cloud account. There is no mandatory MFA policy, organisation requirement, staff-role change or Waitron implementation.

Passkeys remain independent and phishing-resistant through their origin-bound verification. Authenticator codes do not gate passkey sign-in and do not offer that phishing resistance. Email password recovery remains available.

## Recovery decision remains OPEN

**Recommendation:** preserve the enrolled factor and its recovery codes after email recovery. Reset changes your password, ends sessions and invalidates pending password-login/enrolment challenges. Your next password login still needs an authenticator or unused recovery code. Your passkeys remain available. Email access alone must not remove this protection.

If you lose both your authenticator and codes and have no passkey, this recommendation provides **no automatic account recovery**. The owner must explicitly approve that consequence. A passkey still grants account access, but cannot alone authorise factor removal or replacement. No support bypass is designed here.

**Alternative:** email reset also removes the factor, invalidates its codes and advances its version atomically. This restores password access after losing the authenticator, but control of email then allows removal of the second factor. Neither alternative is approved by this document.

## Session decision remains OPEN

**Recommendation:** successful enrolment, replacement, removal and recovery-code regeneration end all existing Cloud sessions in the same transaction. You sign in again with the resulting configuration. This closes sessions that may have been created with a stolen password, at the cost of signing you out on every device.

**Alternative:** keep existing sessions and apply the new configuration only to subsequent password sign-ins. This avoids interruption but leaves earlier sessions usable. Either policy must invalidate pending login/enrolment challenges and prevent concurrent stale-authority changes. The owner must choose before implementation; test the chosen behaviour and its lost-reply reconciliation.

## Sign-in and account controls

Without an enrolled factor, password sign-in retains its current full-success path. With one, a correct password returns a bounded, opaque pre-session challenge, never an account session. Store only its token hash, account binding, password fingerprint, factor version, expiry and attempt/consumption state. Keep the raw token in tab memory, never a URL or browser persistent storage.

Completion accepts either an authenticator code or recovery code. Recheck account eligibility, password fingerprint, factor version and challenge lifetime before consuming proof and creating the session in one transaction. Issue no cookies before full success. Challenge tokens must fail every account/session endpoint. Invalid credentials remain generic; reveal the second step only after password proof. Expiry or exhausted attempts requires restarting password login.

Enrolment, replacement, removal and code regeneration require a live session, its CSRF proof and the current password. CSRF proof prevents another site from issuing account changes through your browser. If a factor is active, also require its current code or an unused recovery code; a recovered password plus passkey/session cannot silently disable it.

Enrolment creates an encrypted pending secret tied to the exact account/session, password fingerprint and factor version. Show a locally rendered QR code and manual secret. Activation requires a code from that new secret and renewed authority checks, including existing-factor/recovery proof for replacement. Starting replacement leaves the old factor active until atomic completion. Pending state has a bounded lifetime and attempt budget; cancellation, expiry, reset or supersession makes it unusable.

Generate recovery codes only on successful activation/regeneration and show them once. Store account/version-bound hashes, never raw codes. Codes remain usable until consumed, replaced or factor removal; they cannot reset a password or authenticate alone. Pending enrolment creates no usable codes. If the successful reply is lost, reconcile factor status and regenerate with fresh authority rather than retrieve raw codes.

## Security and concurrency requirements

These are requirements, not proven runtime claims:

- Reject reuse of an accepted authenticator code anywhere within its accepted time window, across login and management operations. Verification must expose matched time steps, with atomic replay-state updates; a boolean helper alone is insufficient. Activation consumes its confirmation code too.
- Only one concurrent use of a recovery code succeeds. Proof consumption, challenge consumption and the authorised change/session creation commit together. Failed attempts must durably spend their budget despite error handling or rollback.
- Establish a consistent lock order compatible with account lifecycle, credential/session locks and session revocation. Serialize factor changes, code replacement and proof consumption per account, including when no factor row exists. Recheck database wall time after waits and authority after expensive work. Reset, disablement, logout, expiry and factor changes must not leave stale authority able to commit.
- Preserve exact host/Origin, CSRF, strict body shapes, body/deadline bounds, shared request limits and secure-cookie rules. Bound creation and completion by IP, account and challenge without exposing unknown accounts. Production rate-limit values and retention/cleanup periods remain undecided.

Supply a separate factor encryption key configuration, independent of HTTP rate, pairing and backup-recovery keys. Encrypt pending and active secrets with authenticated encryption bound to account, factor version and purpose, so swapping ciphertext between accounts fails. Include an envelope version and key ID. Write with the current key; retain explicitly configured older keys during verified re-encryption and restore preparation. Missing/malformed keys or unreadable secrets fail closed for factor operations without downgrading password login. Passkey sign-in remains available. Never log passwords, secrets, QR contents, challenge tokens, authenticator codes or raw recovery codes; sensitive responses require no-store caching.

**Minor builder proposals:** maintained TOTP (time-based one-time password) library; six digits, 30-second steps and adjacent-step tolerance; issuer `Waitron Cloud`; AES-256-GCM; ten independently random 128-bit recovery codes; five-minute login and pending-enrolment lifetimes. These are proposals, not owner decisions. Pin dependency versions and choose the migration filename during implementation, not now.

## Source receipts and acceptance

Readings only, not runtime verification. Cloud pin: `6d8c7e77958a485dc3b393f26c8836408a6cf3d8`.

- [Ownership](../../documentation-ownership.md#L3), [identity backlog](../../backlog.md#L331), [identity implementation](../../cloud-identity-implementation.md#L9), [passkeys spec](2026-09-26-cloud-passkeys-design.md#L29) and [source map](../../../packages/identity/SOURCE.md#L3) establish Cloud ownership and existing scope.
- [Password login](../../../packages/identity/src/sessions.ts#L32) creates a session after password recheck; [session resolution](../../../packages/identity/src/sessions.ts#L80) checks CSRF/expiry; [email reset](../../../packages/registration/src/password-recovery.ts#L65) changes password and ends sessions.
- [Passkey authentication](../../../packages/registration/src/passkeys.ts#L144) separately creates sessions; [passkey management](../../../packages/registration/src/passkeys.ts#L189) requires password/session proof. [HTTP login](../../../packages/account-http/src/app.ts#L146) writes cookies immediately; [passkey route](../../../packages/account-http/src/passkeys.ts#L38) writes them after verification. [Portal login](../../../apps/portal/src/app.ts#L211) currently assumes full success.

Waitron pin: `3d6b31ac6b2ff9fb9a62e4081e1afe50000963c4`, read through `git show`: `packages/identity/src/{totp.ts,mfa.ts,totp.test.ts,mfa-encryption.test.ts,manager-login.test.ts}`. Preserve applicable assertions for malformed inputs, encryption/key-version failure and generic refusals. Adapt to Cloud PostgreSQL/accounts; add ciphertext binding and replay requirements. Record copied/adapted provenance in implementation's source map.

Acceptance requires failing-first PostgreSQL/HTTP tests for replay/skew boundaries, concurrent consumption, cross-account ciphertext/challenges/codes, rotation, expired pending state, lost replies, races, generic failures, limits and cookie absence before success. Test the approved email-reset policy and independent passkeys. Chromium must cover English/Spanish × phone/desktop × light/dark: enrol, confirm, save/regenerate codes, password second step, recovery-code reuse rejection, removal, reset, passkey access, cancellation, accessibility and stale/lost responses.

## Implementation stages, to be planned only after approval

After the recovery/session decisions and design approval, plan identity/storage and key handling, registration/reset integration, HTTP/portal journeys, then concurrency/browser acceptance and operational documentation. No separate implementation plan is created here.
