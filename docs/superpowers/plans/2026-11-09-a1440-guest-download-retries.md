# A1440 guest-preparation download retries

**Authority — watcher, `~/waitron-campaign-i/questions.md`, 2026-11-09 09:23:**

> DEVIATION approved: write the small plan for retrying the guest-preparation downloads and naming the one that failed (that is the 08:48 idle-server cause). Same shape as lane C’s A1462 for Waitron’s own scripts: bounded attempts, 5xx and network errors only, never a 4xx. Claude read, then PLAN FOR APPROVAL.

This approves writing this plan only. Claude reads it, then the watcher approves it before implementation.

**Design**

Add one small Bash download function inside each independently transported script. Deliberate duplication avoids changing transport. Cover only Node, pnpm and Actions runner.

Allow at most three attempts, with one-second delays. Capture curl’s exit status and `%{http_code}` explicitly; use no curl retry flags. Retry HTTP 500–599 only with exit 22, or selected network exits 6, 7, 18, 28, 52, 55 and 56. Any HTTP 4xx takes precedence and refuses immediately, including 408/429. TLS, protocol, local-write, size and integrity failures refuse immediately. Exit meanings and HTTP reporting were checked using local `curl --manual` (8.7.1).

Retain pinned URLs/digests, HTTPS-only requests/redirects, ten-second connection limit and existing size ceilings. Use the existing 60/30/120-second transfer limits as total per-download budgets, including delays: Node 60 seconds, pnpm 30, runner 120. Clamp each attempt and delay to that download’s remaining time. Keep `session.py:245,252` stage limits of 360/180 seconds and their session-deadline minimum. The existing outer stage limit can still interrupt preparation; these retries do not add another stage deadline or extend the current one.

Remove partial output before every attempt; never resume or append. Verify integrity before extraction, outside the retry loop. Diagnostics identify the fixed tool name, attempt, numeric status and refusal/exhaustion reason; suppress raw curl errors, URLs, headers and response bodies.

**Exact implementation files and estimates**

- `deploy/disposable-tests/guest-tools.sh`
- `deploy/disposable-tests/runner-tools.sh`

Approximately **90–120 added code lines**, combined.

- `scripts/disposable-tests/dependencies.test.mjs`
- `deploy/disposable-tests/ci-session.test.py`

Approximately **130–170 added test lines**, combined.

- `deploy/disposable-tests/README.md`
- `docs/backlog.md`

Document bounded downloads, describe download retries separately from the existing readiness retries, and distinguish local evidence from pending publication/qualification.

**Behavioral TDD and acceptance**

1. Add one harness executing actual shell download/verification sections with controlled curl answers and temporary files. First observe 503→success fail against today’s single attempt; then implement and pass.
2. Cover network recovery, three-attempt exhaustion, HTTP 401/404/408/429, TLS/permanent errors, corrupt bytes, fresh overwrite, safe named diagnostics, retained pins/options and exhausted time budgets.
3. Extend an existing preparation case to assert unchanged stage/session deadlines and failure before the prepared marker; retain its test count and assertions.
4. Run `node --test scripts/disposable-tests/dependencies.test.mjs scripts/disposable-tests/session.test.mjs scripts/disposable-tests/bundle.test.mjs` and Bash syntax checks. Existing root imports cover these tests; transport and bundle membership stay unchanged.

**Finish line**

After approval: implement inline, obtain Claude run-it review and current-head CI, then finish the branch. Use the existing recipe-publication procedure only when authorised; qualify one fresh CI guest through completion and cleanup. Record evidence and remaining limits. No production qualification is implied.

Exclude apt changes, host images, controller/routing changes, sizing, credentials and capacity machinery. GitHub-first routing remains parked.