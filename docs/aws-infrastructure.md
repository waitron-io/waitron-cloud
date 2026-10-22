# Check AWS infrastructure locally

An infrastructure test can contact a provider even when you intended only to inspect a
plan. Cloud's first check refuses unsafe source files before an infrastructure command
can start. It parses HCL, OpenTofu's configuration language, inside a container with no
network connection and no host credentials or home-directory mount.

Prepare the tools once, then run the canary and source-policy checks:

```sh
node deploy/aws/check.mjs --prepare-tools
pnpm --dir deploy/aws install --ignore-workspace --frozen-lockfile
node deploy/aws/check.mjs --suite canary
node --test --test-concurrency=1 deploy/aws/*.test.mjs
```

Preparation downloads software from PyPI and the official OpenTofu and HashiCorp release
sites. The base image is fixed by its digest, an identifier for its exact contents.
The parser and both dependencies have fixed versions and verified download hashes.
OpenTofu 1.11.0 and AWS provider 6.42.0 use the archive checksums recorded in
`deploy/aws/tools-pins.json`. Preparation selects Linux ARM64 or AMD64 to match your
Docker engine and refuses other architectures. It submits only the six named software
build files to Docker, so ambient files cannot enter the build context.

On success, the command prints:

```text
Prepared software image waitron-cloud-aws-tools:1.11.0-aws6.42.0
```

The image contains an offline provider mirror, a local directory from which OpenTofu can
install the pinned provider without contacting a registry. Its configuration includes no
direct provider download method. Initializing from this mirror reports the provider as
unauthenticated: preparation checks the pinned archive checksum, but does not retrieve a
registry signature during initialization. Root lockfiles still need checksums for both
supported architectures when those roots are introduced. Test execution uses only the
existing local image and refuses an implicit image download.

OpenTofu and provider downloads require HTTPS and official distribution hosts, including redirects.
They ignore your proxy settings, check a three-minute deadline before each read, and
limit each network operation to 15 seconds. Archives are limited to 256 MiB; the selected
executable must be a single regular entry of at most 1 GiB. A checksum mismatch refuses
installation. Failed downloads remove their partial files, and preparation removes its
disposable build context after success or failure. The Docker build command has a
seven-minute limit. These limits bound software preparation; they do not set service
or infrastructure timeouts.

The source checker requires every test run, including a setup run, to say
`command = plan`. Every AWS provider and alias must select a mock, a substitute that
avoids provider requests. A test's explicit provider map can select another mocked
alias. Provisioners, external providers, real test-provider blocks, dynamic provider
bindings, alternate configuration formats, override files, variable files and symlinks
are refused. Comments, strings and heredocs are parsed as syntax, so a quoted example of
an apply command does not masquerade as an executable command.

Local modules must resolve to directories inside the inspected copy. Each child needs an
explicit provider map, including every alias it uses. The checker follows those maps
through nested modules to the test's mocks. Missing bindings, undeclared aliases and
module cycles are refused. A test run can select a different local module under the same
rules.

Only infrastructure source files enter a disposable copy. The checker excludes `.aws`, `.terraform`,
Git metadata and dependencies. The container sees that copy read-only, drops operating
system capabilities and has limited memory, CPU, process count and temporary storage.
After a timeout, cleanup checks the unique ownership label and removes only the recorded
container ID. A failed ownership check refuses cleanup and reports the problem.

The source-checking API also accepts `{ trackedOnly: true }` for your repository's
`deploy/aws` directory. This copies source files listed in Git's index, the list of
files staged for a commit, using their current working contents. Stage a new source
file before checking it; stage a deletion to remove it from the copy. Untracked and
ignored files cannot change the candidate. Conflicted files, unsupported indexed paths,
symlinks and files larger than 1 MiB are refused before a container starts. A staged
alternative input, such as a variable file, remains visible so the parser can refuse it.
The suite runner uses this boundary too. It inspects one source copy, then executes that
same copy using the exact local image identifier it checked. Later checkout edits cannot
change the files between inspection and execution. A staged provider lockfile is retained;
its provider source, version, constraints and checksum syntax must match the supported
AWS lockfile shape. Software preparation separately verifies the pinned archive bytes.

The canary checks a mocked Madrid region without declaring resources. A successful run
ends with `Success! 1 passed, 0 failed.` Each suite initializes with `-backend=false`
and `-input=false`, validates its configuration, then runs its named test file. Work happens
in a fresh temporary filesystem inside the container. OpenTofu receives a closed set of
environment settings, including the mirror configuration and empty AWS configuration and
credential paths, so ambient command flags cannot change initialization. A failed command
stops the suite. Each command has a 90-second deadline; each suite container has a
five-minute deadline and limits of 1 GiB memory, two CPUs, 128 processes and 512 MiB of
temporary storage. The source inspector has its separate smaller limits.

You can select only `canary`, `accounts`, `state`, `network`, `cell`, `database`, `storage`,
`custody`, `observability`, `ingress`, `dns` or `integration`. Each name selects fixed module
and root paths; the CLI accepts no custom command or directory. `--all` runs those suites
in order and refuses a missing test file. Only the canary is implemented so far, so
`--all` currently reports its passing test, then fails on the missing accounts suite.
It does not report the unfinished infrastructure as verified. Missing local tools produce
the `--prepare-tools` setup instruction without downloading anything.

The separate dependency install supplies Ajv, the JSON Schema validator used by the
contract tests. It leaves the application workspace dependencies unchanged. Its version
and dependency checksums are pinned in `deploy/aws/pnpm-lock.yaml`.

## Pass infrastructure references to the runtime

The runtime needs resource addresses and permission references without receiving passwords
or cluster credentials. The [infrastructure_v1 schema](../deploy/aws/contracts/infrastructure-v1.schema.json)
defines that handoff. Run `node --test deploy/aws/contracts.test.mjs` to validate independent
global and Spain fixtures and exercise refusals for unknown fields, missing references,
unknown roles and a running recovery region. These are contract checks, not resource outputs;
the resource modules and composed roots remain unfinished.

Every fixed object rejects extra fields. Reference maps accept named string references;
they reject embedded objects, such as a password object in a database secret reference.
A string alone cannot prove where a secret is held. Keep secret values outside the
handoff and supply only their references. The schema fixes the current region pairs to
Frankfurt/Ireland for global and Madrid/Paris for Spain. Global has no venue stream or
snapshot bucket. Recovery always has `runtime_enabled: false`; a valid handoff grants
no permission to activate a writer.

The [P1 role contract](../deploy/aws/contracts/p1-roles-v1.json) records the eight agreed
logical roles, matching service accounts, namespaces and ingress ports. P1 owns image
digests and runtime deployment; OpenTofu consumes no image reference. Its
[country-cell plan](superpowers/plans/2026-10-22-cloud-country-cell.md) maps migrations,
mail, usage, probes and operations to `registration-worker`, and manifest publication
to `remote-reconciler`. Translation stays disabled behind its separate production gate.
The global namespace is reserved until P3 supplies the global/country split. Agreement
on these names and ports does not qualify AWS permissions, ingress or secret delivery.

The remaining resource suites follow the
[implementation plan](superpowers/plans/2026-10-22-cloud-aws-layer.md).
Passing source-policy tests does not qualify AWS permissions, deployed infrastructure,
recovery or continuity. You still need separate approval before accessing AWS, creating
accounts or resources, spending money or applying infrastructure.
