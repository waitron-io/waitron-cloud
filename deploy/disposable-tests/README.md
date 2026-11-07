# Prepare the disposable test host

The slot manager needs KVM and QEMU before it can start an isolated machine. Run this recipe only on the dedicated Debian 13 x86 host whose SSH fingerprint you have independently verified. The installer checks the operating system, root access and KVM before changing packages.

Every Mac connection to this host must use `ssh.sh`, including the controller. It shares one SSH connection across commands, keeps strict host-key verification and stores its socket in your private `~/.cache/wt-ssh` directory. Fresh connection bursts trigger the home gateway's intrusion protection. Keep the canonical host address consistent across lanes; a different alias creates a different socket. Do not move SSH to another port.

```sh
bash deploy/disposable-tests/ssh.sh YOUR_VERIFIED_HOST 'true'
bash deploy/disposable-tests/ssh.sh --check YOUR_VERIFIED_HOST
```

The second command reports the existing master process. Repeated commands must report the same process. The controller owns that process; a lane must not close a connection another process started. The watcher authorizes deliberate manual Cloud jobs on the owner’s private bridge. Its coupled startup/recovery installation and fresh post-restart job are [qualified](https://github.com/waitron-io/waitron-cloud/pull/1061#issuecomment-6706129609). Automatic lane routing and GitHub runners remain closed.

From the copied repository recipe on that host, inspect the pinned package set, then install it:

```sh
bash deploy/disposable-tests/bootstrap-host.sh --plan deploy/disposable-tests/host-packages.txt
bash deploy/disposable-tests/bootstrap-host.sh --install deploy/disposable-tests/host-packages.txt
```

The installer requires the four named versions and verifies them after installation. It preserves an existing service-start policy, or suppresses package service starts temporarily and removes only the policy file it created. It does not configure VM networking or start a guest. The package file pins the direct host prerequisites. `guest-tools.sh` pins Node, pnpm, Docker, its command-line client, Compose and Git inside each fresh guest, and records every installed Debian package. Transitive package resolution still uses Debian’s signed current indexes; a completely frozen guest package inventory remains open.

If a version leaves your package mirror, stop and review a replacement pin. `--metadata` refreshes the host's signed package indexes and prints current candidates; it never rewrites the committed pins. Do not substitute candidates silently.

Copy `harden-ssh.sh` and `ssh-policy.conf` beside the host recipe and run the former through the shared connection. It disables password and keyboard-interactive authentication, permits root only with a public key, validates the effective policy and reloads SSH while preserving existing sessions. It refuses an unrelated existing drop-in and removes only its own new file if validation fails. Prove a fresh key login after applying it. Keep Hetzner Robot's rescue system as the supported recovery path; do not enable passwords or add an alternate port to bypass a network problem. Read authentication logs for your controller's source address so internet password attempts do not obscure its evidence.

The controller's `LocalLeases` ledger lives in a private directory on the Mac. Each reservation records its lane, turn, source digest, command, host/slot generation and deadline. An occupied or uncertain slot stays unavailable until the host adapter observes all its recorded resources absent. Expiry alone cannot free it. The Mac controller holds one operating-system lock across each turn. A foreground call refuses an occupied ledger; background `--once` recovery destroys and independently inspects its exact resource before freeing the slot. Legacy gates cause refusal and remain untouched. Run `node --test scripts/ci-disposable-local.test.mjs` for the controller checks.

Run the ownership and prerequisite planning checks locally:

```sh
node --test scripts/ci-disposable-local.test.mjs
```

Before sending source to a guest, create an archive outside your checkout:

```sh
python3 scripts/disposable-tests/snapshot.py create "$PWD" /tmp/cloud-source.tar
```

The command prints the archive's SHA256 digest and source file count. It includes Git-tracked files and their live edits. Stage new source files before invoking the helper; untracked paths never enter a guest, even if candidate ignore rules change. Fixed exclusions also omit recognized credential/state paths, environment files and dependencies. The helper does not discover arbitrary secrets embedded in tracked source. It refuses links and reads each path through directory handles that cannot follow links. Python bytecode and cache directories are excluded because the guest must execute the copied source. Inspect a refused path before retrying. Static `.pem` and `.key` fixtures are also excluded conservatively; a test needing one is unsupported until its credential boundary has been reviewed.

Copy the trusted extractor separately from candidate source. In the guest, verify that digest before extracting into an empty directory:

```sh
python3 /opt/waitron-disposable/snapshot.py extract /tmp/cloud-source.tar SHA256 /work/source
```

All archive members are checked before extraction. A changed digest, escaping path, link, duplicate or file/directory conflict refuses the archive. Nothing is extracted on the host.

The host adapter pins Debian's `20261103-2651` generic-cloud image by SHA512, gives each guest a fresh 64 GiB overlay and runs QEMU as a dedicated nonlogin user. It exposes only loopback management, rejects guest traffic to host/private addresses and disables external IPv6. Its only firewall hook is an OUTPUT chain limited to that guest user. The guest keeps its own internal networks. An explicit VGA device with the display disabled supplies the graphics interface required by the image's bootloader. Guest serial output uses a 16 KiB memory ring rather than an unbounded host file.

The explicit runtime proof starts two fresh guests, checks real exit status 3 and public internet access, refuses host/metadata addresses, destroys each guest and verifies that the successor has none of its predecessor's files. It is an opt-in dedicated-host test, never part of ordinary CI:

```sh
bash deploy/disposable-tests/ssh.sh YOUR_VERIFIED_HOST \
  python3 - /opt/waitron-disposable-bootstrap-20261106/host.py \
  < deploy/disposable-tests/host-runtime.test.py
```

Prepare the reviewed private UI package on the Mac before copying source. The adapter downloads only its reviewed release, verifies its full SHA512 and refuses candidate-selected authenticated URLs:

```sh
python3 scripts/disposable-tests/private-packages.py fetch /tmp/cloud-private-packages
```

The package token stays in the Mac process. GitHub's signed blob redirect receives no authentication headers. Copy only the verified package bytes to the guest, seed its private pnpm store with `pnpm store add`, and retain that store through `npm_config_store_dir` for nested installs. Public dependencies download inside the guest; a second independent checkout installs offline from its own guest store. The opt-in `guest-tools.test.py` proof exercises both installs, the real PostgreSQL checks, command exit 3 and final VM absence.

`guest-exec.py` binds its entry point to the guest's exact resource ID, executes an argument list in `/work/source`, preserves the command status and enforces an absolute deadline. Cancellation stops the owned process group with a two-second grace before forced termination. The server's independent VM deadline remains necessary if the controller disappears.

To run the complete private command-path proof, first prepare the snapshot and reviewed package bytes on your Mac. Copy the trusted host recipe separately, including `session.py`, `operations.py`, `host.py`, `startup.py`, `waitron-disposable-startup.service.in`, `guest-tools.sh`, `runner-tools.sh`, `guest-exec.py` and the trusted `snapshot.py`. The recipe path must be an explicit directory under `/opt/waitron-disposable-`; candidate source never supplies host programs. Install and run the startup service described below before using this recipe.

```sh
node scripts/disposable-tests/local-runtime.proof.mjs YOUR_VERIFIED_HOST \
  /opt/waitron-disposable-REVIEWED_RECIPE /tmp/cloud-source.tar \
  /tmp/cloud-private-packages/ui-core-0.1.0.tgz /tmp/cloud-proof-ledger
```

This opt-in proof runs 43 real PostgreSQL checks and deliberately returns exit 3. The controller reserves and starts a durable lease, constructs a bounded bundle, transfers it over the shared connection, prepares a fresh guest and preserves that status only after destruction and an independent absence readback. A duplicate request returns 75; a failed destruction or mismatched receipt quarantines the slot. The host checks the exact request and source digest and, when supplied, the private package integrity. It never extracts candidate source onto the host. The root entry point imports only the named owning tests, never this runtime proof.

Stopping your SSH client does not prove that its remote command stopped. Each host stage therefore runs in a systemd service named for its unique resource generation. Destruction first records that the generation is closed, stops its timers and entire operation service, and checks absence before removing the guest. A delayed stage cannot reopen that generation. Kernel-held locks serialize host changes and release automatically when their owner dies; the persistent `operation.lock` file is not itself a live lock. Durable active records still require verified cleanup before reuse.

The server installs a two-minute transfer watchdog before reading input. After validating the complete bundle, it installs the absolute turn-deadline watchdog before stopping the transfer watchdog, so interruption cannot leave a gap between them. Destruction runs independently of the SSH channel with a 115-second service limit and a five-second termination grace. An unfinished cleanup still quarantines the Mac lease. These transient watchdogs do not survive a host reboot; the startup service removes interrupted work before the new recipe accepts a turn.

## Reconcile after a server boot

A reboot removes the transient timers, so their absence cannot prove that an interrupted turn is clean. `startup.py` inventories the host's recorded active turn, VM disks, transfer directories and operation records. It destroys the active turn first, then unfinished recorded generations, using the existing exact-resource cleanup and an independent inspection. Completed operation fences remain on disk to refuse delayed work; a single systemd inventory lets startup skip those with no remaining owned unit, control directory, disk or active record. It never resumes a candidate command. Unknown inventory entries, links, failed cleanup or an uncertain observation keep admission closed. The portable checks run through `node --test scripts/disposable-tests/session.test.mjs`.

The readiness record names the current Linux boot ID. The new session entry point refuses transfers, preparation and execution until that record qualifies; health also reports unavailable. Inspection, result readback and cleanup remain available. Restarting the service during the same boot preserves live work because the existing readiness record already qualifies. The Mac also has to reconcile its recorded lease after a server reboot. The controller below implements that path. The linked bridge qualification covers automatic startup and a fresh job after an idle reboot; interruption of an active guest by a real reboot remains unqualified.

Install the service from a frozen, root-owned recipe directory. During the coupled cutover below, hold the frozen helper's manual gate and verify that its ledger has no occupied lease while installing or replacing this service. That prevents the old manual recipe from starting work while its replacement inventories the host. Render the template with that recipe's absolute path, then verify it before enabling it:

```sh
sed 's|@RECIPE@|/opt/waitron-disposable-REVIEWED_RECIPE|g' \
  /opt/waitron-disposable-REVIEWED_RECIPE/waitron-disposable-startup.service.in \
  > /etc/systemd/system/waitron-disposable-startup.service
systemd-analyze verify /etc/systemd/system/waitron-disposable-startup.service
systemctl daemon-reload
systemctl enable --now waitron-disposable-startup.service
systemctl status waitron-disposable-startup.service
```

Use the same recipe in the coupled immutable Mac configuration before reopening the helper. The service tries at boot, with a 120-second limit per attempt. Failures retry after 30 seconds, so a temporary held lock or unavailable prerequisite can recover without a person restarting it. A failure is visible in `systemctl status` and keeps the new session entry point unavailable until a complete attempt succeeds; it does not delay or restart SSH, Docker or gateway services. The host's SSH key stays on disk and normal fingerprint verification still applies. For a new host, qualify an actual reboot during a watcher-coordinated window.

Run the opt-in Mac cancellation proof with the same source and package inputs as the PostgreSQL proof:

```sh
node scripts/disposable-tests/cancellation-runtime.proof.mjs YOUR_VERIFIED_HOST \
  /opt/waitron-disposable-REVIEWED_RECIPE /tmp/cloud-source.tar \
  /tmp/cloud-private-packages/ui-core-0.1.0.tgz /tmp/cloud-cancel-ledger
```

Use a new absent private ledger path for each opt-in proof. Explicit bootstrap refuses a directory left by an earlier proof so it cannot forget an old lease.

The proof waits for an actual guest command to start, cancels its SSH channel and requires status 143, a free ledger slot and an independent absence readback. A shared SSH master can retain output pipes after its client exits; failed transport closes its own handles so cleanup can use a fresh channel without stopping that master. Dedicated-host tests also cancel during transfer and package installation and verify autonomous cleanup of an abandoned transfer at its deadline.

The installed helper uses matching immutable controller, configuration and host recipe. Frozen transitive guest packages, measured multiple-slot capacity, automatic routing and GitHub runners remain open.


For one manual Cloud job, use the shared helper from the Mac. It runs frozen controller bytes, verifies the checkout belongs to Cloud, then snapshots that checkout into a fresh guest:

```sh
~/waitron-campaign-shared/disposable-test-run.sh I "$PWD" \
  node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec \
  node --test test/monitoring.test.ts
```

You receive the command’s verified exit status after independent cleanup verification. The guest completes ten seconds before the fixed host deadline so its result can be read back. The new `execute-v2` operation rejects old execution clients; a root-owned result record, checked through a separate read, distinguishes command status from SSH or supervisor failure. A second lane gets 75 immediately, before source copying or package downloads. The helper prints its manual mode, host generation and source digest. Combined guest stdout/stderr is limited to 64 MiB per stage to bound logs on the shared Mac; exceeding it fails the command and runs normal cleanup. It accepts literal arguments; keep shell interpretation explicit inside your guest command when you need it. The Mac downloads only reviewed private package bytes; its package token stays on the Mac.

The published helper has one slot, automatic host startup and background Mac recovery. Do not erase a gate or free a lease because it is old. Retired releases stay gated; never invoke their old recovery commands directly. The current entry point does not accept `--recover RESOURCE_ID`; background `--once` uses only the recorded resource. Current guest tools have direct version pins but still resolve transitives from signed Debian indexes. Multiple-slot capacity remains unmeasured.

Only source receipt allows up to five seconds of incoming clock skew. It uses one host timestamp, clamps the deadline to at most 55 minutes, and atomically persists that strict value before arming the turn timer. Preparation, execution, the VM and guest retain strict deadlines. SIGTERM, SIGINT and SIGHUP report 143 during a handled cancellation; a closed terminal pipe cannot abort cleanup.

## Recover interrupted Mac turns automatically

A killed controller can leave its guest and durable reservation behind. The controller uses one kernel lock, an operating-system lock released when Node dies, to exclude a live owner. It retains the durable ledger because an unlocked controller does not prove that its guest is absent. Python replaces itself with Node after removing the four Node/Python injection variables and normalizing the working directory; Node opens and holds the lock itself. Its isolated flock helper uses `/usr/bin/python3`, so a different `python3` on PATH cannot substitute for the lock. Direct `manual.mjs` calls take that same lock. The real-process controls run with `node --test scripts/disposable-tests/kernel-lock.test.mjs scripts/disposable-tests/manual-pipeline.test.mjs`.

Bootstrap an absent private state path once, using a reviewed immutable configuration with a new host generation:

```sh
python3 -I -B /PATH/TO/CONTROLLER/deploy/disposable-tests/mac-controller.py \
  /ABSOLUTE/PATH/TO/node /PATH/TO/IMMUTABLE/config.json --bootstrap
```

Bootstrap creates the state directory with mode 0700, its lock file with mode 0600 and a fresh ledger. An existing state path returns 125, including after an interrupted bootstrap; choose another new path instead of deleting state. Ordinary and recovery calls refuse missing state, a missing lock or a missing/damaged ledger. They never initialize an empty slot. Do not remove `mac-controller.lock`: its persistent presence is normal. Any legacy `manual.lock`, `recovery.lock` or `ledger/lock` causes 125 before cleanup, and remains untouched.

Use the same entry point with the helper's ordinary `LANE CHECKOUT -- COMMAND` arguments. A held lock or occupied slot returns 75 before packaging or host contact. The initial lock-helper, Git and first-health work share a 7.5-second abort budget plus the existing two-second forced-stop grace, inside ten seconds. A genuine Git or packaging failure remains 125; the admission clock does not reclassify later command failures. Each turn's source, bundle and process directories live under owned `STATE/tmp`. Locked entries sweep interrupted private files and owned uncommitted ledger files. An undeletable private child produces a warning and is retried later; housekeeping cannot block guest recovery or replace a verified command result. Unsafe containers still refuse work. Global temporary files remain untouched.

Background recovery runs separately:

```sh
python3 -I -B /PATH/TO/CONTROLLER/deploy/disposable-tests/mac-controller.py \
  /ABSOLUTE/PATH/TO/node /PATH/TO/IMMUTABLE/config.json --once
```

An idle slot returns zero without output or host contact, and does not rewrite an unchanged ledger. An interrupted or quarantined turn is destroyed and independently inspected by its recorded resource ID before that exact lease is freed. Recovery skips health because an active guest is precisely what it must destroy. Failed or foreign absence retains quarantine and returns 125. An unavailable SSH channel stops after its first failed request; the next agent attempt retries recovery. A busy host operation can still retry inside the existing cleanup budget. A live controller returns 75 and keeps its guest. Recovery never replays the interrupted command. Foreground calls keep returning 75 until background recovery succeeds; the next turn uses the next generation. Run `node --test scripts/ci-disposable-local.test.mjs` for these behavioral checks, including Node death while its detached child survives.

Use `com.waitron.disposable-recovery.plist.in` for a launchd agent. Render absolute executable, immutable controller/configuration, home-directory and trusted PATH placeholders as escaped XML. `@HOME@` must be the controller user's absolute home directory, which supplies its normal SSH configuration and identity. It runs at login and every 30 seconds afterward. A user agent resumes after the Mac's user session returns; it does not run before login. Checking out this repository does not install the template. The agent creates no stdout/stderr log file. Read its job's `last exit code` with:

```sh
launchctl print "gui/$(id -u)/com.waitron.disposable-recovery"
```

A last exit code of 75 is normal while a foreground turn holds the lock. For a persistent 125 or quarantined lease, compare HOME and PATH in that output with the rendered configuration, then run the explicit `--once` command to see its refusal. That command performs recovery; it is not a status-only read.

When replacing a legacy manual release with the kernel-lock controller, follow this coupled publication order:

1. Drain the frozen helper by atomically creating its private `manual.lock` directory. The frozen release checks that gate before packaging, and its old recovery command refuses an ownerless gate. If the directory already exists, keep admission closed and wait for its existing owner; do not replace or remove its gate. Read the committed ledger while the gate is held and require every slot to be free.
2. Install the matching frozen host recipe and startup service using the commands above. Verify readiness before switching the Mac configuration.
3. Write the immutable configuration with a different private state path and a new `hostGeneration`, then run `--bootstrap`. Use the same recipe in the host service and Mac configuration.
4. Switch the shared helper to the new immutable controller/configuration. Confirm that no old helper process remains. Keep the retired state gated permanently; never point the replacement at it.
5. Only then load the rendered launchd agent with explicit HOME and no log file. Qualify its real SSH identity, interrupted-turn cleanup and a fresh successor. For a newly enrolled host, coordinate its reboot with the watcher. Measured capacity and GitHub activation retain their later gates.

## Run the first CI canary

You can qualify the separate `disposable-ci-canary.yml` workflow before changing ordinary CI. Its default route is GitHub-hosted. Server routing still needs the reviewed controller and matching host recipe to be published together; checking out these files does not activate runners.

Extend the immutable version-2 configuration with `ci`: `repository`, numeric `repositoryId` and `workflowId`, `workflowPath` (`.github/workflows/disposable-ci-canary.yml`), the reviewed workflow's SHA256 as `workflowDigest`, and absolute private Mac paths `appEnv` and `appKey`. The App environment file has only `GITHUB_APP_ID` and `GITHUB_APP_INSTALLATION_ID`. Keep both files owned by the controller user with mode 0600. The App key and installation tokens stay on the Mac. The supplied App needs repository administration, Actions and Actions variables write permissions.

From the frozen controller, run one exact source commit:

```sh
python3 -I -B /PATH/TO/CONTROLLER/deploy/disposable-tests/mac-controller.py \
  /ABSOLUTE/PATH/TO/node /PATH/TO/IMMUTABLE/config.json canary I SOURCE_SHA
```

Use a full 40-character commit ID. Add `--hosted` to select the identical source on GitHub explicitly. The controller checks contributor approval and the reviewed workflow definition before dispatch, persists its invocation before the request, and reconciles a lost reply by its unique run name. A server unavailable before dispatch selects hosted. An occupied slot returns 75. A failed or interrupted server job is cancelled only after its current attempt is rechecked, then the same source is dispatched to hosted. A changed attempt refuses cancellation. A terminal failed hosted attempt is reported as a failure and retired by background recovery so you can start another invocation. GitHub's run-level cancellation cannot eliminate a concurrent manual-rerun race.

The final JSON names the actual route, run, attempt, source and tree, workflow commit and both jobs. Qualification requires successful typecheck and hosted summary jobs, the actual runner assignment and the source/tree line in the typecheck log. The server runs Debian 13 as root without a dependency cache; hosted runs Ubuntu. The runner archive is version 2.338.2 with a SHA256 pin in `runner-tools.sh`. Run `node --test scripts/disposable-tests/ci-admission.test.mjs scripts/disposable-tests/ci-runtime.test.mjs scripts/disposable-tests/ci-dispatch.test.mjs` for the portable admission and failure controls. These checks do not establish a real GitHub assignment or cold private-package install.

CI preparation sends only the public bound request. It installs the pinned runner without a source archive or Mac package download. Just-in-time registration, which creates a runner for one job, is sent through stdin into the guest listener's environment. The [pinned listener's input handling](https://github.com/actions/runner/blob/v2.338.2/src/Runner.Listener/CommandSettings.cs#L110-L140) removes that environment value; the canary's first shell step also requires it to be absent. Real job qualification is still required. Guest root and initial process environments can expose its temporary inputs until destruction. Labels route jobs; they cannot prevent another approved repository workflow from stealing a runner. Retain the accepted public-repository risk from the design.

Background `--once` destroys and independently inspects the recorded guest before removing its GitHub runner. It retains unresolved runner removal in the existing ledger, separately from capacity. A GitHub outage therefore leaves a verified empty slot available for manual work. Unknown guest absence keeps the slot closed. The orphan list is bounded at 32; new CI registrations refuse when full. A lost registration response is reconciled by the saved runner name without minting again. Keep automatic recovery configured with the same immutable App paths. When the Mac is down, queued work can wait for GitHub's 24-hour limit; no separate cancellation service exists.

Qualify one real server job and same-source hosted fallback, then move ordinary pull-request typechecking through the same path. Multiple slots, capacity measurements, ordinary routing and permanent-host migration remain open.
