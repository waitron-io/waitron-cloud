# Request-body guidance implementation plan

Finish line: you can act on passkey body refusals in English and Spanish. Scope: five passkey POST stages; other portal controllers and malformed JSON remain open with generic feedback. No server, transport, retry, schema, fiscal or authority change.

Authority: Lane G queue D254, watcher 2026-11-09 12:52; backlog cleanup relays 12:58/13:01. Claude reviewed; build after watcher approval. Execute inline; retain full authentication finish-branch review and reservation check.

Sources: `packages/account-http/src/request.ts:2-27` returns `invalid_input`: 413 invalid/excessive length or overflow; 415 unsupported content type/encoding; 408 abort/read timeout; malformed JSON stays 400. `server.ts:59-66` also returns socket 408. `apps/portal/src/api.ts:77-79` preserves status/code. Source-only; no runtime proof.

Files under `apps/portal/`: `src/passkey-controller.ts`, `src/passkey-screen.ts`, `src/locale.ts`; `test/passkey-refusal.test.ts`, `test/passkey-refusal-browser.test.ts`, `test/passkey-failure-guidance-browser.test.ts`. Also `docs/refusal-self-service-audit.md`, named `docs/backlog.md` sentences below. Budget (additions+deletions, excluding plan): 80 code, 140 test, 70 documentation lines. Watcher approves growth beyond 1.5 times.

- [ ] Native RED: exact 408/413/415 + `invalid_input` at all five POST stages. Explicit sign-in context distinguishes its options/verify from list reads; list 408 keeps unavailable/Retry. Preserve precedence: credentials, session, rate limits, generic 400, fencing, delays and uncertain results. Test wrong codes, 431, 400 sign-in, 413 credentials, verify returning false, and added/removed keys reporting reconciled success.
- [ ] Browser RED: parameterise existing options/registration/removal fixtures; sign-in verify is native-only. Check exact copy, one alert/submission, fresh prompt, management list refresh/fresh password, password alternative. Keep every current assertion.
- [ ] Minimal mapping: require exact status/code and POST context; management shows existing Check passkeys. Copy prefix EN / ES:

| Status | Prefix |
| --- | --- |
| 413 | This passkey request’s size wasn’t accepted. Retrying may not help. / No se ha aceptado el tamaño de esta petición de llave de acceso. Puede que reintentarlo no sirva. |
| 415 | This passkey request arrived in an unsupported format. / Esta petición de llave de acceso ha llegado en un formato no admitido. |
| 408 | This passkey request was interrupted. / Se ha interrumpido esta petición de llave de acceso. |

Append space + suffix: sign-in, “Try password sign-in instead.” / “Prueba a entrar con tu contraseña.”; management, “Check passkeys before another change.” / “Comprueba tus llaves de acceso antes de otro cambio.” No reload or shorter-password advice.

- [ ] Run RED then GREEN: `pnpm --dir apps/portal exec node --test --test-timeout=120000 test/passkey-refusal.test.ts test/passkey-refusal-browser.test.ts test/passkey-failure-guidance-browser.test.ts`. Then `pnpm --dir apps/portal typecheck` and `pnpm --dir apps/portal exec node --test --test-timeout=120000 test/passkey-account-fencing.test.ts test/passkey-pending-controller.test.ts test/passkey-controller.test.ts test/passkey-transport-boundary.test.ts test/passkey-response-boundary.test.ts test/passkey-enrollment-reconciliation-browser.test.ts test/passkey-removal-reconciliation-browser.test.ts`. Inspect 48 captures: status + sign-in/management + EN/ES + light/dark +390/1280; unique filenames.
- [ ] Audit: passkey-only; keep authenticator, session, alerts, backup, billing, diagnostics, installations, pairing, recovery, remote, consent, usage, signup/reset and malformed 400 as open; remove retired R6/R7 references (audit:147,154; backlog:4140,4150-4153). Backlog: update D254 R2; Decisions:243 records owner 2026-11-09 dropping D582 for Waitron#2543/Cloud#1052/#1042 and abandoning D570 for unapproved D618. Remove only D582’s parked/plan-task sentences:375,385-393; D570 restart/weekly sentences:3137-3142,3147-3149; D592’s final D570 cross-reference:9. Preserve D582-S:376-385, historical D560/A951 limits, and P1 service/fault requirements and unqualified provider/capacity facts. Watcher decides whether to separate documentation before build.
