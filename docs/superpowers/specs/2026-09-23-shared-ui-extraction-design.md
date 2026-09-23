# Shared UI extraction

Status: proposed design, 2026-09-23. The owner approved proceeding with shared UI
extraction before Cloud account screens. The package boundary below is ready for
review; keeping its source in Waitron is the recommended repository choice.

## Outcome

You maintain one implementation of the controls used by Waitron and Cloud account
screens. A fix to an input, keyboard interaction or theme can reach both products
through a versioned package. Authentication, permissions and account journeys remain
in their applications.

The first slice extracts and verifies that package. Registry activation and Cloud
account screens follow separately. No package publication or new hosted repository
is part of this slice.

## Package boundary

Create `@waitron/ui-core` in Waitron's `packages/ui-core`. Start with the controls
needed for account forms:

- `wt-button`, `wt-input`, `wt-card`, `wt-icon` and icon registration, `wt-spinner`.
- `wt-form-actions`, `wt-form-error-summary` and `submitOnEnter`.
- Theme tokens and `applyTokens`; general base/disabled styles and the shared
  focus, event and identifier helpers these components already use.

Keep the existing element names, properties, events, styles and form behaviour.
Preserve named inputs, password-manager autocomplete, password-reveal slots,
keyboard submission and accessible errors. The shared package depends on Lit and
browser APIs, without a dependency on `@waitron/shared` or either product's API.

Keep floor-plan/table components, venue content-language state, floor-specific
styles, the remaining controls and brand asset delivery in Waitron for this slice.
Move further controls when Cloud needs them. Preserve existing licence and notice
files in the extracted source and packaged artifact; this change does not choose a
new licence or make Cloud source public.

## Waitron compatibility

Keep `@waitron/ui` as the existing entry point. Its moved component modules become
thin re-exports from `@waitron/ui-core`, including the deep import paths used by
existing screens. Split the general styles from the floor styles, and re-export
both from the current style module. Existing controls that remain in Waitron use the
same shared helpers and styles.

Each custom element must have one implementation and one registration. Do not copy
implementations into compatibility modules or register a second class under the
same element name. This keeps the initial consumer changes small while making the
shared code the implementation Waitron actually uses.

## Build and distribution contract

Produce a versioned package containing browser JavaScript, TypeScript declarations,
theme assets and notices. Provide explicit component entry points so importing one
control does not register the whole library. Bundle the current CSS `?inline`
imports into the artifact; consumers must not need access to Waitron's source tree
or its Vite configuration. Keep Lit external as a peer dependency.

Verify the packed artifact by installing it into a standalone browser fixture outside
the Waitron workspace. That fixture imports the published entry points and renders
an account-form example. Workspace links alone are not evidence that Cloud can
install the package.

The subsequent release step selects and configures private distribution, then pins
Cloud to an exact released version and lockfile. Local absolute paths, an unversioned
branch and a second maintained source copy are not the distribution contract.

## Verification

Move the selected components' existing behavioural and accessibility tests with the
implementation, preserving their assertions. Retain tests of Waitron-specific code
and add coverage for the compatibility entry points. Update source-scanning guards
and CI selection so moving files does not remove their coverage or weekly mutation
checks. Carry Waitron's current coverage requirements into the new package.

Use real Chromium for focus, keyboard, accessibility and theme tests. The standalone
package fixture must exercise light/dark themes, an invalid form and its error summary,
input names/autocomplete, Enter submission and duplicate imports. Prove it works from
an installed tarball with no workspace source aliases. Run focused affected-consumer
checks locally and the required current-commit CI checks before landing.

## Why this approach

Keeping the package in Waitron retains the existing development and test environment.
A separate UI repository would give it an independent release workflow but adds another
repository and CI setup immediately. Publishing the current `@waitron/ui` wholesale
would also expose venue-specific exports and its workspace dependency. A small package
plus compatibility exports gives Cloud the account controls while preserving Waitron's
existing import paths.

## Inspection receipts

Inspected Waitron at `00786ae779d130f077b1b9dcd8cd45d11c4b702f`:

- `packages/ui/package.json`: private source package, Lit and `@waitron/shared` dependencies.
- `packages/ui/src/index.ts`: generic controls mixed with floor and language exports.
- `packages/ui/src/tokens/index.ts`: theme CSS imported with Vite's `?inline` syntax.
- `packages/ui/src/base-styles.ts`: general styles and floor tray styles in one module.
- `packages/ui/src/components/wt-input.ts` and `submit-on-enter.ts`: existing account-form behaviours.
- `packages/ui/vitest.config.ts`, `stryker.config.json` and the developer UI conventions:
  real-browser tests, accessibility assertions, coverage and mutation gates.

This is a source and dependency inspection, not a completed extraction or packaging test.
