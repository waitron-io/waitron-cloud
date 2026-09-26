# Cloud Operations Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add redacted operator health/readiness/metrics and an owner-scoped customer diagnostic download for the existing Cloud services.

**Architecture:** A new operations package aggregates live HTTP probes and read-only PostgreSQL projections without importing worker implementations. The account API exposes minimal liveness/readiness routes and a separately authenticated venue diagnostic route; the portal downloads the latter through a small controller.

**Tech Stack:** TypeScript, Node.js test runner, PostgreSQL, Hono, Lit, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-26-cloud-operations-status-design.md`

## Global Constraints

- Do not add a migration or mutate operational state.
- Do not expose credentials, configuration blobs, hostnames, fingerprints, emails, raw errors, account IDs, or cross-venue rows.
- Stale or missing evidence is never healthy.
- Do not add a staff role or a detailed public metrics endpoint.
- Use failing tests before every production behavior change.

## Review Focus

- Database or HTTP waits must be bounded and must not leak exception text.
- A migration added after this feature must make readiness fail until applied.
- Old terminal email failures must remain counters without permanently failing current readiness.
- A membership change during diagnostic generation must roll back/refuse the result.
- Metrics must not contain tenant identifiers or unbounded error values.

---

### Task 1: Minimal control API health routes

**Files:**
- Modify: `packages/registration/src/index.ts`
- Modify: `packages/account-http/src/app.ts`
- Modify: `packages/account-http/src/server-cli.ts`
- Test: `packages/account-http/test/account-http.test.ts`
- Test: `packages/account-http/test/server.test.ts`

**Interfaces:**
- Produces: `GET /api/health/live` and `GET /api/health/ready`; exports the canonical `migrationNames` list.

- [ ] Write failing app/server tests for live, ready, unavailable database, exact methods, and the complete migration list.
- [ ] Run the focused account HTTP tests and confirm failure because the routes and canonical list are absent.
- [ ] Add the two fixed-response routes before account rate limiting, with readiness querying every canonical migration.
- [ ] Replace the server CLI's duplicated migration list with the canonical export.
- [ ] Run the focused tests and typecheck.
- [ ] Commit the independently working health contract.

### Task 2: Operator status aggregate and CLI

**Files:**
- Create: `packages/operations/package.json`
- Create: `packages/operations/src/status.ts`
- Create: `packages/operations/src/metrics.ts`
- Create: `packages/operations/src/cli.ts`
- Create: `packages/operations/test/status.test.ts`
- Create: `packages/operations/test/metrics.test.ts`
- Create: `packages/operations/test/cli.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `operationsStatus(pool, options): Promise<OperationsSnapshot>` and `operationsMetrics(snapshot): string`.
- Produces: `pnpm operations:status [--ready|--metrics]` using `DATABASE_URL` and `CLOUD_CONTROL_API_URL`.

- [ ] Write PostgreSQL-backed failing tests for healthy, stale, missing, due, and parked-worker snapshots plus HTTP timeout/redirect/oversize failures.
- [ ] Run the status tests and confirm failure because the package/API is absent.
- [ ] Implement bounded probes, aggregate queries, stable component states/codes, and overall readiness.
- [ ] Write failing metrics tests for exact low-cardinality names and secret/tenant exclusion.
- [ ] Implement deterministic Prometheus rendering.
- [ ] Write failing CLI tests for JSON, readiness exit status, metrics, invalid configuration, and fixed database/probe diagnostics.
- [ ] Implement the CLI and root script, then run all operations tests and workspace typecheck.
- [ ] Commit the operator surface.

### Task 3: Owner-scoped diagnostic API

**Files:**
- Create: `packages/account-http/src/diagnostics.ts`
- Modify: `packages/account-http/src/app.ts`
- Create: `packages/account-http/test/diagnostics.test.ts`

**Interfaces:**
- Produces: `POST /api/account/diagnostics/read` with `{installationId}` and a version-1 redacted document.

- [ ] Write failing tests for the exact redacted payload, non-owner/foreign IDs, CSRF/method/body/rate boundaries, stale evidence, and permission loss during a blocked read.
- [ ] Run the focused test and confirm the missing route fails.
- [ ] Implement the transactional owner recheck and bounded projection without importing provider configuration.
- [ ] Run focused account tests and workspace typecheck.
- [ ] Commit the customer-safe API.

### Task 4: Bilingual portal download

**Files:**
- Create: `apps/portal/src/diagnostic-types.ts`
- Create: `apps/portal/src/diagnostic-controller.ts`
- Modify: `apps/portal/src/api.ts`
- Modify: `apps/portal/src/app.ts`
- Modify: `apps/portal/src/installation-screen.ts`
- Modify: `apps/portal/src/locale.ts`
- Create: `apps/portal/test/diagnostic-controller.test.ts`
- Modify: `apps/portal/test/installation-browser.test.ts`
- Modify: `apps/portal/test/accessibility.test.ts`

**Interfaces:**
- Consumes: the version-1 diagnostic API document.
- Produces: one owner-only English/Spanish download action per installation.

- [ ] Write failing controller validation, account-fence, lost-response, and download-name tests.
- [ ] Implement strict payload validation and an injected browser saver.
- [ ] Add English/Spanish copy and the owner-only installation action.
- [ ] Extend browser tests for real download contents, tenant exclusion, accessibility, phone width, desktop width, and light/dark themes.
- [ ] Run portal unit/browser tests and typecheck.
- [ ] Commit the portal surface.

### Task 5: Operator documentation and backlog

**Files:**
- Create: `docs/operations-status.md`
- Modify: `docs/backlog.md`
- Modify: `packages/account-http/README.md`

**Interfaces:**
- Documents: commands, exit states, metric meanings, redaction, thresholds, customer export, and production limits.

- [ ] Document local commands and example outputs without real identifiers.
- [ ] Update Operations, Self-service journeys, and Service monitoring backlog entries while preserving deployment/provider work.
- [ ] Run formatting/diff checks and the focused tests from Tasks 1–4.
- [ ] Commit documentation, then run the repository's finish-branch workflow.
