# Request-body guidance implementation plan

Finish line: you can act on each passkey body refusal in English/Spanish.
Authority: Lane G D254 queue, watcher 2026-11-09 12:52/12:58/13:01. Before building: one Claude review (`~/workspace/tools/claude-seat.sh review-branch`), then watcher approval; execute inline.

Scope: passkey authentication/registration options, verification and removal only. Leave other controllers open in the audit. No server, schema, fiscal, security, transport, retry automation or protocol changes.
Source receipts: `packages/account-http/src/request.ts:2-27` returns `invalid_input`: 413 covers invalid/excessive declared length or streamed overflow; 415 unsupported content type/encoding; 408 abort/body-read timeout; malformed JSON remains 400. `packages/account-http/src/passkeys.ts:31` parses before operations. `apps/portal/src/api.ts:68` preserves status/code; `passkey-controller.ts:76-84` overrides feedback locally.
Source inspection only; no runtime proof. Budgets, excluding this plan: ≤80 changed code lines, ≤100 test lines, ≤50 documentation lines; measure additions+deletions with `git diff --numstat`. Return to watcher if insufficient.

Changed files under `apps/portal/`:

- `src/passkey-controller.ts`, `src/passkey-screen.ts`, `src/locale.ts`.
- `test/passkey-refusal.test.ts`, `test/passkey-refusal-browser.test.ts`, `test/passkey-failure-guidance-browser.test.ts`.

Also change only `docs/refusal-self-service-audit.md` and the named `docs/backlog.md` paragraphs below.

- [ ] Add native cases: five POST stages, exact status+`invalid_input` pairs; wrong codes/statuses retain fallback. Preserve every existing assertion, especially generic 400, credential/session/rate guards, account fencing and uncertain-write reconciliation.
- [ ] Reuse stubbed-browser, bundled portal and virtual authenticator patterns; no database fixtures. Assert exact copy, one alert, no automatic resubmission, reload/fresh prompt, management read-before-change/fresh password and working password alternative.
- [ ] Observe generic-fallback failures using `pnpm --dir apps/portal exec node --test test/passkey-refusal.test.ts test/passkey-refusal-browser.test.ts test/passkey-failure-guidance-browser.test.ts`.
- [ ] Map those pairs; retain mapping precedence and reconciliation. Reuse Check passkeys for management. Exact EN / ES copy:
  - 413: “Request size refused. Reload and start again.” / “Tamaño de solicitud rechazado. Recarga y empieza de nuevo.”
  - 415: “Request format refused. Reload before starting again.” / “Formato de solicitud rechazado. Recarga antes de empezar de nuevo.”
  - 408: “Request interrupted. Start a fresh attempt.” / “Solicitud interrumpida. Inicia un nuevo intento.”
  Append existing password-alternative sentence for sign-in; management instead appends “Check passkeys before another change.” / “Comprueba las llaves de acceso antes de otro cambio.” Never suggest shortening passwords.
- [ ] Run `pnpm --dir apps/portal exec node --test test/passkey-account-fencing.test.ts test/passkey-pending-controller.test.ts test/passkey-response-boundary.test.ts`; rerun the failing-test command: require nonzero test counts and all passing; run `pnpm --dir apps/portal typecheck`. Inspect screenshots: EN/ES × light/dark × 390/1280, all three refusals.
- [ ] Update audit R2/body follow-ups and backlog D254 R2; remove retired R6/R7 to-dos and stale R5 references. Remove D582 tunnel/D570 EC2 tasks from Current state, Provisioning and D592’s trailing cross-reference. Keep dated Decisions: owner 2026-11-09 replaced D582 with simple remote access Waitron#2543/Cloud#1052/#1042; abandoned D570’s spiralling infrastructure for small D618, still unapproved. Preserve live successors, deliberate limits and remaining P1 dependencies. Record observed evidence only.
