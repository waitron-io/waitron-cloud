# Guest-menu delivery and online ordering

On 24 November 2026 the [customer-menu design](https://github.com/clintongormley/waitron/blob/bd5d2dbf1976ede08efc2ebaf0e01b9063aaf884/docs/superpowers/specs/2026-11-24-customer-menu-design.md#7-cloud-in-waitron-cloud-its-own-plan) chose live delivery from the serving box with HTTP caching. This replaces the offline-copy decision below for customer menus. Follow the [Cloud build plan](../superpowers/plans/2026-11-25-d643-public-customer-menu.md) for the live gate and hosted-copy retirement.

## Hosted menu (A670-CLOUD)

Qualify Waitron's signed sender against the
[Amazon test Cloud guest address](../test-cloud.md#open-the-synthetic-venues-guest-menu)
and check a fresh publication, withdrawal and republication from a phone on
mobile data. Check the trial or paid-plan gate with Waitron’s preview before rolling
it out on the Amazon test Cloud. Qualify production DNS, certificates and rollout
separately. Generalize publication keys beyond
the current base-language keys and sole stored variant; keep guest preference
matching separate from that publication change. Keep Norwegian
`no`/`nb` and region/script choices as questions for
[Waitron’s shared matching rule](https://github.com/clintongormley/waitron/blob/7b5c9643ad4d4060f4783e89fbd3db49cd49e09c/packages/shared/src/language-match.ts). See
[local deployment](../local-deployment.md#exercise-a-stored-guest-menu-copy)
for focused synthetic checks.

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
