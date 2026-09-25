# Remote health probes

## Intent

Run Cloud-owned checks from outside the gateway process so an active placement is not
called healthy merely because its desired configuration or tunnel contact looks healthy.
Each completed observation must prove both the public HTTPS journey through the bot
challenge and the staff hostname's trusted TLS handshake. D1 emits bounded structured
observations; D2 will decide how to persist them and open or recover incidents.

This is local integration work. It creates no cloud resources, changes no Waitron source,
and sends no credentials or customer traffic beyond the two configured remote hostnames.

## Authoritative targets

`RemoteProbeStore.targets(limit)` reads at most 100 current, non-revoked installations
whose `remote_access` service is configured and which have a placement and both current
hostnames. The result contains the installation and venue IDs, current installation
configuration revision, and the staff and public hostnames. It does not accept a URL,
address, port, path or hostname from a command-line caller. Results are ordered by venue
and installation ID so repeated runs are stable and tenant results cannot be combined.

The configuration revision travels with every observation. D2 must reject a result when
that revision is no longer current; D1 must not reinterpret or omit it.

## Network boundary

Production resolution accepts only public unicast IP addresses. DNS results are bounded
to four addresses and pinned for a request sequence, so a second lookup cannot redirect a
probe to loopback, link-local, private, documentation, multicast or reserved space.
Requests use the configured hostname for SNI and HTTP `Host`; the chosen address is only
the socket destination. An explicit injected fixture resolver may map exact configured
hostnames to private addresses in automated tests. The normal CLI exposes no fixture
address, arbitrary URL or trust-disable switch.

The runner allows at most four installations in flight. Each TLS connection or HTTP
request gets five seconds, a complete service check gets fifteen seconds, responses are
limited to 64 KiB, redirects are failures, and the challenge difficulty and solve work
are capped. Shutdown aborts outstanding sockets and produces no completed observation
for an interrupted target.

## Public check

For the configured public hostname the probe:

1. makes a verified HTTPS `GET /public/availability` and requires the normal 403
   challenge page without following redirects;
2. gets `/_cloud/challenge`, validates its exact JSON shape and bounded difficulty, and
   solves the supplied proof of work with periodic event-loop yields and an abort check;
3. posts the exact answer to `/_cloud/solve`, accepts only 204 and one secure
   `__Host-waitron-public` cookie; and
4. repeats `GET /public/availability` with only that cookie, requiring 200 and valid JSON.

The successful result records the checked time, elapsed milliseconds, and the verified
leaf certificate's `valid_from`, `valid_to` and SHA-256 fingerprint. It never records the
challenge, access cookie, response body, DNS address or a raw network error.

## Staff check

The staff check performs a TLS handshake only. It sends the configured staff hostname as
SNI, uses normal certificate and hostname verification, sends no HTTP request or login
credential, and closes the socket after capturing the same certificate evidence. A
certificate which is untrusted, mismatched, expired or not yet valid is a failure.

## Results and failures

A target result has schema version 1, its installation/venue/revision identity, a
completion time, and separate `public` and `staff` service results. Success is emitted
only after that service's complete proof. Failures use a fixed code (`dns`,
`address_forbidden`, `timeout`, `tls`, `challenge`, `http`, `response_limit` or
`cancelled`) plus checked time and elapsed milliseconds; raw exception text is not part
of the result. One service failure does not prevent checking the other, and one venue
failure does not stop other venues.

The CLI supports a one-shot run and a continuous 60-second loop. It writes one complete
JSON result per line and fixed redacted diagnostics to stderr. It exits non-zero for
startup/database failure, while individual route failures remain observations for D2.

## Evidence

Real local TLS fixtures cover success through the actual public challenge, refused and
timed-out connections, response limits, wrong hostname, untrusted certificates, private
address refusal and explicit fixture-only loopback routing. PostgreSQL tests prove target
limits, stable tenant identity, current revision, and suppression after service removal,
revocation or replacement. Concurrency and abort tests prove the global bound and that
an interrupted target cannot emit fresh success. The local monitoring and remote-access
guides document the command and the distinction between these observations and incidents.
