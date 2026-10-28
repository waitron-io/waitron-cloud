# Verifier build qualification

## Verifier source isolation from local edits (D445)

Your verifier build must use the pinned committed source even when its checkout
contains local edits or private files. Run
`node --test scripts/ci-verifier-source-isolation.test.mjs` to check staged and
unstaged tracked edits, ignored credentials, untracked venue data and a locally
replaced release generator. Native temporary Git fixtures capture the build
context through a command stub, preserve local inputs and remove private build
directories. These checks do not run Docker or build an image. Keep real image
qualification in CI and leave the historical image-build timeout investigation open.

## Verifier build refusal and cleanup controls (D443)

A refused build must leave no private build directory or successful image result.
Run `node --test scripts/ci-verifier-build-refusals.test.mjs` to check missing
build inputs, invalid or unavailable source commits, release-generation failure
and a refused build command. A successful command is the control. Each case
uses a private temporary Git repository and directory; the command stub records
the build boundary without contacting Docker or building an image. The checks
also verify the pinned revision reaches the release stamp and image label.

These native controls qualify refusal and cleanup paths. They do not explain
the earlier CI image-build timeout or establish that an image builds successfully.
Keep the real image and PostgreSQL qualification in CI while local Docker is
unavailable; the existing source pins, build limits and runtime rules remain.
