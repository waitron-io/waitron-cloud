> Moved from [Waitron at `830cf71fe854`](https://github.com/clintongormley/waitron/blob/830cf71fe854c7aa0b0d8c95078d3fe49ca05a10/docs/superpowers/specs/2026-09-21-cloud-ingress-wireguard-gateway-design.md) on 2026-09-22.
> This is a historical reference. Its original decisions, proposals and evidence have
> been preserved; read the [current product discussion](../product-and-platform.md)
> and [cloud backlog](../backlog.md) for current scope and unresolved decisions.
> Technical and legal claims below have not been revalidated as part of this move.

> Incoming architecture handoff, saved 2026-09-21. Recorded as received; not yet reconciled with Waitron's current cloud topology (see the note at the end of this file).

# Technical Architecture Handoff: Multi-Tenant Web Ingress & NAT Traversal

## Executive Summary

This document details the architectural design for exposing customer on-premises servers (behind NAT / CGNAT) to the public internet using custom domains.

The architecture pairs a **Central Cloud Gateway** (acting as an entry-point reverse proxy) with a **WireGuard Overlay Network** (providing secure, persistent NAT traversal to customer on-prem nodes).

---

## 1. High-Level Architecture Overview

```
                                    ┌────────────────────────────────────────────────────────┐
                                    │                 CENTRAL CLOUD GATEWAY                  │
                                    │                                                        │
[ Client A Domain ] ──A Record────┐ │ ┌──────────────────┐    ┌───────────────────────────┐ │
 (client-a.com)                   ├──┼─►│  Caddy Ingress   │───►│  WireGuard Interface wg0  │ │
                                  │ │ │ (On-Demand TLS)  │    │      (10.200.0.1/16)       │ │
[ Client B Domain ] ──A Record────┘ │ └────────┬─────────┘    └─────────────┬─────────────┘ │
 (client-b.com)                     │          │                            │               │
                                    └──────────┼────────────────────────────┼───────────────┘
                                               │ Check domain validity      │
                                               ▼                            │
                                    ┌────────────────────┐                  │ (Encrypted WireGuard
                                    │ Validation Service │                  │  UDP Tunnels)
                                    │  (/validate-domain)│                  │
                                    └────────────────────┘                  │
                                                                            │
                       ┌────────────────────────────────────────────────────┴────────────────────────────────────────────────────┐
                       │                                                                                                         │
                       ▼                                                                                                         ▼
┌───────────────────────────────────────────────┐                                                         ┌───────────────────────────────────────────────┐
│        ON-PREM NODE A ("WAITRON A")           │                                                         │        ON-PREM NODE B ("WAITRON B")           │
│                                               │                                                         │                                               │
│  ┌──────────────────┐  ┌───────────────────┐  │                                                         │  ┌──────────────────┐  ┌───────────────────┐  │
│  │ WireGuard Client │  │ Local Web Service │  │                                                         │  │ WireGuard Client │  │ Local Web Service │  │
│  │   (10.200.0.2)   │  │   (Port 8080)     │  │                                                         │  │   (10.200.0.3)   │  │   (Port 8080)     │  │
│  └──────────────────┘  └───────────────────┘  │                                                         │  └──────────────────┘  └───────────────────┘  │
└───────────────────────────────────────────────┘                                                         └───────────────────────────────────────────────┘
```

### Core Components

1. **Central Cloud Gateway (VPS):** A lightweight Linux VPS (e.g., 2 vCPU, 2GB RAM) running a public-facing reverse proxy and a central WireGuard interface.
2. **Reverse Proxy (Caddy):** Handles incoming HTTP/HTTPS traffic, performs dynamic TLS certificate provisioning via Let's Encrypt (On-Demand TLS), and proxies traffic to the targeted internal WireGuard IP.
3. **Validation API (`ask` Endpoint):** A lightweight internal backend service queried by Caddy to authorize whether a requesting domain is tied to an active, paying customer before issuing SSL certificates.
4. **WireGuard Overlay Network:** An isolated point-to-point UDP overlay (`10.200.0.0/16`) maintaining persistent outbound tunnels from on-prem servers back to the Gateway.
5. **Customer On-Prem Nodes ("Waitron"):** The customer local infrastructure running the application web server and a WireGuard client configured with `PersistentKeepalive`.

---

## 2. Component Technical Specifications

### A. Network Layer (WireGuard)

* **Gateway Interface:** `wg0` (`10.200.0.1/16`) listening on UDP port `51820`.
* **Peer Subnet Allocation:** `10.200.0.0/16` (allows up to ~65,000 active customer nodes).
* **NAT Traversal:** Enabled via `PersistentKeepalive = 25` set on all customer nodes. The client sends a packet every 25 seconds, forcing upstream router state tables to keep the UDP session open indefinitely.

#### Gateway Configuration (`/etc/wireguard/wg0.conf`)

```ini
[Interface]
Address = 10.200.0.1/16
ListenPort = 51820
PrivateKey = <GATEWAY_PRIVATE_KEY>

# Peer Rule Template (Repeated for each onboarded node)
[Peer]
# Customer A - Waitron Node
PublicKey = <WAITRON_A_PUBLIC_KEY>
AllowedIPs = 10.200.0.2/32

[Peer]
# Customer B - Waitron Node
PublicKey = <WAITRON_B_PUBLIC_KEY>
AllowedIPs = 10.200.0.3/32
```

#### Client Configuration Template (`/etc/wireguard/wg0.conf`)

```ini
[Interface]
Address = 10.200.0.2/16
PrivateKey = <WAITRON_A_PRIVATE_KEY>

[Peer]
PublicKey = <GATEWAY_PUBLIC_KEY>
Endpoint = <GATEWAY_PUBLIC_IP>:51820
AllowedIPs = 10.200.0.1/32
PersistentKeepalive = 25
```

---

### B. Ingress Layer (Caddy with On-Demand TLS)

Caddy terminates SSL and maps incoming `Host` headers to internal WireGuard IPs.

#### Caddy Configuration (`/etc/caddy/Caddyfile`)

```caddy
{
    # Global settings for On-Demand TLS authorization
    on_demand_tls {
        ask http://127.0.0.1:8000/validate-domain
    }
}

# Dynamic catch-all block for incoming custom domains
:443 {
    tls {
        on_demand
    }

    # Route directives maintained dynamically via Caddy API or local mappings
    @customer_a host client-a.com
    handle @customer_a {
        reverse_proxy 10.200.0.2:8080 {
            header_up X-Real-IP {remote_host}
            header_up X-Forwarded-For {remote_host}
            header_up X-Forwarded-Proto {scheme}
        }
    }

    @customer_b host client-b.com
    handle @customer_b {
        reverse_proxy 10.200.0.3:8080 {
            header_up X-Real-IP {remote_host}
            header_up X-Forwarded-For {remote_host}
            header_up X-Forwarded-Proto {scheme}
        }
    }
}
```

---

### C. Validation & Anti-Abuse (`ask` Endpoint)

To protect the Gateway from Let's Encrypt rate limits and Denial of Service (DoS) attacks, Caddy calls an internal HTTP endpoint prior to issuing any certificate.

* **Protocol:** HTTP GET
* **Endpoint format:** `http://127.0.0.1:8000/validate-domain?domain=<requested-domain>`
* **Responses:**
  * `200 OK`: Domain belongs to an active user; allow certificate issuance.
  * `403 Forbidden`: Domain is unrecognized or inactive; deny certificate issuance and drop connection.

#### Example FastAPI Endpoint Implementation (`main.py`)

```python
from fastapi import FastAPI, Response, status
import redis

app = FastAPI()
db = redis.Redis(host='localhost', port=6379, db=0)

@app.get("/validate-domain")
def validate_domain(domain: str):
    # Lookup domain in state store (e.g., Redis)
    if db.exists(f"domain:{domain}"):
        return Response(status_code=status.HTTP_200_OK)
    return Response(status_code=status.HTTP_403_FORBIDDEN)
```

---

## 3. Request Lifecycle & Traffic Flow

1. **DNS Resolution:** End-user requests `https://client-a.com`. DNS resolves `client-a.com` to the **Cloud Gateway Public IP**.
2. **TLS Handshake:**
   * Caddy intercepts the request on port 443.
   * If a certificate for `client-a.com` is cached, Caddy completes the handshake.
   * If no certificate exists, Caddy issues an internal request to `http://127.0.0.1:8000/validate-domain?domain=client-a.com`.
   * Upon receiving `200 OK`, Caddy requests an SSL certificate from Let's Encrypt, caches it, and completes the TLS handshake.
3. **Tunnel Forwarding:** Caddy evaluates the reverse proxy rules, maps `client-a.com` to `10.200.0.2:8080`, and forwards the encrypted web payload over the `wg0` interface.
4. **On-Prem Execution:** The client's WireGuard interface (`10.200.0.2`) decapsulates the packet and routes it locally to `127.0.0.1:8080`.

---

## 4. Security & Isolation Guidelines

1. **Inter-Peer Isolation:** Customers **must not** be able to communicate with each other over the WireGuard overlay subnet. Run the following rule on the Gateway VPS:
   ```bash
   iptables -A FORWARD -i wg0 -o wg0 -j DROP
   ```
2. **Gateway Hardening:**
   * Open inbound ports: `80/TCP` (HTTP validation), `443/TCP` (HTTPS), `51820/UDP` (WireGuard).
   * Close all other ports except `22/TCP` (SSH, restricted to administrative IPs).
3. **Header Preservation:** The reverse proxy must append `X-Forwarded-For` and `X-Forwarded-Proto` headers so customer apps can correctly detect original client IP addresses and protocol schemes.

---

## 5. Operations & Onboarding Sequence

```
[ New Customer Sign-Up ]
          │
          ▼
1. Assign unique internal IP (e.g., 10.200.0.4).
2. Generate WireGuard keys (Public/Private key pair).
3. Register domain mapping in Database: "client-c.com" -> 10.200.0.4.
4. Append Peer config to Gateway WireGuard (`wg syncconf`).
5. Provision Caddy route rule via Caddy REST API (`POST /config/`).
6. Deliver pre-configured WireGuard config file to Customer On-Prem Node.
          │
          ▼
[ Customer Instruction: Point DNS A Record to Gateway Public IP ]
```

---

## Where this fits among Waitron's cloud concerns

This handoff covers **one** of three separate cloud concerns; they should not be confused with one another:

1. **Remote and public access (this document).** Getting an on-prem box reachable from the internet: the dashboard for the owner and staff, and public pages (menus and the like) for customers. That is what the gateway here provides — a public entry point plus a NAT-traversing tunnel back to the box.
2. **Database replication for failover.** With SQLite + Litestream, a safe copy of the database now streams **directly to S3 (or similar)**. This needs no cloud instance of its own.
3. **Running the primary in the cloud.** Only this concern requires an **instance per restaurant**, because a cloud node would have to actually serve sales.

So this shared-gateway design is orthogonal to (2) and (3): it is about access, not about replication or about where the primary runs. What still needs deciding on its own terms is the shared-gateway model itself — the abuse surface of one entry point serving many customers, and the blast radius of a single Caddy config holding every customer's domain routes.
