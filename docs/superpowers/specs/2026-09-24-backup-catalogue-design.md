# Snapshot catalogue

Owners can open snapshot history from a venue card in the account portal. Keep one
organisation visible and one catalogue open. Show capture time, verification state,
retention class and earliest ordinary expiry date. Mark the snapshot protected by
retention and any active recovery separately from verification success. Protection
is a deletion policy, not a claim that an archive currently restores.

Use POST /api/account/backups/list with venueId and optional cursor. It is a passive
read requiring a current session, owner membership, exact Origin and CSRF proof.
Limit requests to 30 per account per minute and return at most 50 snapshots. The
cursor identifies the venue and point UUID; read its exact timestamp from the same
venue, including tombstones, to preserve ordering across pages and cleanup. No query strings, storage endpoints, object keys, encryption keys,
source node IDs or module contents are sent to the browser. Deleted/deleting points
are omitted. Default recovery selection is the latest currently verified snapshot,
not the newest upload. Empty/unprovisioned venues return an empty list.

Retention dates use the same PostgreSQL expressions as cleanup: 30 days or 12 calendar
months, using shared UTC calendar arithmetic independent of connection time zones. Read protection with the same historical verification rule as cleanup, and
mark active unexpired recovery operations. No additional deletion or recovery action
is enabled. Explain that continuous backup is normally the newest recovery source;
these snapshots are archival/fallback points and guided replacement is still pending.

Switching organisation, account or venue clears data and fences delayed responses.
Retry-After survives closing/reopening; transient failures retain the existing page
with an error. More results replaces the page, keeping browser memory bounded.
English/Spanish labels, phone layout and accessible controls use the existing UI.

## Implementation and proof

1. Add owner-scoped bounded SQL/API with real PostgreSQL tests for isolation, permissions,
   cursor ties/paging, protection, expiry, excluded points and public field projection.
2. Add validated types, generation-fenced controller and catalogue panel; test account
   and venue changes during responses, pagination errors and retry delays.
3. Add bilingual browser checks for empty/populated states, snapshot selection, paging,
   organisation switching and accessibility. Update API docs and backlog.
4. Run focused checks, isolated finish-branch review, exact-head CI, land and clean up.
