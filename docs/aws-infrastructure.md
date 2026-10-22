# Check AWS infrastructure locally

An infrastructure test can contact a provider even when you intended only to inspect a
plan. Cloud's first check refuses unsafe source files before an infrastructure command
can start. It parses HCL, OpenTofu's configuration language, inside a container with no
network connection and no host credentials or home-directory mount.

The implementation is in progress. You can run the source-policy checks now:

```sh
docker build --pull=false --tag waitron-cloud-aws-tools:task1-parser deploy/aws
node --test --test-concurrency=1 deploy/aws/check.test.mjs
```

The build downloads software from PyPI. The base image is fixed by its digest, an
identifier for its exact contents. The parser and both dependencies have fixed versions
and verified download hashes. Test execution uses only the existing local image and
refuses an implicit image download.

The source checker requires every test run, including a setup run, to say
`command = plan`. Every AWS provider and alias must select a mock, a substitute that
avoids provider requests. A test's explicit provider map can select another mocked
alias. Provisioners, external providers, real test-provider blocks, dynamic provider
bindings, alternate configuration formats, override files, variable files and symlinks
are refused. Comments, strings and heredocs are parsed as syntax, so a quoted example of
an apply command does not masquerade as an executable command.

Only infrastructure source files enter a disposable copy. The checker excludes `.aws`, `.terraform`,
Git metadata and dependencies. The container sees that copy read-only, drops operating
system capabilities and has limited memory, CPU, process count and temporary storage.
After a timeout, cleanup checks the unique ownership label and removes only the recorded
container ID. A failed ownership check refuses cleanup and reports the problem.

This first step does not provide `--prepare-tools`, `runSuite`, OpenTofu, a provider
mirror, the canary or the infrastructure handoff schema. Local modules remain refused
until their provider mappings are checked. The rest of Task 1 in the
[implementation plan](superpowers/plans/2026-10-22-cloud-aws-layer.md) supplies those parts.
Passing source-policy tests does not qualify AWS permissions, deployed infrastructure,
recovery or continuity. You still need separate approval before accessing AWS, creating
accounts or resources, spending money or applying infrastructure.
