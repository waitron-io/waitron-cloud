# Shared account controls

Use `@waitron/ui-core` for account-form controls in Waitron and Waitron Cloud.
It contains the button, input, textarea, card, icon, spinner, form actions and error
summary, plus theme tokens, the shared field styles (`fieldStyles`) and keyboard helpers. Application authentication and validation
stay in your application.

`@waitron/ui-core/theme` is the theme derivation; it takes Waitron's values as an argument.
`@waitron/ui-core/theme/waitron` exports those values, read from the token files.

The package is private. Registry publication is a separate release step; this
checkout builds and tests a local tarball without publishing it.

## Use a control

Import only the controls you need and apply the theme to your application root:

```ts
import "@waitron/ui-core/components/wt-input";
import { applyTokens } from "@waitron/ui-core/tokens";

applyTokens(document.querySelector<HTMLElement>("#app")!);
```

The root export registers all included controls. Lit 3 is a peer dependency;
install it in the consuming application. Packaged exports contain JavaScript and
TypeScript declarations. Theme CSS is compiled into `applyTokens`; no Vite plugin
or Waitron source alias is needed. Raw token CSS is also exported at
`@waitron/ui-core/tokens/colors.css` and `@waitron/ui-core/tokens/structure.css`.

The controls use shadow DOM and are not native form-associated elements. Listen
for `wt-change` and the action button's click; bind `submitOnEnter` at the form
boundary. Give inputs a semantic name, an autocomplete purpose and visible labels.
Use field `error` properties, `wt-form-actions`'s `error` property and
`focusFirstInvalid` for validation, as Waitron's `docs/developers/design-system.md`
→ Forms describes.

## Develop and verify

Waitron's existing `@waitron/ui` imports re-export these implementations, including
its existing component paths. Workspace imports resolve source, while `pnpm pack`
runs the build and switches the packed manifest to built exports.

```sh
pnpm --filter @waitron/ui-core test
pnpm --filter @waitron/ui-core test:package
```

The package test exercises both the workspace tarball and a separately staged
`@waitron-io/ui-core@0.2.0` artifact. It installs each tarball and Lit into a temporary directory,
checks declarations, builds the consumer without workspace aliases and opens it in
Chromium. It checks keyboard submission, password reveal, accessible errors,
themes, isolated component imports and a missing-file negative control. CI runs
this proof alongside both UI packages' coverage; nightly mutation tests cover both.

The tarball carries the repository's existing `LICENSE` and `LICENSE-GRANTS.md`
under `dist/`. This extraction does not change their terms.

Prepare a release for Cloud with the [source preparation guide](../../docs/developers/shared-ui-preparation.md). Cloud owns version reservation, source CI selection and publication; the source package stays private and keeps its workspace version.
