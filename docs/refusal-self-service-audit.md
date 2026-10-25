# Find a way forward after a refusal

If waiting cannot change the reason for a refusal, you need a different action.
Reloading cannot grant a permission, renew an expired setup or make an already-used
replacement server fresh. This audit records those gaps before changing product
messages. Each fix needs its own small, test-first change.

The audit uses Cloud main `364630d72fee6bd5538db3396a19a2ea42d311ee` on
25 October 2026. It covers the portal's English and Spanish messages, public
gateway pages, account emails and the server refusals mapped to those messages.
It changes no product behavior, authority, fiscal record or recovery rule.

## What the checks establish

The case-insensitive search for contact-support wording found no such customer
message in `apps/portal/src/locale.ts`, `packages/remote-access/src` or
`packages/registration/src/account-mail.ts`. References to browser support,
operator tooling and an outside fiscal custodian are different subjects.

A local probe ran the real portal controllers with 50 synthetic API refusals and
rendered 34 English/Spanish account emails and HTTP error pages. It confirmed the
message mappings below. Those inputs prove how the client presents a response;
they do not prove that every synthetic status/code pair is emitted by a server.
The source references identify reachable server causes separately. Database
outcomes remain unverified locally because Docker is unavailable.

You can repeat the message probes by constructing the controllers with their
existing request argument and returning `{ok:false,status:400,code:'invalid_input',
retryAfterMs:0}`. Call authenticator `begin()` with an account and password:
its error becomes `factorUnavailable`. The same response during passkey `load()`
becomes `passkeyUnavailable`. These are presentation checks, not a claim that a
passkey-list request normally emits that response.

No refusal is classified as possible only through a product bug. The common error
codes include ordinary invalid input, expired state, missing permissions and
service configuration. A future support-only message needs a narrower code and a
demonstrated invariant at its source.

## Fixes to make one screen at a time

Each row gives the current English/Spanish wording, the cause and the action to
implement or clarify. R4 and R8's account-switch guidance are implemented; the
other nine rows remain open. No row authorizes a permission bypass.

