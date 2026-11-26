# Shared UI

[Waitron PR #519](https://github.com/clintongormley/waitron/pull/519)
implements `@waitron/ui-core` in Waitron with seven account controls, theme tokens
and common helpers. Existing `@waitron/ui` imports re-export the same implementation;
venue controls and brand delivery remain in Waitron. The runtime package depends on
Lit rather than `@waitron/shared`. A built tarball installs outside the workspace and
passes declaration, Chromium form, theme and accessibility checks. Both UI packages
retain coverage and weekly mutation gates.
The [Waitron publisher](../shared-ui-release.md) published private `@waitron-io/ui-core@0.2.55`
from Waitron `eaba6448d0373d64f110bd8b7c614c57cbd05cc0`. Cloud pins it in its
manifest and lockfile; a Chromium fixture checks the installed controls and themes,
and declaration checking uses `skipLibCheck: false`. Local installs use GitHub CLI
authentication; CI uses its package-read token. The portal now uses these controls for signup, login and recovery. Read the first weekly mutation scores
after the split in Waitron; the extraction verifies the wiring and coverage, not the
new full mutation scores.
