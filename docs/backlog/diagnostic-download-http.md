# Diagnostic download HTTP boundaries

## Diagnostic download qualification

Run `node --test apps/portal/test/diagnostic-transport-boundary.test.ts` to check
that refused or unreadable replies save nothing, explicit retries remain usable
and server waits hold until their exact expiry. These native checks preserve
the existing permissions and waits. Server redaction, genuine browser file
downloads and production-network behaviour remain unqualified; the native
HTTP client and controller tests cannot establish them.

Run `node --test apps/portal/test/diagnostic-account-fencing.test.ts` to check
that delayed replies leave your current download alone after you change accounts,
return to the original account or sign out. [PR #644](https://github.com/waitron-io/waitron-cloud/pull/644)
delivered this native controller coverage.

PR #644's earlier qualification stopped during source installation before any
private-replay check began (run `40646201742`, job `122675571593`). D530 retains
[that unresolved installation cause](cost-setup-timeout.md#source-installation-stops-at-669-of-670-packages).
Passing native checks or a later hosted run do not repair it. Production
permission checks and provider qualification remain separate.
