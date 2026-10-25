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
implement or clarify. R1, R4, R8 and R10 are implemented. R11's guidance and owner-check
documentation are implemented; its repair controls remain open. R2's shared-400, browser-duplicate and generic-failure guidance
are implemented; the remaining rows and cause-specific R2 request-body feedback stay open. No row authorizes a permission bypass.

| ID and screen | Response and current wording, English / Spanish | Cause and evidence | Way forward and next change |
| --- | --- | --- | --- |
| R1: authenticator setup and management | Delivered: management `400 invalid_input` asks you to check current settings and start again with your password and fresh codes, in English and Spanish. | The shared code covers malformed input, unavailable setup state and absent factors. The inventory below traces every producer. It cannot identify one precise cause. | Check authenticator settings discards the local setup and inputs, reads status and exposes the existing setup/replacement actions. It sends no change or cancellation. Password and current-factor proof remain required by the refreshed state. Credentials, rate limits and uncertain writes retain their handling; sign-in errors retain their separate feedback. |
| R2: passkey registration and removal | Delivered: management `400 invalid_input` offers Check passkeys and explains a fresh password/prompt or removal, in English and Spanish. | The shared server code includes malformed input, unusable registration state, duplicate credentials and failed verification. The inventory below traces each producer; the response cannot identify one cause. | The read-only check clears the old password and refreshes your account's list. Start another prompt with a fresh password, or choose another key if already registered. Removal guidance is separate. Password sign-in, credential errors, limits and uncertain-write reconciliation retain their handling. No other account's keys or existence is disclosed. |
| R3: recovery approval and replacement | English and Spanish refusals distinguish confirmation, source verification/compatibility, reused targets, another recovery, changed bindings, missing approval and invalid input. Check request status reads the existing request. | [Recovery HTTP](../packages/account-http/src/recovery.ts), [API reader](../apps/portal/src/api.ts) and [controller](../apps/portal/src/recovery-controller.ts) carry known 400/409 codes through without changing the server. [Native API/controller checks](../apps/portal/test/recovery-guidance.test.ts) preserve one write, its code and confirmations, and uncertain-write inspection. [Browser checks](../apps/portal/test/recovery-guidance-browser.test.ts) exercise nine refusals, status inspection and a refreshed source selection in both languages, themes and widths. Database authority and locking qualification runs in CI. | Check request status and replacement setup requirements; refresh the snapshot list to check verification, which does not guarantee compatibility. A reused target needs its existing request or fresh replacement setup. Another recovery can be closed only through its original link if no longer needed; no cross-request list/control is added. An approval binding change needs inspection before a new source/request; a replacement conflict first checks for completed replacement and its Cloud connection. An unapproved request may expire without granting recovery. Unknown responses and lost write replies still reconcile before another approval. Source compatibility display, finding a lost request link and fresh-target setup remain follow-ups, not new server capabilities. |
| R4: recovery outside the local test scope | `403 local_integration_only` now explains that recovery supports test venues only, tells you to open a new recovery link from the replacement server’s setup and choose a test venue on the Cloud page, and says production recovery is unavailable. Both English and Spanish name this restriction in the recovery page’s error message. | [Catalogue](../packages/backups/src/catalogue.ts#L82), [managed streams](../packages/backups/src/managed-streams.ts#L199) and [replacement](../packages/backups/src/replacement.ts#L29) retain their server restrictions. The API client recognises this code only for a recovery HTTP 403; other paths and statuses retain their prior handling. | Implemented with new native API/controller and browser checks. Permission refusals still clear the displayed authority and confirmations; unexpected write results still reconcile without replay. Production recovery remains unfinished. Existing PostgreSQL scope tests run in CI. |
| R5: Account permission refusals | Venue panels distinguish `403 permission_denied` from request-verification `403 forbidden`. English and Spanish guidance asks you to check your account, organisation and venue, with Account overview and Sign out beside the refusal. | [Common mapping](../packages/account-http/src/app.ts#L53), backup/diagnostic/remote owner lookups, the final diagnostic ownership recheck and translation consent retain their checks while identifying denied permission. Native HTTP checks cover response classification; original and new controller checks protect clearing private data. Two-venue browser checks exercise six panels, navigation without a reload, heading focus and sign-out retry. Real database authority and locking checks run in CI. | Installations, snapshots, diagnostics, usage, remote setup and translation consent have reachable permission denials. Alerts, sessions, passkeys and authenticator settings keep their existing endpoint-specific handling. The shared backup/installation read surfaces on recovery/fiscal pages inherit this wording; request-specific recovery/fiscal guidance stays in R3/R6/R7. Pairing retains its account/business guidance. Shared remote plan/setup refusals and revoked installations still need separate guidance. Request verification keeps reload guidance; no account or membership change is added. |
| R6: fiscal authority, entitlement and exhausted identities | `custody_unavailable`, `entitlement_unavailable`, `space_exhausted`, `reservation_untrusted`, `binding_conflict` → respectively “Check with your custodian”, retained-receipt access, “Contact your custodian”, signed-evidence verification failure or recorded-history conflict. Spanish: “Consulta al custodio”, retained-justification access, “Consulta al custodio”, signature failure or history conflict. | Not bug-only. [Policy (policy.ts:121)](../packages/fiscal-allocation/src/policy.ts#L121) and [store (store.ts:131)](../packages/fiscal-allocation/src/store.ts#L131) include absent adapters, denied entitlement, unverified or changed operator binding, missing/inactive signing trust, conflicting evidence and exhausted high-water identity space. The same family can cover configuration and genuine outside-authority decisions. | Clarify what evidence you can inspect/export and how to reach the actual outside custodian through an established route. This audit found no portal flow that provisions custody, changes entitlement or extends identity space. Record that missing capability separately; fiscal policy and golden evidence stay owner-gated. “Custodian” must not be silently replaced with unpaid Cloud support. |
| R7: fiscal continuity and uncertain history | `continuity_unavailable` → “The current outside register is unavailable. Try again shortly.” / “El registro externo actual no está disponible. Vuelve a intentarlo pronto.” `history_uncertain` and `allocation_unavailable` → the general temporary-service message in both languages. | Not bug-only. [Policy](../packages/fiscal-allocation/src/policy.ts#L121) also raises continuity failure for a missing adapter or invalid policy; [continuity (continuity.ts:45)](../packages/fiscal-allocation/src/continuity.ts#L45) covers unavailable evidence, uncertain history, contention and exhausted allocation attempts. [The controller (fiscal-allocation-controller.ts:24)](../apps/portal/src/fiscal-allocation-controller.ts#L24) does not give the latter two codes distinct guidance. | Separate temporary access/contended reads from configuration and evidence failures. Retain uncertain-request status checks and the original request identifier. Explain the next inspection/import step only when the signed-evidence rules permit it. No automatic new reservation or relaxation of the outside-register rule. |
| R8: Connect a venue with no eligible business | Delivered: the existing no-business message now tells you to sign out and sign in with the account that owns the business, in English and Spanish. | [The pairing store (pairing.ts:64)](../packages/registration/src/pairing.ts#L64) still lists only businesses permitted for your account. [The screen (pairing-screen.ts:11)](../apps/portal/src/pairing-screen.ts#L11) keeps its existing sign-out control. | New stubbed-browser checks exercise that control, sign in as a different account on the same page and return to the pending connection for code inspection. A failed sign-out stays recoverable. Reloading loses the in-memory request; reopen the connection link from Waitron. Preserving it across reloads and same-account membership/business creation remain separate missing capabilities; owner/local-manager pairing confirmation is unchanged. |
| R9: public availability failure | Visitors receive neutral English and Spanish unavailable guidance and the existing retry link. Account shows the last recorded forwarding attempt with a fixed cause, success or unknown. | [The gate](../packages/remote-access/src/public-gate.ts) keeps upstream bodies, addresses and credentials private. [Owner status](../packages/account-http/src/remote-access.ts) reads only observations bound to current authority, placement, revision and expiry. | Check the venue application and its connection, then use the existing **Refresh status / Actualizar estado** control. Refresh reads stored evidence; it does not probe or repair. Account clears evidence on refresh, expiry, navigation and permission loss. The [D291 plan](superpowers/plans/2026-10-26-private-forwarding-causes.md) is implemented; deployments still leave reporting disabled pending mount, primary-read and P1/P3 backup qualification. Gateway configuration still requires operator tools. |
| R10: public gate rejections and browser checking | Delivered: direct navigation receives short English and Spanish guidance for `421`, `429`, `413`, `404`, `405`, `400` and failed-proof `403`. Background rejection bodies stay empty. | [The gate](../packages/remote-access/src/public-gate.ts) retains every host, limit, proof and forwarding decision. Native HTTP/script probes reproduced empty navigation, stalled challenge/worker/solve requests and worker exhaustion before the fixes. The worker now reports exhaustion at 20 seconds; a 30-second page timer stops stalled attempts and ignores late results. | Check the original venue link after `421`; wait a minute after `429`; open the public page after other request/proof refusals. Unknown hosts receive no retry link. Unsupported/blocked workers and timeouts offer another-browser, update and JavaScript guidance; disabled JavaScript has static guidance. Fetch/proof refusals retain retry wording. Actual visitor browser support and production timing remain unqualified. |
| R11: stale monitoring and certificate alerts | Delivered: public/staff messages name Set up remote access and Refresh status (Configurar acceso remoto and Actualizar estado), with selected-name/status checks and explicit operator limits. | Not bug-only. [Email rendering](../packages/registration/src/account-mail.ts#L20) retains the Account link, venue and bounded check/expiry dates. [Account rendering](../apps/portal/src/alert-screen.ts#L16) still distinguishes failed, unknown and healthy checks independently from expiry warnings. [Native mail checks](../packages/registration/test/monitoring-action-mail.test.ts) and [browser checks](../apps/portal/test/monitoring-action-guidance-browser.test.ts) exercise both languages, read-only setup/refresh and later healthy results with synthetic replies. | [Owner checks and limits](local-monitoring.md#check-a-remote-access-alert) explain what you can inspect without claiming a cure. Gateway assignment, renewal configuration and installation still use operator tools. Owner-facing repairs, appliance certificate delivery and live provider activation remain unfinished capabilities, not paid support. No monitoring, certificate or gateway rule changes. Database and local gateway proof remain separate qualification. |

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

## Authenticator refusal inventory and refresh boundary (R1)

An old setup can no longer be usable while your account session still works.
Waiting does not repair it. Choose Check authenticator settings to discard the
local setup and read whether your authenticator is on or off. Start setup or
replacement again with your password and any required fresh code. A new setup
supersedes prior pending setups; the refresh itself only reads status.

The server keeps its shared `invalid_input` response. This avoids guessing
whether a token exists or belongs to another account. These are source receipts,
not local database execution; PostgreSQL qualification runs in CI while local
Docker is unavailable.

| Producer | Causes and boundary | Portal handling |
| --- | --- | --- |
| [HTTP parser](../packages/account-http/src/authenticator-factor.ts#L16) | Wrong/extra fields, oversized or absent password, malformed token, confirmation or proof. | General guidance and a status check. No server 400 becomes a code-field error. |
| [Activation before proof](../packages/registration/src/authenticator-factor.ts#L103) | Malformed/missing token; account, session, password fingerprint or factor version mismatch; consumed, expired or attempt-exhausted setup. A new begin consumes older pending setups. | Same guidance for every cause; no token-existence or other-account detail. Discard the old local secret before reading current status. |
| [Regenerate/remove](../packages/registration/src/authenticator-factor.ts#L180) | No active factor after account/password authority was checked. | Read current status before choosing a new setup or replacement. No automatic repeat of the refused change. |
| [Cancel](../packages/registration/src/authenticator-factor.ts#L201) | Malformed/missing, differently bound, consumed or expired setup, including expiry during cancellation. | Same general guidance and read-only status check, without automatically repeating cancellation. |
| [Credential and outage mapping](../packages/account-http/src/authenticator-factor.ts#L75) | Wrong authority/proof remains `403 credentials_invalid`; configuration failure remains 503, and request limits remain 429. | Keep credential feedback, session reconciliation for uncertain changes, and the server's retry delay. The new action does not reinterpret these responses. |

Native controller tests inject the shared response and verify refresh clears
local authority, respects pending work/rate waits, ignores a reply after an
account switch, and requires fresh proof according to the new status. Stubbed
browser checks exercise first setup, replacement, a newly active factor and an
absent factor in both languages, themes and widths. They qualify the portal path,
not database expiry, attempt accounting or cross-account security by themselves.
The existing database and HTTP tests remain unchanged and run in CI.

## Passkey refusal inventory and refresh boundary (R2)

The portal recognizes `400 invalid_input` only for registration options,
registration verification and removal. A list or sign-in failure keeps its own
feedback. The registration message cannot establish that your prompt expired or
that a key belongs to any account, so it gives conditional guidance instead.

| Producer | Causes of the shared response | Portal boundary |
| --- | --- | --- |
| [HTTP parser](../packages/account-http/src/passkeys.ts#L80) | Missing/extra fields, invalid IDs, passwords or credential structures, malformed JSON and oversized field values. | General registration/removal feedback; no field is blamed without evidence. |
| [Registration options](../packages/registration/src/passkeys.ts#L92) | The adapter returns an invalid challenge. | Read the list before a fresh prompt; do not promise waiting repairs configuration. |
| [Registration state](../packages/registration/src/passkeys.ts#L205) | Malformed/missing, differently bound, consumed or expired registration setup. | Start a new prompt with your password; do not reuse the old setup. |
| [Registration verification](../packages/registration/src/passkeys.ts#L108) | Verification throws or fails, user verification is absent, returned credential/counter is invalid, the account binding differs, or a credential already exists. | General feedback without identifying the key's owner. Check your own list and choose another key if already registered. |
| [Removal](../packages/account-http/src/passkeys.ts#L51) | Malformed request/ID/password; deleting a missing or differently owned ID still returns 204. | Refresh your own list before choosing a remaining key. Removal always needs your current password. |
| [Authority and rate admission](../packages/account-http/src/passkeys.ts#L57), [credential handling](../packages/account-http/src/passkeys.ts#L72) and [common errors](../packages/account-http/src/app.ts#L53) | Credentials, session, request-token, rate-limit and service failures retain their existing responses. | Keep their messages and retry delays. An uncertain change still reads the list before suggesting another change. |

Native checks exercise mapping boundaries, fresh password, read failure, pending
work, delays and account switches. Browser checks use the real portal and browser
passkey prompt with synthetic HTTP responses; they qualify the displayed action
and a new server-issued prompt, not database expiry or cryptographic verification.
The browser's already-registered (`InvalidStateError`) refusal uses the same
general registration guidance, without sending a verification request.
Cancellations keep their existing feedback.
Existing PostgreSQL store and HTTP tests run in CI; Docker is unavailable locally.
Oversized bodies (413), unsupported request formats (415) and interrupted bodies
(408) still share generic feedback. Their cause-specific messages remain
follow-ups. The server and its disclosure policy are unchanged.

Generic passkey failures say “Passkeys are unavailable. You can try again or sign
in with your password.” / “Las llaves de acceso no están disponibles. Puedes
volver a intentarlo o entrar con tu contraseña.” The shared message covers failed
list/options requests and browser prompt errors; it cannot establish a temporary
cause. Password sign-in remains on the sign-in screen. On Account, a failed list
read retains Retry and does not claim that your list is empty. Browser checks use
synthetic HTTP responses to follow both paths, including an incorrect password
before a successful sign-in. They do not qualify real credential verification or
repair a browser or service restriction. Request-body limits, malformed requests
and interrupted requests still need cause-specific feedback.

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

R1's inventory and status-refresh path are delivered. Later server-code changes
need their own cause-specific database and HTTP checks. Reserve each file against both Cloud
lanes before starting. This document records missing actions; it neither approves
a new membership flow nor enables production services.
