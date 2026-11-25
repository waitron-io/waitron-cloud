# Guest-menu delivery and online ordering

On 24 November 2026 the [customer-menu design](https://github.com/clintongormley/waitron/blob/bd5d2dbf1976ede08efc2ebaf0e01b9063aaf884/docs/superpowers/specs/2026-11-24-customer-menu-design.md#7-cloud-in-waitron-cloud-its-own-plan) chose live delivery from the serving box with HTTP caching. This replaces the offline-copy decision below for customer menus. Follow the [Cloud build plan](../superpowers/plans/2026-11-25-d643-public-customer-menu.md) for the live gate and hosted-copy retirement.

## Hosted copy still present

Waitron [#4266](https://github.com/clintongormley/waitron/pull/4266) stopped the sender. An existing copy can still serve its last published prices and allergens. The [test Cloud guide](../test-cloud.md#open-the-synthetic-venues-guest-menu) describes the current reader and owner controls. D643 retires it after the live test path honours the venue block and plan gate.

## Live ordering

[Waitron A509](https://github.com/clintongormley/waitron/blob/main/docs/backlog/till.md#a509-online-ordering-for-collection-at-the-counter) owns online ordering. The 13 November 2026 design expected a stored read-only fallback for menus. The 24 November customer-menu design above supersedes that choice.