| ID and screen | Response and current wording, English / Spanish | Cause and evidence | Way forward and next change |
| --- | --- | --- | --- |
| R1: authenticator setup and management | `400 invalid_input` → “Authenticator settings are temporarily unavailable.” / “La configuración del autenticador no está disponible temporalmente.” | Not bug-only. [HTTP parsing (authenticator-factor.ts:17)](../packages/account-http/src/authenticator-factor.ts#L17) rejects oversized passwords, malformed tokens and proof shapes. [Management (authenticator-factor.ts:103)](../packages/registration/src/authenticator-factor.ts#L103) uses the same code for missing, expired, consumed, superseded or attempt-exhausted setup and for removing/regenerating an absent factor. The native controller probe confirms the outage message. | Split actionable setup-state outcomes from malformed input. Let you refresh factor status and start a fresh setup when appropriate. Keep wrong proof and credential feedback private, and preserve proof requirements. This is the named server-code follow-up left by D237; do not turn every server 400 into a code-field error. |
| R2: passkey registration and removal | Registration failures → “Passkeys are temporarily unavailable. Try again.” / “Las llaves de acceso no están disponibles temporalmente. Vuelve a intentarlo.” | Not bug-only. [HTTP mapping (passkeys.ts:68)](../packages/account-http/src/passkeys.ts#L68) maps management `PasskeyError` to `400 invalid_input`; [the store (passkeys.ts:205)](../packages/registration/src/passkeys.ts#L205) includes expired/consumed or differently bound ceremonies, duplicate credentials and failed verification. Malformed request fields also use 400. | Distinguish restarting an expired ceremony, choosing an existing key and an actual outage without revealing another account's keys. Keep the refreshed list and password sign-in available. Test each cause before choosing its message. |
| R3: recovery approval and replacement | `400` or `409` → “This service is temporarily unavailable. Try again.” / “El servicio no está disponible temporalmente. Vuelve a intentarlo.” | Not bug-only. [HTTP recovery (recovery.ts:83)](../packages/account-http/src/recovery.ts#L83) exposes `confirmation_required`, `unverified`, `target_not_fresh`, `recovery_active` and `conflict`. [Recovery (recovery.ts:202)](../packages/backups/src/recovery.ts#L202), [requests (recovery-request.ts:38)](../packages/backups/src/recovery-request.ts#L38) and [replacement (replacement.ts:29)](../packages/backups/src/replacement.ts#L29) distinguish missing confirmation, verification/target mismatch, another recovery and reused machine keys. [The API reader (api.ts:68)](../apps/portal/src/api.ts#L68) drops several specific codes; [the controller (recovery-controller.ts:40)](../apps/portal/src/recovery-controller.ts#L40) then shows generic failure or reconciles a write. | Preserve read-after-uncertain-write behavior. Separate “check the existing request”, “close the other recovery”, “choose a verified compatible source” and “start from a fresh replacement”. Confirm which action each request state actually permits before adding a button. Never tell you to repeat an approval whose result is uncertain. |
| R4: recovery outside the local test scope | `403 local_integration_only` now explains that recovery supports test venues only, tells you to open a new recovery link from the replacement server’s setup and choose a test venue on the Cloud page, and says production recovery is unavailable. Both English and Spanish name this restriction in the recovery page’s error message. | [Catalogue](../packages/backups/src/catalogue.ts#L82), [managed streams](../packages/backups/src/managed-streams.ts#L199) and [replacement](../packages/backups/src/replacement.ts#L29) retain their server restrictions. The API client recognises this code only for a recovery HTTP 403; other paths and statuses retain their prior handling. | Implemented with new native API/controller and browser checks. Permission refusals still clear the displayed authority and confirmations; unexpected write results still reconcile without replay. Production recovery remains unfinished. Existing PostgreSQL scope tests run in CI. |
| R5: Account permission refusals | `403 forbidden` / `permission_denied` → “Your request could not be verified. Reload this page and try again.” / “No hemos podido verificar la solicitud. Recarga esta página y vuelve a intentarlo.” | Not bug-only. [Common mapping (app.ts:53)](../packages/account-http/src/app.ts#L53) merges cross-site request protection and denied permission. Installation, backups, diagnostics, usage, alert and translation handlers also check current account/venue authority. Native controllers confirm the common message. | Keep reload for a stale request token, but give denied authority a distinct safe response: check the signed-in account and selected business, sign out/in if needed, and return to an accessible view. Adding or changing business membership needs a real product path; do not invent one or imply reload grants access. Split by screen, retaining tenant checks. |
| R6: fiscal authority, entitlement and exhausted identities | `custody_unavailable`, `entitlement_unavailable`, `space_exhausted`, `reservation_untrusted`, `binding_conflict` → respectively “Check with your custodian”, retained-receipt access, “Contact your custodian”, signed-evidence verification failure or recorded-history conflict. Spanish: “Consulta al custodio”, retained-justification access, “Consulta al custodio”, signature failure or history conflict. | Not bug-only. [Policy (policy.ts:121)](../packages/fiscal-allocation/src/policy.ts#L121) and [store (store.ts:131)](../packages/fiscal-allocation/src/store.ts#L131) include absent adapters, denied entitlement, unverified or changed operator binding, missing/inactive signing trust, conflicting evidence and exhausted high-water identity space. The same family can cover configuration and genuine outside-authority decisions. | Clarify what evidence you can inspect/export and how to reach the actual outside custodian through an established route. This audit found no portal flow that provisions custody, changes entitlement or extends identity space. Record that missing capability separately; fiscal policy and golden evidence stay owner-gated. “Custodian” must not be silently replaced with unpaid Cloud support. |
| R7: fiscal continuity and uncertain history | `continuity_unavailable` → “The current outside register is unavailable. Try again shortly.” / “El registro externo actual no está disponible. Vuelve a intentarlo pronto.” `history_uncertain` and `allocation_unavailable` → the general temporary-service message in both languages. | Not bug-only. [Policy](../packages/fiscal-allocation/src/policy.ts#L121) also raises continuity failure for a missing adapter or invalid policy; [continuity (continuity.ts:45)](../packages/fiscal-allocation/src/continuity.ts#L45) covers unavailable evidence, uncertain history, contention and exhausted allocation attempts. [The controller (fiscal-allocation-controller.ts:24)](../apps/portal/src/fiscal-allocation-controller.ts#L24) does not give the latter two codes distinct guidance. | Separate temporary access/contended reads from configuration and evidence failures. Retain uncertain-request status checks and the original request identifier. Explain the next inspection/import step only when the signed-evidence rules permit it. No automatic new reservation or relaxation of the outside-register rule. |
| R8: Connect a venue with no eligible business | Delivered: the existing no-business message now tells you to sign out and sign in with the account that owns the business, in English and Spanish. | [The pairing store (pairing.ts:64)](../packages/registration/src/pairing.ts#L64) still lists only businesses permitted for your account. [The screen (pairing-screen.ts:11)](../apps/portal/src/pairing-screen.ts#L11) keeps its existing sign-out control. | New stubbed-browser checks exercise that control, sign in as a different account and return to the same pending connection for code inspection. A failed sign-out stays recoverable. Same-account membership/business creation remains a separate missing capability; owner/local-manager pairing confirmation is unchanged. |
| R9: public availability failure | `503 venue_unavailable` → “The venue is unavailable right now. Please try again in a moment.” / “El local no está disponible ahora. Vuelve a intentarlo en unos momentos.” | Not bug-only. [The gate (public-gate.ts:35)](../packages/remote-access/src/public-gate.ts#L35) uses this page for forwarding errors and every non-200 upstream result, without preserving a customer-safe cause. [The page (public-unavailable.ts:22)](../packages/remote-access/src/public-unavailable.ts#L22) supplies a retry link and 30-second retry header. The native renderer confirms both languages. | Retry is real, but its wording promises too much for persistent upstream refusal. Give visitors a neutral availability message and a usable return/retry action. Give venue owners cause-specific checks in Account without exposing internal routes or authentication state to visitors. |
| R10: public gate rejections and browser checking | Bare `421`, `429`, `413`, `404`, `405`, `400` and failed-proof `403`; browser-check page says “Please wait a moment.” / “Espera un momento.” | Not bug-only. [The gate](../packages/remote-access/src/public-gate.ts#L35) rejects unmatched hosts, rate/capacity limits, unexpected paths/methods, oversize or malformed requests and invalid proof. Its script displays bilingual reload guidance on fetch/worker/proof errors, but the initial rejection bodies are empty. The worker's finite search has no exhaustion message. | Audit direct navigation separately from background challenge requests. Supply safe recovery guidance where a browser receives an empty page; retain status codes, limits, proof and host checks. Add a bounded failure outcome for an unsupported/stalled browser-check path after reproducing it. Do not claim reload can repair every browser limitation. |
| R11: stale monitoring and certificate alerts | “Monitoring is unknown because no recent external check is available” and “Check renewal and installation”; Spanish equivalents describe unknown monitoring and certificate renewal. | Not bug-only. [Account email rendering (account-mail.ts:20)](../packages/registration/src/account-mail.ts#L20) links every service alert to Account; missing recent probes and certificate expiry are different from a confirmed failed route. [Account's monitoring copy (locale.ts:183)](../apps/portal/src/locale.ts#L183) has the same distinction. | The Account link exists. Document or build the concrete self-service checks behind “gateway”, “TLS setup” and certificate installation before claiming those instructions resolve the problem. Operator-only local certificate tooling remains an explicit unfinished capability, not paid support. |

The fiscal labels in R6 retain their separate meanings. The exact current pairs
are `fiscalCustody`: “Taxpayer or operator authority is unavailable. Check with
your custodian.” / “La autoridad del contribuyente u operador no está disponible.
Consulta al custodio.”; `fiscalEntitlement`: “New reservations are unavailable.
You can still inspect retained receipts.” / “No hay nuevas reservas disponibles.
Puedes consultar los justificantes conservados.”; `fiscalExhausted`: “No unused
identities remain. Contact your custodian.” / “No quedan identidades libres.
Consulta al custodio.”; `fiscalTrust`: “Signed evidence could not be verified.
Contact your custodian.” / “No se pudo verificar la prueba firmada. Consulta al
custodio.”; `fiscalConflict`: “This evidence conflicts with recorded history.
Check with your custodian.” / “Esta prueba contradice el historial registrado.
Consulta al custodio.” None identifies a Cloud support contact or provisions the
outside authority.

## Existing actions to preserve

These messages already point at an action or a real wait. They still need their
existing behavioral coverage when an adjacent screen changes.

| Surface and response | English / Spanish guidance and actual action | Evidence and limits |
| --- | --- | --- |
| Sign-up/reset `link_unavailable` | Sign in or request a new link / Inicia sesión o solicita un nuevo enlace. | [Form screens (screens.ts:35)](../apps/portal/src/screens.ts#L35) provide both navigation routes. [HTTP mapping](../packages/account-http/src/app.ts#L53) includes expired/unavailable verification/reset requests. These are not bug-only. |
| Password/credential refusal | Choose another password, or correct email/password / Elige otra contraseña o corrige tus datos. | Local field checks and `password_compromised` remain distinct from unavailable password screening. Authenticator proof failure is not permission to remove the factor. |
| Session ended, `401` | Sign in again / Inicia sesión de nuevo. | Pairing/recovery/session reconciliation and sign-in navigation exist. Account security changes can deliberately end every session; do not weaken that rule. |
| `429 rate_limited` and resend wait | Wait before trying again / Espera antes de volver a intentarlo. | [API parsing](../apps/portal/src/api.ts#L68) retains Retry-After. Controllers disable attempts until that time. Email resend waits are per normalized address and operation; server limits still cover every address. A real rate wait is not a missing self-service route. |
| Remote `dns_not_verified`, `hostname_conflict`, revision conflict | Check both DNS records, choose another name, or refresh/review / Comprueba ambos registros, elige otro nombre o actualiza/revisa. | [Remote screen (remote-screen.ts:16)](../apps/portal/src/remote-screen.ts#L16) exposes the records, assigned-name switch and refresh. [Remote handler (remote-access.ts:58)](../packages/account-http/src/remote-access.ts#L58) distinguishes those outcomes. Gateway assignment and certificate installation remain operator tooling, as its trial notice says. |
| Recovery `410`, missing code/link and unconfirmed result | Start a fresh request on the replacement, reopen its link, or inspect status / Inicia otra solicitud en el servidor de sustitución, abre su enlace o comprueba el estado. | [Recovery screen (recovery-screen.ts:11)](../apps/portal/src/recovery-screen.ts#L11) and [controller](../apps/portal/src/recovery-controller.ts#L40). An expired request cannot be revived by waiting. Existing guidance already says so. |
| Unknown write result | Inspect/reconcile before retrying / Comprueba el resultado antes de reintentar. | Fiscal, recovery, remote, passkey, authenticator, translation and alert controllers retain explicit uncertain-result handling. Keep their action-specific distinctions; do not replace them with a generic “try again”. |
| Read failure: sessions, snapshots, usage, diagnostics, venue list | Refresh/retry; diagnostics also says “Retry or refresh the status” / Reintenta o actualiza el estado. | These controls exist. Temporary transport or backend failure can clear. Permission/configuration outcomes need R5/R7 instead; a generic 503 does not establish a transient cause. |
| Portal HTML `400`, `404`, `405`, `503` | Check the address or return to Waitron Cloud / Comprueba el enlace o vuelve a Waitron Cloud. | [Error renderer (portal.ts:48)](../packages/account-http/src/portal.ts#L48) always links to `/`; 503 adds Retry-After. All eight language/status responses were rendered natively. |
| Verification/reset/password-changed emails | Open the single-use link, ignore an unrequested email, or request a fresh reset / Abre el enlace de un solo uso, ignora el correo no solicitado o solicita otro restablecimiento. | [Mail renderer](../packages/registration/src/account-mail.ts#L20) includes expiry and the password-change reset-request link. Rendering was exercised in both languages; delivery and provider behavior were not exercised. |

## Delivery boundaries

Cloud owns these follow-ups. R1, R2, R3, R4, R5 and any fiscal change need the full
authentication/recovery/authority review path. R6/R7 must first respect the owner's
fiscal approval rule. A wording-only public-page change may use focused review;
changing bot checks or permissions may not.

Start with R1's server-code inventory and tests for each setup state, then make
the smallest corresponding screen change. Reserve each file against both Cloud
lanes before starting. This document records missing actions; it neither approves
a new membership flow nor enables production services.
