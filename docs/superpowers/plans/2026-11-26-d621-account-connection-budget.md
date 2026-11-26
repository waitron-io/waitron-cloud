# D621 account response during database failover

After an abrupt writer stop, give a signed-in person an explicit temporary-unavailable
response before the rehearsal client's five-second deadline. Verify the same session can read
again once PostgreSQL has a safe writer. D621's [P1 acceptance](2026-10-22-cloud-country-cell.md#acceptance-and-boundaries)
defines the larger recovery windows.

On 26 November a free run on Cloud 0502b1c6b measured four new PostgreSQL acquisitions at
5,001–5,008 ms after stopping the writer. All four opened a connection from a pool with spare
capacity. Each TCP attempt went to the stopped writer and received no reply. Its service
endpoint stayed ready for 16.8 seconds. The replacement was ready after 21.6 seconds. The
Account server's pool and the rehearsal client both have five-second deadlines
(`packages/account-http/src/server-cli.ts` and `scripts/test-cloud-integration.mjs`).

1. In `packages/account-http/test/server.test.ts`, reuse the real database, the CLI helper, and
   the loopback proxy pattern. Create one session with `createSession`. After a successful GET
   of that session, close the proxy's existing database sockets and accept one fresh socket
   without forwarding its PostgreSQL handshake. Assert the attempt reached that fixture and
   the request returns the existing HTTP 503, error code and Retry-After within four seconds.
   Restore forwarding and require HTTP 200 with the same cookie. Run the named case on the
   test box via `scripts/test-postgres.mjs` and observe the response deadline fail on the old server.
2. In `packages/account-http/src/server-cli.ts`, give the shared Account pool two seconds to
   acquire a connection. This also applies to newly opened connections at startup. Reuse the
   existing response path for unavailable PostgreSQL. Keep query deadlines, session rules, the
   database writer check and promotion policy in place. Run the named case and the existing CLI
   reconnect and readiness cases. These cover lost idle connections, a stalled new connection
   and an established connection that stops answering, respectively.
3. Run the outside Linux stop and restart replay on the exact candidate Cloud build and pinned
   Waitron. Require a writer-loss leg with marked requests reaching the stopped writer before
   promotion. Verify those acquisitions finish within the new budget with room for scheduling
   and the proxy. The original session must recover and the full encrypted restore must pass.
   Save the client, proxy, app, database and relay timing. Update `docs/backlog.md` with what the
   free run proves and leave Stockholm qualification open until the paid gate passes.

Expected change is about 3 code lines, 45–65 test lines and a short backlog update. Scope is
Account connection acquisition. PostgreSQL keeps its current writer and promotion checks, and
workers keep their existing connection settings. The five-second failure after recovery in
Stockholm remains open.
