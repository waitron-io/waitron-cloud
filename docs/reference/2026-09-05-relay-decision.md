> Moved from [Waitron at `830cf71fe854`](https://github.com/clintongormley/waitron/blob/830cf71fe854c7aa0b0d8c95078d3fe49ca05a10/docs/superpowers/specs/2026-09-05-relay-decision.md) on 2026-09-22.
> This is a historical reference. Its original decisions, proposals and evidence have
> been preserved; read the [current product discussion](../product-and-platform.md)
> and [cloud backlog](../backlog.md) for current scope and unresolved decisions.
> Technical and legal claims below have not been revalidated as part of this move.

# The relay — decision (Track B, decision (ii))

**Date:** 2026-09-05. **Status:** owner decision, recorded (docs-only). Two owner decisions taken the
same day underpin it: **replication between a box and its cloud instance flows over a WireGuard
link** (taken in the Track A session; its spec is that session's and was not on `main` when this was
written), and **the link is box ↔ its OWN cloud instance**, never a central hub we run.
**Supersedes** the relay half of the tunnel design
([`2026-08-27-sync-cloud-mirror-tunnel-design.md`](https://github.com/clintongormley/waitron/blob/830cf71fe854c7aa0b0d8c95078d3fe49ca05a10/docs/superpowers/specs/2026-08-27-sync-cloud-mirror-tunnel-design.md)),
the T1 "Spain-hosted relay we operate, reimplementing snitun" bullet of
[dashboard §5](https://github.com/clintongormley/waitron/blob/830cf71fe854c7aa0b0d8c95078d3fe49ca05a10/docs/superpowers/specs/2026-08-07-management-dashboard-design.md), and the "relay tokens" in the control
plane's list (`docs/backlog.md` → Track C item 4).

## 1. The decision

**No relay — neither ours nor off-the-shelf.** The relay existed to let the cloud reach a box that
sits behind the shop's router, without the box accepting inbound connections, and to do it blind.
WireGuard does that job: the box dials out to its cloud instance and keeps the link alive through
NAT (§5, row 1), and from then on the instance can reach the box's own ports over the link. Both
things the relay carried ride it:

- **Replication** — the cloud instance pulls (or subscribes) over the link. Not this note's spec.
- **Remote access (paid tier)** — the venue's remote name resolves to the cloud instance. The
  instance passes TLS connections for the *box's* name straight down the link **without terminating
  them** (SNI passthrough, e.g. nginx's `stream` module with `ssl_preread` — §5, row 2), so TLS still
  ends on the box, login still terminates on the box, and the instance stays blind — the property
  the tunnel design and dashboard §5 T1 required of the relay. Its *own* name (the cloud's till and
  dashboard) it serves itself. This is a standard forwarder, not software we write or adopt.

Tills never used the relay: under decision (i)
([`2026-09-05-till-reroute-route-decision.md`](https://github.com/clintongormley/waitron/blob/830cf71fe854c7aa0b0d8c95078d3fe49ca05a10/docs/superpowers/specs/2026-09-05-till-reroute-route-decision.md)) they reach
the promoted cloud on its public name.

**Retired, with Track B item 2's build and never before the link carries replication** (the tunnel
is the only proven path today): `@waitron/tunnel` (client + relay stand-in), the `WAITRON_TUNNEL_*`
config and its boot wiring, the tunnel-aware undici dispatcher (`tunnelHttpClient`), the "cloud-mirror
follow-ups from B" hardening list, and the multi-tenant relay + relay tokens from the control plane's
list. Delete, do not keep as an option — two paths to the box is the CLAUDE.md §1 defect class.

## 2. Evaluated and not needed — so the evaluation is not re-run

Done before the WireGuard decision reached this session; kept because each would resurface.

- **frp** (Apache 2.0, Go). Would have been the pick had a relay still been needed: `frps` reads the
  SNI from the ClientHello on a read-only connection and forwards the raw bytes — blind by
  construction (§5, row 3) — and its server plugin lets an HTTP hook of ours approve each box's login
  (§5, row 4). Cost was a Go sidecar on the appliance.
- **Tailscale / Headscale.** Blind (DERP relays forward WireGuard ciphertext — §5, row 5) but machine
  legs only: a browser cannot reach the dashboard without Tailscale installed, Funnel has no custom
  domains and unpublished bandwidth limits (row 6), and Headscale describes itself as single-tailnet,
  hobbyist scope (row 7). Note the irony: the chosen answer IS WireGuard, without the control plane
  Tailscale sells — ours hands out the keys.
- **cloudflared.** Cloudflare's edge ends the visitor's TLS and `cloudflared` opens its own TLS to the
  origin (its `noTLSVerify` / `originServerName` origin parameters — row 8): not blind, and a third
  party in the path. Out.
- **Finish our relay.** Hostname routing, many boxes, a token store, the four hardening items, and
  hosting — a bespoke network relay we would operate forever. Moot.

## 3. What the control plane hands out (Track C item 4 consumes this)

Per box: a WireGuard keypair, its cloud instance's endpoint and allowed addresses, and the box's
public names. No relay tokens, no relay address. Per instance: the forwarder's map of box name →
box's link address.

## 4. Open items this leaves (none the relay's to settle)

- **One name or two.** Dashboard §5 T1 says the canonical hostname "resolves publicly to the relay
  and locally to the box IP". Plain DNS cannot answer one name two ways without the venue's resolver
  cooperating; either the box answers the name on the LAN (mDNS/its own resolver) or LAN and remote
  use two names. Decision (i)'s tenant-domain cookie needs the LAN name under the tenant domain
  either way. Belongs to the control plane + onboarding.
- **Remote access without a standby.** The cloud instance is now the box's front door, so a customer
  who wants remote access and no standby still gets a small instance — packaging, not design.
- **What else rides the link** (adopt-bundle fetch, box status, the reserved-identity round trip) —
  the WireGuard spec's.

## 5. Provenance — external claims

| # | Claim used here | Source | Their words |
| --- | --- | --- | --- |
| 1 | A box behind NAT keeps a WireGuard link open by sending keepalives | wireguard.com, *Quick Start* | "When a peer is behind NAT or a firewall, it might wish to be able to receive incoming packets even when it is not sending any packets." — "this option will keep the 'connection' open in the eyes of NAT." — "A sensible interval that works with a wide variety of firewalls is 25 seconds." |
| 2 | A forwarder can route by SNI without terminating TLS | nginx docs, `ngx_stream_ssl_preread_module` | "allows extracting information from the ClientHello message without terminating SSL/TLS, for example, the server name requested through SNI" |
| 3 | frp routes HTTPS by SNI and forwards raw bytes | `fatedier/frp`, `pkg/util/vhost/https.go` | `reqInfoMap["Host"] = clientHello.ServerName`; "Note that Handshake always fails because the readOnlyConn is not a real connection." |
| 4 | frp's server can delegate login approval to an HTTP hook | `fatedier/frp`, `doc/server_plugin.md` | "frp server plugin is aimed to extend frp's ability without modifying the Golang code."; operations Login / NewProxy / CloseProxy / Ping / NewWorkConn / NewUserConn; `{"reject": true, "reject_reason": "invalid user"}` |
| 5 | Tailscale's relays cannot read traffic | tailscale.com, *DERP servers* | "A DERP server blindly forwards already-encrypted traffic from one device to another." — "it's impossible for a DERP server to decrypt your traffic." |
| 6 | Funnel: no custom domains, unpublished bandwidth limits | tailscale.com, *Tailscale Funnel* (via search summary — re-read the page before quoting further) | Funnel names are under the tailnet's `ts.net` domain; funnel traffic "is subject to bandwidth limits" that are not published |
| 7 | Headscale's stated scope | `juanfont/headscale` README | "a narrow scope, a _single_ Tailscale network (tailnet), suitable for a personal use, or a small open-source organisation" — "This project is not associated with Tailscale Inc." |
| 8 | cloudflared is itself the TLS client to the origin | Cloudflare docs, *Origin parameters* | `originServerName`: "Hostname that `cloudflared` should expect from your origin server certificate." — `noTLSVerify`: "This will allow any certificate from the origin to be accepted." |

Row 6 is the one row sourced from a search summary rather than the page's own text; it decided
nothing here (Tailscale was out on the browser-reachability point alone).
