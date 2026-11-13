# Guest-menu delivery and online ordering

## Hosted menu (A670-CLOUD)

Build delivery/confirmation and the permanent hosted link with portal takedown after
D619, following the [watcher-cleared contract plan](../superpowers/plans/2026-11-14-a670-cloud-guest-menu.md).
The watcher cleared these two slices on 14 November 2026 at 00:22; this is not owner
approval of the design. Every venue connected to Cloud qualifies, without a new
billing gate. Takedown blocks publication until you choose Enable in the portal.
No guest-menu service or public deployment is implemented by this plan.

## Live forwarding belongs to online ordering (Waitron A509)

The watcher's 14 November 00:22 cut moves live forwarding out of A670-CLOUD. Keep
its transport, current-serving-box lookup, two-cell routing, upstream status
distinction and hosted-copy fallback work with
[Waitron A509](https://github.com/clintongormley/waitron/blob/main/docs/backlog/till.md#a509-online-ordering-for-collection-at-the-counter).
The central relay would share each gateway's existing 120 requests/minute per-source
budget. Settle that capacity and the browser challenge policy before forwarding is
built; no trusted-proxy exception or challenge bypass is approved here.

The owner's 13 November 22:31 direction, recorded in Lane D questions.md, is:
“Online ordering requires forwarding cloud requests to the server. If the internet
is down we can show a cloud hosted copy of the menu but without online ordering.”
This repository records Cloud's part; Waitron owns A509's product and sender work.
