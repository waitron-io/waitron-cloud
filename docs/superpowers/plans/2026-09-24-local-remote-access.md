# Local remote access implementation plan

> Use `superpowers:executing-plans` inline. The owner delegated design decisions and
> authorised all five tasks, review and landing without further questions.

**Goal:** Two real Waitron servers share an isolated, replaceable local remote-access cell.
**Architecture:** PostgreSQL placements and signed gateway manifests drive WireGuard and
HAProxy. A separate HTTPS public gate checks challenges before forwarding. Staff TLS
keys stay at the venue, with ACME DNS-01 certificate issuance and local DNS overrides.
**Stack:** Node/TypeScript, PostgreSQL, WireGuard, HAProxy, Docker, ACME/Pebble, pnpm.
**Spec:** `docs/superpowers/specs/2026-09-24-local-remote-access-design.md`.

## Constraints

Local test deployment only; ES/aws placement metadata. Do not modify host DNS/network,
install a global CA, activate fiscal trading or expose general LAN/SSH access. Use
existing signed installation proofs and fresh manager/owner gates for customer actions.
Per-venue isolation, public default-deny routes, 60-second revocation/replacement local
target and 10-minute management-outage gateway expiry. Keys never in browser or logs.

## Review focus

- Malicious peer changes routes: gateway firewall still blocks other venues.
- Host/SNI mismatch and forged bot token: no request reaches the venue.
- Management absent across restart: saved manifest cannot extend authority.
- Failed certificate renewal: existing valid staff TLS remains usable locally.
- Gateway replaced during active sessions: stable names reconnect; no cross-venue reuse.

## 1. Placement and gateway manifests

Files: registration migration `010_remote_access.sql`; new `packages/remote-access/`
with `src/placement.ts`, `src/manifest.ts`, package/tsconfig, matching `test/*.test.ts`;
account startup migration guard/tests; root pnpm workspace lock.

- [ ] Write failing PostgreSQL tests: two installations get distinct /32 peers and names;
  assigning a duplicate name/IP conflicts; revoked installations cannot provision; restart
  returns the same venue names; placement updates use expected revision.
- [ ] Implement `RemoteAccessStore(pool, options).provision(installationId, peerPublicKey)`
  returning `{cellId,staffHostname,publicHostname,address,gatewayPublicKey,endpoint}`.
  Store only public peer keys, canonical names and operator-selected endpoint/address.
  Keep installation lock order before placement; require an active registration.
- [ ] Write failing signed-manifest tests for wrong key/cell/audience, expiry, replay/rollback
  and changed payload. Implement `signManifest(input,key)` and `verifyManifest(envelope,
  trustedKey,cellId,now,minimumRevision)`. Manifest has routes and expiresAt; no private keys.
- [ ] Export current active routes from PostgreSQL; revocation excludes one venue without
  altering the other. Gateway export sequence increments durably on every export; renewal preserves
  route authority only within its signed interval. Persist accepted revision and expiry.
- [ ] Run focused tests and commit with sign-off.

## 2. Gateway and public gate

Files: remote-access `src/haproxy.ts`, `src/public-gate.ts`, `src/gateway.ts`, `src/cli.ts`;
`deploy/local-remote/{Dockerfile,compose.yaml}`; focused socket/TLS tests.

- [ ] RED generated configuration test checks exact SNI routing/default rejection, source
  limits, per-venue maxconn and no staff private key. Render canonical validated names/IPs
  only; run `haproxy -c` against the actual image before accepting configuration.
- [ ] RED HTTPS tests count upstream calls: absent/forged/expired/cross-host challenge,
  blocked path/method, Host mismatch and arbitrary Cookie/Authorization never pass through.
- [ ] Implement signed expiring proof-of-work challenge, bounded address buckets and total
  cache, request/header/time/concurrency limits. The challenge page computes in a Worker;
  response cookie is Secure/HttpOnly/SameSite=Strict and host-only. Allow GET of exactly
  `/public/availability`; discard incoming credentials/forwarded headers. Verify upstream
  TLS by assigned staff hostname and root. Return 503 on unavailable venue.
- [ ] Implement gateway apply loop with temp config, validation, reload and explicit removal
  of established connections when authority is revoked/expired. Poll every30s. Atomically
  persist validated manifest; no accepted signed expiry may be extended locally.
- [ ] Linux WireGuard setup uses gateway /32 and peer /32 routes, no peer forwarding. Run
  actual two-peer malicious-route test, unknown SNI and expired-manifest connection tests.
- [ ] Run focused tests/types and commit.

## 3. Certificate issuance and Waitron endpoint

Files: remote-access `src/certificates.ts`, `src/dns.ts` and ACME fixture/tests;
Waitron `apps/server/src/cloud-remote.ts`, `tls.ts`, `boot.ts`, focused tests and fixture.

- [ ] RED cert tests reject extra CSR name, wildcard, foreign/duplicate custom name and
  unverified delegation. Use a local Pebble ACME server with real DNS-01 validation.
- [ ] Implement exact-authorized CSR issuance via maintained acme-client; DNS adapter
  accepts only `_acme-challenge` of the authorized hostname. Produce assigned/custom
  CNAME instructions and prove delegation before enabling custom names.
- [ ] RED Waitron tests create staff key/CSR locally, install matching chain atomically,
  load a renewed TLS context, and preserve old context/files on invalid renewal. Validate
  private file permissions and exclude keys from reported configuration/browser status.
- [ ] Add exact `/public/availability` with no private operational details; wire the HTTPS
  public-gate target. Boot a real Waitron fixture with this certificate and stable manager
  Origin. Keep existing LAN and role authorization behavior.
- [ ] Run focused tests, format/types and sign-off commits in both repos.

## 4. Actual two-venue integration and self-service guidance

Files: `scripts/test-local-remote.mjs`, local deployment files, guides/backlogs,
Waitron fixture and Cloud status integration.

- [ ] Start disposable PostgreSQL/Pebble/DNS, gateway and two peers. Create real two-Waitron
  installations with their existing browser pairing, issue certificates via real DNS-01,
  apply remote configurations, and start tunnels. All paths use temp roots/test keys.
- [ ] Assert public challenge and upstream counters, real staff login and cross-venue cookie
  rejection, HTTPS hostname trust and unchanged staff key on gateway replacement.
- [ ] Restart DNS client/clear cache, stop external gateway/resolver path, and demonstrate
  local override HTTPS remains usable. Record the tested resolver configuration and limits.
- [ ] Replace gateway, preserve endpoint/key/names, record reconnection <60 seconds. Remove
  one route through actual Cloud revocation and show the other still works; expire a cached
  manifest during management outage and show no surviving remote streams.
- [ ] Report actual probe health; document local run/stop, LAN override, DNS rollback,
  bot-control limits and certificate recovery. No claim of built menus/bookings or universal
  router compatibility. Update stale docs/backlogs.
- [ ] Commit, initial rebase, one Claude review per meaningful branch, fix findings with TDD,
  normal push hooks/current-head CI, finish then protected land and clean both worktrees.
- [ ] Continue directly to programme task5: independent continuous backup and snapshots.
