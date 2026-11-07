# Shared UI

[Waitron PR #519](https://github.com/clintongormley/waitron/pull/519)
implements `@waitron/ui-core` in Waitron with seven account controls, theme tokens
and common helpers. Existing `@waitron/ui` imports re-export the same implementation;
venue controls and brand delivery remain in Waitron. The runtime package depends on
Lit rather than `@waitron/shared`. A built tarball installs outside the workspace and
passes declaration, Chromium form, theme and accessibility checks. Both UI packages
retain coverage and weekly mutation gates. The [approved design](../superpowers/specs/2026-09-23-shared-ui-extraction-design.md)
and [execution plan](../superpowers/plans/2026-09-23-shared-ui-extraction.md) record the boundary.
The [Waitron publisher](../shared-ui-release.md) published private `@waitron-io/ui-core@0.2.1`
from Waitron `47dda656b641794051c64d3752937ea7f2929f51`. Cloud pins it in its
manifest and lockfile; a Chromium fixture checks the installed controls and themes,
and declaration checking uses `skipLibCheck: false`. Local installs use GitHub CLI
authentication; CI uses its package-read token. The portal now uses these controls for signup, login and recovery. Read the first weekly mutation scores
after the split in Waitron; the extraction verifies the wiring and coverage, not the
new full mutation scores. The released Waitron source sets primary-button hover opacity to 1
(`packages/ui-core/src/components/wt-button.ts:81-84` at the source commit above).
Cloud still has its matching override in `apps/portal/src/styles.css:13`. English/Spanish light/dark
accessibility checks pass 4/4 with
`node scripts/test-postgres.mjs exec pnpm --dir apps/portal exec node --test --test-timeout=120000 test/accessibility.test.ts`.
A 2026-10-12 Chromium hover probe confirms axe checks the rendered primary button:
the portal has no contrast violation in either theme, while restoring the shared
0.85 hover opacity reproduces 3.61:1 in both light-theme languages. The remaining cleanup is to remove Cloud’s duplicate override and qualify the
released hover colors in the portal.
