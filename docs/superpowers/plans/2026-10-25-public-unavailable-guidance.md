# Public availability refusal guidance (D254/R9)

1. Keep D254/R9 limited to visitor wording in `packages/remote-access/src/public-unavailable.ts`, tests in `packages/remote-access/test/public-gate.test.ts`, and the two audit/backlog entries. Owner diagnostics remain an explicit open R9 follow-up.
2. **Tests first:** extend the existing real HTTPS fixture with selectable upstream 403/404/503, disconnect, and recovery controls; preserve existing fixture calls.
3. Add EN/ES cases for each failure: solve the real browser challenge, receive unavailable HTML, follow its retry link while failure persists, restore upstream availability, follow retry again, and receive 200. Assert upstream request counts prove retries actually forward.
4. Pin neutral `<title>`, heading, and message:
   - EN: **“Venue unavailable”** / “This venue’s page is unavailable. You can try again.”
   - ES: **“Local no disponible”** / “La página de este local no está disponible. Puedes volver a intentarlo.”
5. Retain existing assertions, changing only the two existing title-wording expectations. Preserve negotiation, language fallback, privacy, JSON, status, headers, proof expiry, quotas, counters, and credential/cookie checks.
6. Run `node --test packages/remote-access/test/public-gate.test.ts`; confirm new copy assertions fail against current wording for the expected reason.
7. Change only the EN/ES title/message values. Retain retry labels and `href="/public/availability"`; preserve JSON, public 503, all headers, styling, privacy, proof, and limits.
8. Rerun the native test file to green; use repository-required focused checks without Docker or a duplicate whole-workspace run.
9. Capture eight browser screenshots: EN/ES × light/dark × 390/1280px. Check wrapping, contrast, focus visibility, and clickable retry through persistent failure and recovery using the real local gate.
10. In a disposable checkout, deliberately restore temporary wording, break the retry target, and expose upstream error text separately; require corresponding checks to fail, then restore and rerun green.
11. Update R9 in `docs/refusal-self-service-audit.md` and `docs/backlog.md`: record visitor guidance and evidence; leave cause-specific Account diagnostics open.
12. Commit with `git commit -s`, retaining hooks; announce readiness for `finish-branch`.
13. During finishing, rebase first, obtain the requested Claude run-it review in an isolated complete checkout, resolve findings with tests first, and require green CI tied to the exact final PR head.
14. Hold the shared landing lock through the main-checkout merge, dependency install and owned cleanup; require current main to be an ancestor of the green head. Release the lock, then verify all independent exact-merge CI jobs before reporting completion.
15. Keep all execution local or within repository review/CI workflows: no AWS/provider operations, spending, or mail.