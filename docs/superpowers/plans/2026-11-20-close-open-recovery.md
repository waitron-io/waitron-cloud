# Show when another recovery expires

If another recovery blocks your approval, you can see when to try again or use its original link to close it sooner. The watcher set this scope in Lane K questions.md at 21:25 on 20 November: “the refusal tells the owner when the open recovery expires”. The existing approval screen remains the only surface for this change.

## Return and display the deadline

- In `packages/backups/src/recovery.ts`, read `expires_at` from the existing blocking-row query in `BackupRecovery.start`. Keep its position after the proof, venue-owner and plan checks, venue lock, expiry cleanup and same-request handling. Carry that deadline in a `RecoveryActiveError` with the existing `backup.recovery_active` message.
- In `packages/account-http/src/recovery.ts`, handle that error on owner approval after the approval transaction rolls back. Return HTTP 409 with `error: 'recovery_active'` and the stored ISO timestamp as `recoveryExpiresAt`. Reuse the existing code and permission checks. The shared error handler and machine responses stay as they are.
- In `apps/portal/src/api.ts`, include the optional timestamp only when valid for that path, status and error code. Set or clear it when processing each refusal in `apps/portal/src/recovery-controller.ts` after the existing stale-reply check. Render it only with the active-recovery refusal.
- In `apps/portal/src/recovery-screen.ts` and `locale.ts`, use the existing `formatDateTime` for local date and time, including seconds as on the rest of this screen. An unapproved request lasts 15 minutes and may already have expired by the time the other recovery closes. Proposed English copy is “Another recovery is open until {deadline}. Use its original link to close it sooner. Once it closes, start a new request on the replacement server. Keep the old server stopped.” Spanish is “Hay otra recuperación abierta hasta {deadline}. Usa su enlace original para cerrarla antes. Cuando se cierre, inicia otra solicitud en el servidor de sustitución. Mantén detenido el servidor anterior.” Keep the generic message when the deadline is missing or invalid and keep Check request status available.

Scope excludes Account lists, new routes, close controls, permission and recovery-state changes, migrations and automatic retries.

## Prove the change

1. Add a case to `packages/account-http/test/recovery-v2.test.ts` using its real PostgreSQL fixture. Approve one request and attempt another for the same venue. Assert the exact 409 body matches the first operation's expiry. An unrelated account choosing that venue gets the existing denial without a deadline. Run alongside `packages/backups/test/recovery.test.ts` through `node scripts/test-postgres.mjs exec node --test` with those two paths.
2. Extend `apps/portal/test/recovery-guidance.test.ts` to check valid, missing and invalid expiry replies and confine the deadline to the approval conflict. Add a timed conflict to `apps/portal/test/recovery-guidance-browser.test.ts` alongside its generic refusal. Pin that browser context to UTC. Check the date and time, new-request and original-link advice, stopped-server guidance and status action. Run both named portal files with `node --test`. Inspect the timed alert in English and Spanish, light and dark, at 390 and 1280 pixels.
3. See the new assertions fail before editing production code. Rerun the named checks after implementation and run `pnpm typecheck`. Keep the existing recovery assertions.

Update R3 in [the backlog](../../backlog.md) and [the refusal audit](../../refusal-self-service-audit.md), plus [recovery guidance](../../local-backups.md). Early closure still needs the original link. Budget 35–50 added production lines, 45–75 test lines and 5–10 guidance lines. Claude reviews this plan before watcher clearance.
