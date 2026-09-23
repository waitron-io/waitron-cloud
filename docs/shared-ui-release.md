# Release the shared UI package

Cloud consumes a versioned build of Waitron's account controls. You develop the
controls in Waitron; this repository owns their private distribution as
`@waitron-io/ui-core` on GitHub Packages.

## Choose and publish a version

Update `scripts/release/ui-source.json` with a full Waitron commit and the version
in that commit's `packages/ui-core/package.json`. Choose a commit whose Waitron CI
has passed. Review and land that change before releasing.

The **Shared UI release** workflow builds that exact source and runs Waitron's
independent tarball browser test. It preserves the built files and notices, changes
the package name to the organisation scope, removes development/build hooks and
records the original repository, commit and version in `waitronSource`. The package's
GitHub repository link points here so Cloud owns its access permissions; its homepage
points to the actual source in Waitron.

Pull requests build the candidate without publishing it. Once the workflow is on
main, publish with:

```sh
gh workflow run ui-release.yml --ref main --repo waitron-io/waitron-cloud
```

Only the publish job receives package-write permission. It publishes the tested
artifact with restricted access using its temporary `GITHUB_TOKEN`. GitHub creates
new packages as private. Check the package visibility and Cloud's installation before
calling the release complete. An existing version cannot be overwritten; choose a
new version in Waitron for subsequent releases.

## Install locally

Use pnpm 9.15.0 and authenticate GitHub CLI with package-read permission:

```sh
gh auth refresh --hostname github.com --scopes read:packages
```

A pnpm token helper can read that login without copying its token into the repository
or another credential file. Create an executable at a stable local path:

```sh
mkdir -p "$HOME/.config/waitron"
cat > "$HOME/.config/waitron/github-package-token" <<'SH'
#!/bin/sh
exec gh auth token --hostname github.com
SH
chmod 700 "$HOME/.config/waitron/github-package-token"
```

Add this entry to your **user** `~/.npmrc`, replacing the example with your absolute
home path. Keep any unrelated settings. If you already configured GitHub registry
authentication, use that configuration instead of adding a competing credential.

```ini
//npm.pkg.github.com/:tokenHelper=/Users/your-name/.config/waitron/github-package-token
```

The project registry mapping routes only `@waitron-io` packages to GitHub. Other
packages continue to use the normal npm registry. CI uses `actions/setup-node` with
`NODE_AUTH_TOKEN` supplied only to the installation step, plus package-read permission.
It does not need your personal credential.

## Verify the consumer

The next delivery step pins the released version in Cloud's manifest and lockfile
and adds a Chromium smoke test against that installed package. A local file dependency
or a workspace source alias does not prove registry installation.

References: [GitHub's npm registry](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry),
[package access](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility),
and [pnpm token helpers](https://pnpm.io/npmrc#urltokenhelper).
