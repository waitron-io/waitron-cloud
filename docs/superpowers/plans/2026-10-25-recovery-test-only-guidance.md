# Recovery test-only refusal guidance

Scope: R4 of the [self-service refusal audit](../../refusal-self-service-audit.md). This changes how you recover from a refusal, without changing who can recover a venue or which environments are supported.

1. Confirm D254/R4 boundaries: change only the API allowlist, recovery mapping, bilingual guidance, new tests, and your own R4 backlog/audit row. Leave R8 parked and foreign lane D reserved scripts untouched.
2. Preserve every existing test byte for byte. Use the new tests already written; retain the observed controller RED receipt showing `forbidden` instead of `recoveryTestOnly`.
3. Before product edits, establish behavioral failures for API acceptance of `local_integration_only` and controller mapping of exactly HTTP 403 with that code.
4. Cover all four controller actions and permission controls with new native tests, including guidance and existing authority/confirmation clearing.
5. Add fault cases proving other 403 codes, other statuses, unknown codes, transport failures, and 5xx retain their existing behavior. Assert cooldown, uncertain-write reconciliation, and no automatic replay.
6. Recognise `local_integration_only` only for HTTP 403 on `/recovery/` API paths. Leave other statuses and paths as `unexpected_response`, with API-through-controller regression cases for 400/409/503 and non-recovery paths.
7. Map only status 403/code `local_integration_only` to `recoveryTestOnly`. Preserve every server gate and existing controller safeguard.
8. Add English and Spanish guidance stating: recovery is for test venues only; return to replacement server setup to start recovery for a test venue; production recovery is unavailable.
9. Run focused native tests through GREEN, then required native local checks. Do not start, repair or call Docker; it is unavailable.
10. Exercise the browser close flow through the real API client with a stubbed HTTP boundary, checking the returned code, displayed guidance, permission controls, and absence of replay.
11. Inspect all eight views: EN/ES × light/dark × 390/1280. Verify readable guidance and usable controls.
12. Update only your R4 backlog/audit row with behavioral, fault, browser, and visual evidence; verify the final diff and unchanged existing tests.
13. Rebase onto fresh main, then run one installed Claude run-it review in an isolated temporary checkout containing the complete candidate tree and dependencies. Triage findings and verify fixes.
14. Create signed-off commits with hooks enabled, push, and require full CI on the current exact head before landing. Retain review approval after later rebases; inspect changes and rerun affected checks.
15. Acquire the shared `mkdir` lock for the entire land/install/own-cleanup sequence. Refresh main and require it to be an ancestor of the candidate; if rebasing changes the head, repeat hooks and exact-head CI.
16. Land, update and install main, clean up only owned worktree/local/remote branches under the lock, then release it. Inspect every CI job for the exact merge commit and report receipts.
