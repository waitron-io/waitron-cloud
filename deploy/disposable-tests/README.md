# Prepare the disposable test host

The slot manager needs KVM and QEMU before it can start an isolated machine. Run this recipe only on the dedicated Debian 13 x86 host whose SSH fingerprint you have independently verified. The installer checks the operating system, root access and KVM before changing packages.

Every Mac connection to this host must use `ssh.sh`, including the controller. It shares one SSH connection across commands, keeps strict host-key verification and stores its socket in your private `~/.cache/wt-ssh` directory. Fresh connection bursts trigger the home gateway's intrusion protection. Keep the canonical host address consistent across lanes; a different alias creates a different socket. Do not move SSH to another port.

```sh
bash deploy/disposable-tests/ssh.sh YOUR_VERIFIED_HOST 'true'
bash deploy/disposable-tests/ssh.sh --check YOUR_VERIFIED_HOST
```

The second command reports the existing master process. Repeated commands must report the same process. The controller owns that process; a lane must not close a connection another process started. The watcher authorizes deliberate manual Cloud jobs on the owner’s private bridge. Its coupled startup/recovery installation and fresh post-restart job are [qualified](https://github.com/waitron-io/waitron-cloud/pull/1061#issuecomment-6706129609). Checking out this repository does not publish a helper or enable CI routing.

From the copied repository recipe on that host, inspect the pinned package set, then install it:

```sh
bash deploy/disposable-tests/bootstrap-host.sh --plan deploy/disposable-tests/host-packages.txt
bash deploy/disposable-tests/bootstrap-host.sh --install deploy/disposable-tests/host-packages.txt
```

The installer requires the four named versions and verifies them after installation. It preserves an existing service-start policy, or suppresses package service starts temporarily and removes only the policy file it created. It does not configure VM networking or start a guest. The package file pins the direct host prerequisites. `guest-tools.sh` pins Node, pnpm, Docker, its command-line client, Compose and Git inside each fresh guest, plus the Chromium libraries and fonts listed by [Playwright 1.64.1 for Debian 13](https://github.com/microsoft/playwright/blob/v1.64.1/packages/playwright-core/src/server/registry/nativeDeps.ts#L821-L857). DejaVu supplies the generic system font alongside those regional browser fonts. It records every installed Debian package. The job installs its own browser binary. Transitive package resolution still uses Debian’s signed current indexes; a completely frozen guest package inventory remains open.

Node, pnpm and Actions runner downloads allow up to three attempts, sharing their
existing 60-, 30- and 120-second budgets, including one-second waits. Temporary network
errors and HTTP 5xx responses can retry; HTTP 4xx and other curl failures stop immediately.
Each attempt removes partial bytes first. HTTPS-only redirects, transfer-size limits and
pinned digests still apply; an integrity failure stops before extraction and is not retried.
A final failure names the tool and numeric curl/HTTP result without raw response bodies.
Bash whole-second accounting may differ by less than a second; the existing outer stage
and session deadlines still apply. Healthy cold guests normally exercise attempt 1 only.

If a version leaves your package mirror, stop and review a replacement pin. `--metadata` refreshes the host's signed package indexes and prints current candidates; it never rewrites the committed pins. Do not substitute candidates silently.

Copy `harden-ssh.sh` and `ssh-policy.conf` beside the host recipe and run the former through the shared connection. It disables password and keyboard-interactive authentication, permits root only with a public key, validates the effective policy and reloads SSH while preserving existing sessions. It refuses an unrelated existing drop-in and removes only its own new file if validation fails. Prove a fresh key login after applying it. Keep Hetzner Robot's rescue system as the supported recovery path; do not enable passwords or add an alternate port to bypass a network problem. Read authentication logs for your controller's source address so internet password attempts do not obscure its evidence.

The controller's `LocalLeases` ledger lives in a private directory on the Mac. Each reservation records its lane, turn, source digest, command, host/slot generation and deadline. An occupied or uncertain slot stays unavailable until the host adapter observes all its recorded resources absent. Expiry alone cannot free it. The Mac controller holds an operating-system lock for each active slot through cleanup, and takes a short shared ledger lock for updates. When all slots are occupied or quarantined, a foreground call returns 75. Background `--once` skips live owners and destroys and independently inspects each unowned recorded resource before freeing its slot. Legacy gates cause refusal and remain untouched. Run `node --test scripts/ci-disposable-local.test.mjs` for the controller checks.

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

Supply the other two machines’ addresses independently of the recipe’s peer file. The explicit runtime proof starts two fresh guests, checks real exit status 3 and public internet access, refuses host/metadata addresses, destroys each guest and verifies that the successor has none of its predecessor's files. It is an opt-in dedicated-host test, never part of ordinary CI:

```sh
bash deploy/disposable-tests/ssh.sh YOUR_VERIFIED_HOST \
  python3 - /opt/waitron-disposable-bootstrap-20261106/host.py --peers PEER_ONE_IP,PEER_TWO_IP \
  < deploy/disposable-tests/host-runtime.test.py
```

Prepare the reviewed private UI and signing packages on the Mac before copying source. The adapter downloads only its reviewed releases, verifies their full SHA512 digests and refuses candidate-selected authenticated URLs:

```sh
python3 scripts/disposable-tests/private-packages.py fetch /tmp/cloud-private-packages
```

The package token stays in the Mac process. For each run, the helper reads `pnpm-lock.yaml` inside the captured source archive, downloads only the selected archives, and returns reviewed filenames: one UI release and, when present, `contract-0.2.9.tgz`. The UI archive keeps its existing `ui.tgz` name in manual uploads and host transfers; the signing archive uses `contract-0.2.9.tgz`. Old and new UI-only senders and receivers remain compatible, including historical captures. The Mac selector refuses missing UI, unknown pins and multiple versions of one package before preparation; captured files never supply an authenticated URL. The host checks `ui.tgz` against the approved UI digests and the signing archive against its own full SHA512 digest, so swapped or corrupt bytes refuse transfer. Each package remains bounded to 64 MiB; the complete bundle is bounded to 641 MiB.

GitHub's signed blob redirect receives no authentication headers. Copy only the verified package bytes to the guest, seed its private pnpm store with `pnpm store add`, and retain that store through `npm_config_store_dir` for nested installs. Public dependencies download inside the guest; a second independent checkout installs offline from its own guest store. The opt-in `guest-tools.test.py` proof stages both packages and exercises both installs, the real PostgreSQL checks, command exit 3 and final VM absence. Automatic CI retains its request-only transfer and existing job token.

Before updating the signing package, publish the matched controller and host recipe through the [existing installer](#run-the-controller-from-the-ci-server), with lane I's operator. Then run guest-tools, local-runtime and cancellation proofs against that release. A support-only capture qualifies archive seeding; use an adoption capture whose lockfile imports the contract to qualify actual frozen and offline installation before landing. Portable tests do not qualify an installed release. Never patch a frozen recipe in place.

`guest-exec.py` binds its entry point to the guest's exact resource ID, executes an argument list in `/work/source`, preserves the command status and enforces an absolute deadline. Cancellation stops the owned process group with a two-second grace before forced termination. The server's independent VM deadline remains necessary if the controller disappears.

To run the complete private command-path proof, first prepare the snapshot and reviewed package bytes on your Mac. Copy the trusted host recipe separately, including `session.py`, `operations.py`, `host.py`, `startup.py`, `waitron-disposable-startup.service.in`, `guest-tools.sh`, `runner-tools.sh`, `guest-exec.py` and the trusted `snapshot.py`. The recipe path must be an explicit directory under `/opt/waitron-disposable-`; candidate source never supplies host programs. Install and run the startup service described below before using this recipe.

```sh
node scripts/disposable-tests/local-runtime.proof.mjs YOUR_VERIFIED_HOST \
  /opt/waitron-disposable-REVIEWED_RECIPE /tmp/cloud-source.tar \
  /tmp/cloud-proof-ledger /tmp/cloud-private-packages/ui-core-0.2.1.tgz \
  /tmp/cloud-private-packages/contract-0.2.9.tgz
```

This opt-in proof runs 43 real PostgreSQL checks and deliberately returns exit 3. The controller reserves and starts a durable lease, constructs a bounded bundle, transfers it over the shared connection, prepares a fresh guest and preserves that status only after destruction and an independent absence readback. A duplicate request returns 75; a failed destruction or mismatched receipt quarantines the slot. The host checks the exact request and source digest and, when supplied, each supplied private package’s integrity. It never extracts candidate source onto the host. The root entry point imports only the named owning tests, never this runtime proof.

Stopping your SSH client does not prove that its remote command stopped. Each host stage therefore runs in a systemd service named for its unique resource generation. Destruction first records that the generation is closed, stops its timers and entire operation service, and checks absence before removing the guest. A delayed stage cannot reopen that generation. Kernel-held locks serialize host changes and release automatically when their owner dies; the persistent `operation.lock` file is not itself a live lock. Durable active records still require verified cleanup before reuse.

The server installs a two-minute transfer watchdog before reading input. After validating the complete bundle, it installs the absolute turn-deadline watchdog before stopping the transfer watchdog, so interruption cannot leave a gap between them. Destruction runs independently of the SSH channel with a 115-second service limit and a five-second termination grace. An unfinished cleanup still quarantines the Mac lease. These transient watchdogs do not survive a host reboot; the startup service removes interrupted work before the new recipe accepts a turn.

## Reconcile after a server boot

A reboot removes the transient timers, so their absence cannot prove that an interrupted turn is clean. `startup.py` inventories every slot’s recorded active turn, VM disks, transfer directories and operation records. It destroys current slot owners first, then unfinished recorded generations, using the existing exact-resource cleanup and an independent inspection. Completed operation fences remain on disk to refuse delayed work; a single systemd inventory lets startup skip those with no remaining owned unit, control directory, disk or active record. It never resumes a candidate command. Unknown inventory entries, links, failed cleanup or an uncertain observation keep admission closed. The portable checks run through `node --test scripts/disposable-tests/session.test.mjs`.

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
  /tmp/cloud-cancel-ledger /tmp/cloud-private-packages/ui-core-0.2.1.tgz \
  /tmp/cloud-private-packages/contract-0.2.9.tgz
```

Use a new absent private ledger path for each opt-in proof. Explicit bootstrap refuses a directory left by an earlier proof so it cannot forget an old lease.

The proof waits for an actual guest command to start, cancels its SSH channel and requires status 143, a free ledger slot and an independent absence readback. A shared SSH master can retain output pipes after its client exits; failed transport closes its own handles so cleanup can use a fresh channel without stopping that master. Dedicated-host tests also cancel during transfer and package installation and verify autonomous cleanup of an abandoned transfer at its deadline.

The installed helper uses matching immutable controller, configuration and host recipe. Frozen transitive guest packages and permanent-host reproduction remain open.


For one manual Cloud job, use the shared helper from the Mac. It runs frozen controller bytes, verifies the checkout belongs to Cloud, then snapshots that checkout into a fresh guest:

```sh
~/waitron-campaign-shared/disposable-test-run.sh I "$PWD" \
  node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec \
  node --test test/monitoring.test.ts
```

You receive the command’s verified exit status after independent cleanup verification. The guest completes ten seconds before the fixed host deadline so its result can be read back. The new `execute-v2` operation rejects old execution clients; a root-owned result record, checked through a separate read, distinguishes command status from SSH or supervisor failure. When every configured slot is occupied or quarantined, another call gets 75 before source copying or package downloads. An admitted command that itself exits 75 is returned once; it is never retried on another slot. The helper prints its manual mode, host generation and source digest. Combined guest stdout/stderr is limited to 64 MiB per stage to bound logs on the shared Mac; exceeding it fails the command and runs normal cleanup. It accepts literal arguments; keep shell interpretation explicit inside your guest command when you need it. The Mac downloads only reviewed private package bytes; its package token stays on the Mac.

The version-2 `manual-one-slot` configuration retains its original single slot, automatic host startup and background Mac recovery. To enable a reviewed pool, use `mode: "manual-slots"` and an integer `slots` from 2 through 16 in a new immutable configuration; this format limit is not measured host capacity. Do not erase a gate or free a lease because it is old. Retired releases stay gated; never invoke their old recovery commands directly. The current entry point does not accept `--recover RESOURCE_ID`; background `--once` uses only the recorded resource. Current guest tools have direct version pins but still resolve transitives from signed Debian indexes. Choose the operating count from the recorded real-job memory measurements, not the format limit.

Only source receipt allows up to five seconds of incoming clock skew. It uses one host timestamp, clamps the deadline to at most 55 minutes, and atomically persists that strict value before arming the turn timer. Preparation, execution, the VM and guest retain strict deadlines. SIGTERM, SIGINT and SIGHUP report 143 during a handled cancellation; a closed terminal pipe cannot abort cleanup.

## Recover interrupted Mac turns automatically

A killed controller can leave its guest and durable reservation behind. Each slot uses a kernel lock, an operating-system lock released when Node dies, to exclude a live owner. In a pool, the shared ledger has a separate short lock, so one job does not hold up another job’s updates. CI intent and orphan runner cleanup stay with their slot; run-level cancellation is serialized through the controller lock. It retains the durable ledger because an unlocked controller does not prove that its guest is absent. Python replaces itself with Node after removing the four Node/Python injection variables and normalizing the working directory; Node opens and holds the lock itself. Its isolated flock helper uses `/usr/bin/python3`, so a different `python3` on PATH cannot substitute for the lock. Direct `manual.mjs` calls take that same lock. The real-process controls run with `node --test scripts/disposable-tests/kernel-lock.test.mjs scripts/disposable-tests/manual-pipeline.test.mjs`.

Bootstrap an absent private state path once, using a reviewed immutable configuration with a new host generation:

```sh
python3 -I -B /PATH/TO/CONTROLLER/deploy/disposable-tests/mac-controller.py \
  /ABSOLUTE/PATH/TO/node /PATH/TO/IMMUTABLE/config.json --bootstrap
```

Bootstrap creates the state directory with mode 0700, its lock file with mode 0600 and a fresh ledger. An existing state path returns 125, including after an interrupted bootstrap; choose another new path instead of deleting state. Ordinary and recovery calls refuse missing state, a missing lock or a missing/damaged ledger. They never initialize an empty slot. Do not remove `mac-controller.lock`: its persistent presence is normal. Any legacy `manual.lock`, `recovery.lock` or `ledger/lock` causes 125 before cleanup, and remains untouched.

Use the same entry point with the helper's ordinary `LANE CHECKOUT -- COMMAND` arguments. A held lock or occupied slot returns 75 before packaging. The initial lock-helper, Git and first-health work share a 7.5-second abort budget plus the existing two-second forced-stop grace, inside ten seconds. A genuine Git or packaging failure remains 125; the admission clock does not reclassify later command failures. The one-slot profile keeps temporary files under owned `STATE/tmp`; a pool uses `STATE/slot-N/tmp`. Recovery sweeps a slot’s interrupted private files only while it owns that slot. The pool removes interrupted ledger temporary files only under the shared ledger lock, after their writer is gone. The original one-slot path also sweeps owned uncommitted ledger files. An undeletable private child produces a warning and is retried later; housekeeping cannot block guest recovery or replace a verified command result. Unsafe containers still refuse work. Global temporary files remain untouched.

The recovery agent uses the Standard launch policy. On the Mac, a six-process ledger-write probe under Background produced lock timeouts, while the same workload under Standard completed. The failure was intermittent: later Background timing probes also passed. Six independent real jobs passed under the installed Standard policy; this does not establish that every Background run fails. Keep the ledger lock and file/directory syncs intact. Run qualification through the installed launch policy with independent controller processes.

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

In the one-slot profile, a last exit code of 75 is normal while a foreground turn holds its lock. Pool recovery skips live slot owners; a pending CI cleanup is reported separately and retried. An exit code of zero alone does not establish that every slot is empty; inspect `control status`. For a persistent 125 or quarantined lease, compare HOME and PATH in that output with the rendered configuration, then run the explicit `--once` command to see its refusal. That command performs recovery; it is not a status-only read.

When replacing a legacy manual release with the kernel-lock controller, follow this coupled publication order:

1. Drain the frozen helper by atomically creating its private `manual.lock` directory. The frozen release checks that gate before packaging, and its old recovery command refuses an ownerless gate. If the directory already exists, keep admission closed and wait for its existing owner; do not replace or remove its gate. Read the committed ledger while the gate is held and require every slot to be free.
2. Install the matching frozen host recipe and startup service using the commands above. Verify readiness before switching the Mac configuration.
3. Write the immutable configuration with a different private state path and a new `hostGeneration`, then run `--bootstrap`. Use the same recipe in the host service and Mac configuration.
4. Switch the shared helper to the new immutable controller/configuration. Confirm that no old helper process remains. Keep the retired state gated permanently; never point the replacement at it.
5. Only then load the rendered launchd agent with explicit HOME and no log file. Qualify its real SSH identity, interrupted-turn cleanup and a fresh successor. For a newly enrolled host, coordinate its reboot with the watcher. Measured capacity and GitHub activation retain their later gates.

## Use two CI hosts from one controller

When one machine is full, you can add a second dedicated host without changing a
job's identity. Keep one controller and one ledger. The immutable `slotHosts` list
assigns each slot to its host for transfer, execution, result reads and cleanup.
For the twelve-slot profile, assign slots 0–5 to the first host and 6–11 to the
second. Keep the existing guest sizes and host reserves; qualify six simultaneous
jobs on each machine before treating twelve slots as operating capacity.

Copy the existing configuration into a private publication manifest. Replace its
`host`, `recipe`, `state` and `hostGeneration`, set `slots` to 12, and add:

```json
{
  "slotHosts": [
    "new-ci.example.test", "new-ci.example.test", "new-ci.example.test",
    "new-ci.example.test", "new-ci.example.test", "new-ci.example.test",
    "bench-ci.example.test", "bench-ci.example.test", "bench-ci.example.test",
    "bench-ci.example.test", "bench-ci.example.test", "bench-ci.example.test"
  ]
}
```

The manifest's `configuration` holds that complete replacement configuration.
Keep its existing App credential paths and repository value. Add `source` and
`sha` for the landed checkout, absolute `node` and `python` paths,
`oldController`, `oldConfiguration`, an absent `newController` directory,
`launchAgent`, `launchLabel`, `wrapper`, and `statusAdapter` for the installed
read-only status script. Set `peerAddresses` to the explicit IPv4 addresses of
both new hosts and the retired CI host. These addresses join each guest's existing
own-host/private-address refusal; external IPv6 remains refused.

After landing, install and qualify the hosts while the old controller still serves:

```sh
node scripts/disposable-tests/publish.mjs hosts /PRIVATE/publication.json
```

This sends the committed recipe and pinned packages over the shared verified SSH
connection. The installer refuses an active allocation, verifies an existing
recipe byte for byte, refreshes package metadata before installing the recorded pins,
installs the key-only SSH policy and startup service, and
builds the pinned tool image. For changed recipes, use a fresh `/opt/waitron-disposable-…`
path. Preserve the requested benchmark results and verify
its service is stopped before you put that machine into CI. The installer does
not remove benchmark data. Run the guest isolation proof on each machine: it now
checks that machine's non-loopback IPv4 addresses and the independent peers supplied
with `--peers`, without a fixed server address in the test. IPv6 is disabled in the guest;
IPv6 refusal is not firewall evidence. The localhost:22000 check addresses the guest itself;
10.0.2.2:22000 checks the host's forwarded management port.

Then publish the replacement pool:

```sh
node scripts/disposable-tests/publish.mjs /PRIVATE/publication.json
```

Publication takes every old slot lock and the controller lock, requires recorded
jobs to be terminal, verifies guest absence and refuses pending hosted moves.
It bootstraps fresh state and a new generation, permanently gates the retired
state, and switches the launch agent and manual helper. A failed launch first drains the replacement pool, then creates
fresh rollback state for the previous controller; it never reopens retired state. Uncertain replacement absence keeps admission closed.
Keep the old host exclusively available for rollback until both host and
on-server-controller qualification finish.

Admission skips slots on an unavailable host. A stalled host probe has its own deadline, so it does not discard the healthy host’s slots. Occupied leases still count when
the host's health check refuses room for another guest. The status reader keeps
the existing pool fields and adds `hosts` and each job's `host` for a mapped pool;
an unreadable host leaves its job facts unknown while the other host still answers.
This pool-only publication keeps the controller and manual package preparation on the Mac.
Use the server publication below to move the controller.

## Run the controller from the CI server

Your Mac needs to stay awake while it controls CI. Move the sole controller and
ledger to NEW so ordinary CI continues without it. Keep manual checkout capture
and private-package authentication on the Mac; the helper uploads their prepared
bytes and NEW owns the guest allocation.

Use the same private publication manifest and add `controllerHost`, an absent
`serverRelease` such as `/opt/waitron-disposable-controller-REVIEWED_SHA`, and a fresh
`serverState` under `/var/lib/waitron-disposable-controller/states/`. Choose a new
`configuration.hostGeneration`. Keep the already qualified host recipe and mapping.
Then publish from the landed source:

```sh
node scripts/disposable-tests/publish.mjs server /PRIVATE/publication.json
```

The installer verifies the pinned Git, Python and Node runtime. It sends App bytes
through verified SSH stdin into private root-owned files outside releases, generates
NEW's own SSH key and pins the mapped hosts. Before the old pool drains, a read-only
App request, both-host SSH checks and a fresh guest proof qualify NEW. Mac recovery
then stops. NEW starts with a fresh ledger through a systemd service and timer; the Mac
agent is disabled and its old state remains closed. A refused activation drains NEW
before creating fresh Mac rollback state. Existing App credentials and pinned SSH
keys must match; staging refuses changes to those private files.

For a later release, add `oldServer` with the installed receipt's `release`,
`configuration` and `node`. The same command drains that server's ledger and installs
fresh state. A refused activation restores the previous code under a fresh release,
state and generation. Keep the installed receipt for the next publication.

The manual helper still verifies your local checkout. A confirmed full remote pool refuses before capture; unknown status leaves admission
to NEW. Upload reception holds no slot;
admission starts after reception and rechecks capacity. Its counted upload lets a
command finish while stdin stays open; observed EOF or a signal cancels the turn
and retains independent guest cleanup. A sleeping Mac leaves the guest's existing
55-minute command bound in force. The status adapter streams the canonical reader
over the shared SSH connection. An unreachable controller reports unknown capacity.
Qualify real CI, restart and Mac-sleep behavior on the installed service before
retiring the previous CI host's startup service.

## Build the shared tool disk

To avoid installing the same pinned tools on every guest, build a reusable disk from the
reviewed, frozen host recipe after `host.py prepare-image`:

```sh
python3 -B /opt/REVIEWED_RECIPE/image.py build "dt-tools-0-$(date +%s)"
```

Choose a free slot in the resource ID. The existing slot and capacity checks refuse an occupied
slot with status 75; the build never stops another guest. It installs both trusted tool scripts
in a fresh verified Debian guest, checks their exact versions without downloads, removes the
builder's machine identity, keys, caches and daemon state, then shuts it down and publishes a
flattened disk. Unexpected task or runner-registration files refuse publication. Builder cleanup
is checked independently after success or failure.

Manual and CI guests share this disk, including its unregistered runner tools and account.
The key includes the Debian digest and the exact bytes of both installers and `image.py`.
Run the build command again after changing any of those files. Ordinary admission never builds:
a missing or stale disk uses the existing Debian install path. A matching disk with an unsafe
owner, writable permissions, links, a bad checksum or an external backing file refuses admission.
Published disks and checksums are root-owned 0444 files in 0755 directories under
`/var/lib/waitron-disposable/images`; this command does not delete older images.

Admission hashes only its selected backing disk before taking the host allocation lock, then
rechecks that same artifact inside the lock before making a private writable overlay.
Prebuilt guests start their own Docker daemon and run the current installers with `--check`:
each direct package pin, Node, pnpm, Compose and runner version and the saved runner-binary
checksum must match offline. A mismatch fails preparation rather than reinstalling tools.
Both paths still stage the current execution program, and manual turns stage the current
snapshot program. Download retries, registration and execution checks keep their existing owners.

Run the portable image and dispatch cases with
`node --test scripts/disposable-tests/{dependencies,session,host}.test.mjs scripts/ci-plan.test.mjs`.
The opt-in host and guest proofs remain separate. Before publishing a new recipe to the pool,
check fresh successor identities and cleanup, record an ordinary job using that disk, and run
image smoke inside a prebuilt guest. A1463 inherits the existing hosted-only image-smoke
exception (watcher, 10 November 2026, 06:16): its guest run built both images and passed the
application and packaging checks before the known Bluetooth `dbus_unreachable` refusal.
Keep the complete image-smoke job on GitHub's machines; the prebuilt disk serves other server jobs.
For startup comparisons, report disk hashing separately and define cold as a fresh guest and
overlay. Shared host page-cache state is uncontrolled; never clear shared caches for a benchmark.

## Run the first CI canary

Use the separate `disposable-ci-canary.yml` workflow as a shared qualification probe. Its default route is GitHub-hosted. Server routing still needs the reviewed controller and matching host recipe to be published together; checking out these files does not activate runners.

Extend the immutable version-2 configuration with `ci`: `repository`, numeric `repositoryId` and `workflowId`, `workflowPath` (`.github/workflows/disposable-ci-canary.yml`), the reviewed workflow's SHA256 as `workflowDigest`, and absolute private Mac paths `appEnv` and `appKey`. The App environment file has only `GITHUB_APP_ID` and `GITHUB_APP_INSTALLATION_ID`. Keep both files owned by the controller user with mode 0600. The App key and installation tokens stay on the Mac. The supplied App needs repository administration, Actions and Actions variables write permissions.

From the frozen controller, run one exact source commit:

```sh
python3 -I -B /PATH/TO/CONTROLLER/deploy/disposable-tests/mac-controller.py \
  /ABSOLUTE/PATH/TO/node /PATH/TO/IMMUTABLE/config.json canary I SOURCE_SHA
```

Use a full 40-character commit ID. Add `--hosted` to select the identical source on GitHub explicitly. The controller checks contributor approval and the reviewed workflow definition before dispatch, persists its invocation before the request, and reconciles a lost reply by its unique run name. A definite API refusal retires the intent immediately. An unresolved reply retires after the existing two-minute readback budget and reports failure without redispatching or registering a runner. This does not prove no delayed GitHub run exists: a delayed server-routed run has no machine and can wait for GitHub’s 24-hour limit. A main revision race cancels only the identified owned run before retiring it. A server unavailable before dispatch selects hosted. An occupied slot returns 75. A failed or interrupted server job is cancelled only after its current attempt is rechecked, then the same source is dispatched to hosted. A changed attempt refuses cancellation. A terminal failed hosted attempt is reported as a failure and retired by background recovery so you can start another invocation. GitHub's run-level cancellation cannot eliminate a concurrent manual-rerun race.

While hosted CI or the final summary runs, the controller releases the slot lock so manual jobs can use the server. Background recovery retains a completed server assignment while it waits for the summary; it does not cancel that successful job. The final JSON names the actual route, run, attempt, source and tree, workflow commit and both jobs. Qualification requires successful typecheck and hosted summary jobs, the actual runner assignment and the source/tree line in the typecheck log.

Your CI jobs run as the ordinary `runner` user in a fresh Debian 13 guest; hosted jobs run Ubuntu. The guest account owns its home and runner tree and can use its private Docker daemon and passwordless sudo. Registration requests `/home/runner/work` as its working root to match hosted checkout paths; mixed coverage still needs an actual successful merge before qualification. Provisioning, supervision and completion recording stay privileged; local manual Cloud commands still run as root. Run `node --test scripts/disposable-tests/session.test.mjs scripts/disposable-tests/guest-exec.test.mjs` to check the listener’s launch settings and command completion.

During execution, successful run reads wait a minute before another normal read.
Successful job reads do so once our runner is assigned. Unresolved assignment, guest
inspections and failed or busy-read confirmation stay on the 15-second tick. A guest whose run is cancelled stops at its next
job check once the job reports cancellation. Completion still compares the exact
`run_attempt`, so a successful listener cannot report success for a newer attempt.
Run `node --test scripts/disposable-tests/ci-runtime.test.mjs` for cadence,
cancellation and completion controls.

To measure API traffic, read `github-request-counts` JSON events from the original
controller and worker stderr. Each CLI process emits UTC minute buckets, including
zero-request intervals, and a final partial bucket when its scoped work finishes
cleanup on success, error or handled cancellation. Unhandled signals can omit it. Sum `requests`
from all processes; tokens, admission, recovery, cleanup and the initial job-log API
read count, while the external log download does not. Requests belong to the minute
when they start; `failedFetches` belongs to the minute when fetch rejects. These are
local fetch attempts, not the whole App's consumption. `latestResponse` keeps one
local observation timestamp, status and raw resource/limit/used/remaining/reset snapshot; `kind`
distinguishes token replies from ordinary API replies, and missing headers are null.
`role` distinguishes controller recovery/pickup, worker, lane, operator and canary commands. Each minute also has
method/endpoint `categories` with requests, failed fetches, 304 (`notModified`) counts
and their own latest raw quota snapshot. Categories retain no URL, repository, job
id, body or credential. Top-level `notModified` counts all 304 replies. The App client revalidates JSON GETs
with ETags. Its cache holds at most 64 bodies and 4 MiB of encoded JSON per client; it clears
those bodies after token changes or writes. A 304 without its matching body gets one
unconditional GET; writes are never replayed. Response counts belong to their completion
minute, which can differ from the request's start minute. Compare quota observations
only within the same reset/resource and endpoint category: live job and run replies
have returned different used/reset values with the same installation token.
The snapshot is the latest reply when the line is emitted; it can be older or newer
than the request bucket. Attribute quota samples by their own `at` timestamp. Count events stay out of each
worker's 4 KiB tagged error excerpt; original stderr still carries them. Check
`pid`, `startedAt`, `from`, `to` and `final` when joining processes. Treat unreadable
or interleaved lines and missing final records as measurement gaps. Run
`node --test scripts/disposable-tests/github-app.test.mjs` for counting and scope
cleanup controls. A real busy hour remains required before enabling moves.

During an assigned job, failed GitHub network reads, request timeouts, interrupted response
bodies and HTTP 5xx replies retry while a separate inspection confirms that the owned guest
is running. A failed read skips only its dependent checks; other readable confirmations
still apply. A 403/429 with a finite retry time pauses GitHub monitor reads until then;
guest inspections and deadlines continue. Each job records its first failed read and,
if different, its first rate limit, including operation, error class, status and retry time.
Other API refusals keep the existing one-minute failure limit. Checks needing a fresh
job read wait for that read; a confirmed cancellation, changed attempt or assignment,
and a missing guest still stop execution. Genuine permission refusals still abort the
guest. This path leaves GitHub's lost-job status to its configured job timeout.
Original preparation, execution and overall turn deadlines remain in force.

The guest recipe also pins `zip`, `unzip` and `jq` for archive fixtures and shell guards. Run each newly routed family’s actual job commands in a guest before enabling its cap so missing operating-system tools fail qualification.

A worker exit of 75 without a job admission record leaves the job eligible after the 30-second polling interval, including when a publication holds the slot locks. The wait counts against starting capacity to limit repeated requests; recorded admissions still prevent replay. Run `node --test scripts/disposable-tests/ci-auto.test.mjs` to check both cases.

The runner archive is version 2.338.2 with a SHA256 pin in `runner-tools.sh`. Run `node --test scripts/disposable-tests/ci-admission.test.mjs scripts/disposable-tests/ci-runtime.test.mjs scripts/disposable-tests/ci-dispatch.test.mjs` for the portable admission and failure controls. These checks do not establish a real GitHub assignment or cold private-package install.

CI preparation sends only the public bound request. It installs the pinned runner without a source archive or Mac package download. Just-in-time registration, which creates a runner for one job, is sent through stdin into the guest listener's environment. The [pinned listener's input handling](https://github.com/actions/runner/blob/v2.338.2/src/Runner.Listener/CommandSettings.cs#L110-L140) removes that environment value; the canary's first shell step also requires it to be absent. Real job qualification is still required. Guest root and initial process environments can expose its temporary inputs until destruction. Ordinary-user execution preserves permission-test behaviour; Docker and passwordless sudo mean it is not a security boundary inside the guest. Labels route jobs; they cannot prevent another approved repository workflow from stealing a runner. Retain the accepted public-repository risk from the design.

Background `--once` destroys and independently inspects the recorded guest before removing its GitHub runner. It retains unresolved runner removal in the existing ledger, separately from capacity. A GitHub outage therefore leaves a verified empty slot available for manual work. Unknown guest absence keeps the slot closed. The orphan list is bounded at 32; new CI registrations refuse when full. A lost registration response is reconciled by the saved runner name without minting again. Keep automatic recovery configured with the same immutable App paths. When the Mac is down, queued work can wait for GitHub's 24-hour limit; no separate cancellation service exists.

The ordinary `ci.yml` typecheck can use the same slot. For the first real job, select one full commit with `DISPOSABLE_TESTS_HEAD`. Only a first-attempt pull request from this repository at that head selects the server when `DISPOSABLE_TESTS_MODE=server`. Other heads, forks, other events, full nightly rehearsals and retries select GitHub. Missing or invalid selection stays hosted; mode comparisons ignore case, as GitHub's expressions do. Its name, selection, commands, permissions and eight-minute limit stay the same. This routing still needs a real assignment and hosted retry qualification before you treat the server as available for CI. Real overlapping capacity measurements and permanent-host migration remain open.

Use the published immutable Python entry with `control status`, `control mode server --reason qualified-recovery --head APPROVED_HEAD` or `control mode hosted --reason server-unreachable`, after its Node and configuration arguments. The configuration must pin this repository's numeric IDs and the reviewed `ci.yml` digest. The App creates or updates repository variables and reads back the selected head before enabling server mode. Confirm both repository values before the first push, so organisation variables cannot supply a different inherited mode. Finish the selected job, then switch hosted; mode changes return 75 while the controller is occupied. Local manual turns remain independent of these CI variables.

To serve the first reviewed PR, pass `control run I APPROVED_HEAD RUN_ID` through that same entry, replacing the last two arguments with the full commit and numeric workflow run ID. This watches only that run's typecheck, checks the current open PR, selected head and contributor policy, and records its concrete job before registration. Waiting for the job to appear leaves the manual slot lock available. Before this command, use the existing CI source-plan reader to verify the original execution commit and check that its workflow bytes match the configured digest. The entry checks the workflow at the PR head; GitHub's execution commit can be a different merge commit. Automatic same-repository admission follows the first real job; this first-job selector does not establish that later service. The portable checks are `node --test scripts/disposable-tests/ci-ordinary.test.mjs scripts/disposable-tests/ci-entry.test.mjs`.

If the server is unavailable, the controller switches and reads back hosted mode, records its cancellation intent in the existing job record, cancels only that current attempt and requests a new attempt of the same head. It rechecks the PR head before cancellation and retry. Background recovery resumes an interrupted owned cancellation after proving guest absence; a completed job with no owned cancellation leaves its siblings running. The foreground command releases the slot lock while it checks the new attempt's actual hosted typecheck and summary, unchanged checkout and Git tree. Background recovery returns after the retry request; its cleanup success is not CI qualification. The whole workflow reruns so its planner publishes evidence for that new attempt. An API refusal or changed attempt stays visibly failed; the Mac-down queue limit still applies.

The ordinary Waitron executor accepts dashboard shards 1–4, server 1–24, heavy 1–3, till 1–7, fiscal-verifactu 1–4, venue-service 1–4, provisioning 1–6 and shared-mutation workers 1–4. It also accepts the unsharded UI, lint, root guards, bundle smoke, typecheck, setup, staffing, bookings, media, Stripe, SumUp, identity, workforce, adjustments and light-a/light-b jobs, stream tests, coverage merges, shared-mutation aggregate and image smoke. Unsharded labels end in `-1`; the original unsuffixed Cloud `typecheck` label remains supported. Admission support does not enable a workflow's route: routing, watchdog, final summary and publication remain hosted in Waitron.

The idle health check's `server-probe-1` uses the same executor and identity checks. A second shard such as `server-probe-2` is refused. An explicit hosted retry does not prove server health; automatic pickup does not request that retry. Waitron owns when the probe is dispatched and how recent server traffic is counted. Publish the matching controller and host recipe before enabling it. The normal CI entry imports `ci-server-first.test.mjs`, including this probe's admission regression.

Publish matching controller and host job-key support together. Waitron's server-first workflow no longer uses family caps; the existing pool limits simultaneous guests. Keep the measured browser profile and record the first actual server assignment for each enabled family. Run `node --test scripts/disposable-tests/ci-leases.test.mjs scripts/disposable-tests/ci-server-first.test.mjs scripts/disposable-tests/ci-auto.test.mjs scripts/disposable-tests/session.test.mjs` for name, label, shard and host-request checks. These portable checks do not establish real GitHub assignments.

Before the trusted Mac caller invokes `runCI`, pin the actual reviewed workflow definition, approve the exact source head, and read the concrete queued GitHub job. Persist its run, attempt, job ID, workflow commit and source commit in the existing CI intent. The executor refuses an ordinary job without that matching record, and rechecks numeric repository identities and the actual shard name before registration. Its unique label is `dt-REPOSITORY_ID-RUN_ID-ATTEMPT-JOB_KEY`. Use the literal logical job key plus its matrix shard in workflow routing; GitHub’s `github.job` context is available only inside steps, not when routing the job ([context reference](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#github-context)).

Recovery reads the recorded job before cancelling its run. A completed job leaves its hosted siblings running, including after the workflow moves to a newer attempt. A manual queued or running job on a dead machine can require run-level cancellation; multi-slot automatic recovery clears the intent after guest and runner cleanup without cancelling or retrying the run. One-slot manual recovery retains its cancellation checks. Multi-slot measurements also use the no-movement cleanup rule, including records without an ordinary stage. While a guest is active, an inconsistent busy-runner and unassigned-job reply gets 60 seconds to resolve while guest checks continue every 15 seconds. A confirmed different runner, unsuccessful completed job or dead guest ends execution at its next check. Attempt changes are checked when the run is next read. An API pause alone never ends an independently healthy guest. The first busy observation keeps its time through temporary API failures; a later fresh busy observation can end the guest once the 60 seconds have passed. Detection can happen after other approved code has started, so it does not remove the public-repository risk. Run `node --test scripts/disposable-tests/ci-runtime.test.mjs scripts/disposable-tests/ci-entry.test.mjs scripts/disposable-tests/ci-admission.test.mjs` for these boundaries.

For a selected multi-slot Waitron measurement, the trusted caller uses `withAvailableSlot` around each `runCI` call. Persist the concrete CI intent on the supplied scoped lease manager, and keep its slot lock through guest cleanup and runner removal. The original `control run` and shared canary entry remain one-slot rehearsals; `control status` and mode changes inspect the entire configured pool. The installed pool also supports automatic pickup, described below.

Each host slot has its own nonlogin UID `62000+slot`, loopback port `22000+slot`, egress rules and active record. Slot zero keeps `active.json`; the other slots use `active-N.json`. Each guest has 16 GiB of memory inside an 18 GiB host cap. The single-host operating profile uses six slots: six caps plus the unchanged 16 GiB host reserve need 124 GiB, below this host’s measured 124.92 GiB. Admission also reserves four complete physical CPU cores, including their siblings, and 20% of disk after guest maximum growth. The ten-slot ceiling remains an additional refusal even on a larger host; available memory can lower it. Run `python3 -B deploy/disposable-tests/capacity.test.py` and `node --test scripts/disposable-tests/host.test.mjs` for the budget and QEMU plan.

The ten-slot trial’s 10.5 GiB guests did not cover dashboard coverage memory: [a real dashboard shard](https://github.com/clintongormley/waitron/actions/runs/42425687655/job/128565949100) exhausted guest memory and the guest kernel killed Node. Keep the 16 GiB profile until a smaller guest completes the full workload, including coverage. Fewer simultaneous guests alone cannot enlarge an individual guest. Read each guest service’s `memory.peak` and `memory.events` on the host, plus guest `AnonPages`, `Shmem`, `MemAvailable`, memory pressure and OOM counters. Record host available memory and load too; guest-only monitoring misses a host kill of QEMU.

Host updates wait for their current writer. A guest stop has a 40-second command limit; initial image downloading has a 130-second command limit. The ordinary caller retains its health and stage deadlines, so a long update can temporarily report the host unavailable. Prepare the pinned image and reserved accounts with `host.py prepare-image` before opening the published helper.

## Pick up ordinary PR jobs automatically

The published pool's existing `--once` entry recovers interrupted turns, checks host health when capacity is free, then picks up queued jobs from its configured repository's `ci.yml`. Enable `DISPOSABLE_TESTS_MODE=server` and remove `DISPOSABLE_TESTS_HEAD` to route new same-repository PR jobs to the server. Switching mode to `hosted` affects new workflow routing; automatic pickup still serves jobs already carrying server labels. Manual selected-head admission still requires server mode before and after its health check. The server-first Waitron workflow also admits main pushes, schedules, manual runs and later attempts; forks and other workflow paths remain outside this controller. The workflow removes the old family caps; the six-slot operating pool enables server, heavy, till, UI and dashboard after [six actual font-fixed PR jobs passed](https://github.com/clintongormley/waitron/actions/runs/42410518785). An unhealthy or unreachable host selects hosted mode before polling jobs or creating a guest; that health refusal alone requests no cancellation or rerun. A host-health refusal leaves existing server labels on their queue; full-pool forward overflow follows the rules below. A stopped queue raises the existing health alarm for intervention. After a host outage, existing labelled jobs resume when health returns; explicitly restore server mode only for new workflow routing. Hosted mode does not pause pickup. Stop the login agent for an agreed maintenance window only after its workers finish. A retained manual head selection keeps automatic pickup closed; in hosted mode it returns quietly, and in server mode it refuses the incompatible selection. Keep the routing, watchdog, final required summary and publishing jobs on GitHub so they can still run when server assignment stops.

Pickup, due capacity reads and obsolete-PR cleanup share the pass’s complete run listing, open-PR observations and job pages, including when all slots are occupied. If either repository status list exceeds 100 runs, that pass skips cleanup and capacity publication while retaining workflow-scoped pickup. Shared capacity carries the pass’s observation time, including after a worker wait. Cancellation refreshes its own run, PR and complete jobs before acting. A closed PR or a replaced head authorises cancellation after fresh run and complete job checks. Missing run links are resolved through the open PR inventory or commit-associated PRs; unknown association defers. Assigned unfinished work receives normal cancellation; if every unfinished job has no runner, the controller force-cancels immediately. A current head's cancelled siblings do not authorise stopping the run. The cancellation path excludes main pushes and schedules. Finished or missing hosted-attempt markers are retired; pending moves retain their marker. This does not enable automatic overflow movement or retries. Run `node --test scripts/disposable-tests/ci-auto.test.mjs` for these controlled API cases; live publication evidence is separate.

Automatic pickup trusts `ci.yml` revisions from the configured repository after checking numeric repository identity, workflow ID and path, event, contributor approval, the current head for a PR, concrete job ID and routing label. It binds the actual source workflow digest into the job identity; workflow edits do not require a new configured pin (owner approval, 2026-11-08). Forks remain refused. Refused source stays queued and is logged without running it or moving its run. For routing settings and the workflow run list, an incomplete inventory, temporary HTTP refusal (408, 429 or 5xx), network failure, timeout or truncated JSON leaves current workers running and retries pickup after 30 seconds. A rate-limited 403 or 429 waits until GitHub’s supplied retry-after or reset time (at least 30 seconds); the same rule covers per-run admission reads. With no current workers, pickup returns for the next login-agent tick after any rate-limit wait. Ordinary 401/403 refusals and malformed local or routing state still fail the command. Other per-run admission failures retain the existing refusal handling. A job completed without success aborts its guest through the existing cleanup path. Each child holds one slot lock and its private temporary directory through bounded cleanup. Stopping pickup gives workers time for guest and runner removal; a forced termination leaves its existing record for recovery. An unadmitted worker remains eligible on a later pickup. A manual command takes one free slot and leaves CI enabled. Pickup fills each free slot as its worker finishes; the other workers keep their own slots. The 30-second wake-up lets the parent retry cleanup of unowned slots while live owners remain protected by their locks. Host health is checked once per pickup cycle. Workers share the controller’s run admission for at most 60 seconds; older permission and open-PR checks are repeated before admission. Each worker retains its final run/head and job identity checks before registration. Each admission forwards its original stderr and also logs at most 4 KiB of raw stderr per admission, tagged by run, attempt, job and time; JSON encoding and record metadata add bytes.

If a worker ends with the busy-runner refusal after verified guest removal, its existing turn records the refusal time. Pickup may admit that same job once more after 60 seconds, provided GitHub still reports it queued and unassigned and its previous runner has been removed. Reservation records the retry before starting another guest; another failure cannot grant a third guest. A rate-limited GET before registration can also grant that one retry after the API client’s recorded retry time, with the same guest and runner absence checks. A registration request that was sent never grants a quota retry. Other completed turns remain retired. Older turns with no recorded failure remain retired too; their branch owner must recover the workflow. This job retry does not rerun or move the workflow.

The polling path publishes `DISPOSABLE_TESTS_CAPACITY` at most once per minute per pickup process using existing inventories and variable readback. It reports observed time, healthy usable slots, occupied/manual/preparing slots and distinct server/hosted queues. Admitted jobs are not counted twice; quarantined slots and retained runners contribute no usable capacity. A failed existing free-capacity host check publishes zero slots; a full pool retains the existing ledger-only health behavior. A variable-write failure is reported without preventing a refill. Waitron compares queue pressure against its stipulated 20 hosted slots; this snapshot reserves nothing and variable delivery still needs live qualification before activation.

Automatic pickup does not read main's workflow history or use `ci.workflowHistory` or `ci.candidateWorkflowDigest` to decide trust. Existing configurations containing those fields still parse; new automatic-pickup configurations need neither. The manual canary and selected-head commands retain their configured `workflowDigest` check. Execution still enters through the fixed host command and runs inside a disposable guest; App credentials stay on the Mac. Run `node --test scripts/disposable-tests/ci-auto.test.mjs scripts/disposable-tests/ci-server-first.test.mjs scripts/disposable-tests/ci-runtime.test.mjs` for the automatic admission and executor checks.


Pickup and capacity run-list reads make up to three fresh requests when a valid count of
0–100 disagrees with the returned list length. Overflow uses the same capacity reader.
A persistent mismatch retains each caller's existing refusal and polling behavior; HTTP errors,
malformed answers and oversized counts are not reread. These local controls run through
`node --test scripts/disposable-tests/ci-auto.test.mjs`; they do not measure live retry frequency.

Attempt-job reads use 30-record pages; run and runner lists keep 100-record pages. Ordinary
job inventories retain their 100-job ceiling. Explicit manual cancellation tools retain their 1,000-job ceiling.
Changed counts, duplicate IDs and incomplete pages refuse the read before admission or cancellation.
On 9 November, [the matching Waitron correction](https://github.com/clintongormley/waitron/pull/2626)
followed repeated HTTP 502 responses for 100-record pages on 84/87-job attempts, while 30-record
pages returned data. The controller's focused tests exercise a page-three admission and a later
sibling already assigned when its page is read, which prevents manual cancellation. Keep actual
pickup evidence for the published controller; these local tests do not establish it.


A refused source or failed automatic worker does not move its run. After local pickup fills the pool, a due capacity pass can move one untouched first-attempt current-head PR run to GitHub. It requires complete inventories, fewer than twenty hosted jobs running and more waiting jobs per server slot than per hosted slot. It chooses the oldest eligible same-repository PR, excluding local invocations, leases and active workers, useful started or completed work, and workflows without hosted-marker support. Main pushes, schedules and manual runs need a hand move. The reverse move and the five-minute untaken-job rule remain unbuilt. Multi-slot recovery cleans the guest and runner, logs the run and stage, then clears its old intent. A job with a recorded turn is not replayed by pickup; if it remains queued, the existing health alarm calls for intervention once server progress has stopped. Pickup excludes both a marked successor attempt and its predecessor. The marker records intent before cancellation, not an acknowledgement: an immediate final refusal removes it, while a failed read retains it. Later ticks recheck current-head identity and local ownership, resend plain cancellation while any unfinished job has a runner, force-cancel when none does, and rerun only a terminal cancelled predecessor. A visible successor is not rerun again. Terminal and stale markers are retired; later attempts remain eligible. Explicit one-slot/manual fallback tools retain their own policy.

After an ordinary listener returns zero and its execution monitor has stopped without failure, the controller retires that job’s fallback intent before checking final completion. A delayed status for the exact assigned job gets up to five reads, two seconds apart; a different identity or a terminal failure is refused. A missing runner assignment or an API error is reported without another read. The result retains the exit code, expected identity and each completion observation. An unresolved final check reports failure without cancelling the run. Guest and runner cleanup still use the lease and orphan-runner records, including after a restart. A crash or failed write before intent retirement still takes the guest and runner cleanup path; multi-slot recovery then clears the intent without moving the run. The legacy canary shares the bounded completion reads but keeps its existing fallback policy. Run `node --test scripts/disposable-tests/ci-runtime.test.mjs` for these completion and cleanup cases.

Run `node --test scripts/disposable-tests/ci-auto.test.mjs scripts/disposable-tests/ci-entry.test.mjs` for admission, independent manual capacity and cleanup and queue-preservation checks. Their passing does not establish a real server assignment; record that actual PR run separately.

Guest startup can restart SSH after host-key discovery. Preparation retries only the read-only cloud-init readiness command after SSH status 255, within the original 120-second boot budget. A cloud-init failure remains a failure; package installation and other commands are not replayed.

| Rate-limit source | Source words | Controller rule |
| --- | --- | --- |
| [GitHub REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api), read 2026-11-08 | “you will receive a `403` or `429` response” | Distinguish rate-limit headers from an ordinary permission refusal and wait for the supplied retry/reset time. |

| [GitHub conditional requests](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests), read 2026-11-11 | “does not count against your primary rate limit if a `304` response is returned” | Correctly authorized unchanged JSON reads can preserve primary quota; retain their actual fetch and 304 counts. |


## Read CI slot status without changing it

When GitHub shows waiting jobs, first check whether the server is preparing a guest, executing work, or keeping a slot closed for cleanup. On the controller Mac, run the published command:

```sh
python3 -I -B ~/waitron-campaign-shared/disposable-ci-status.py
```

It prints one JSON line from the installed agent configuration, local ledger, existing log tails and one reused SSH connection per configured host. `slots.busy` includes preparation, pending admission and retained cleanup records. A missing or inconsistent ledger reports unknown capacity. `controller.state` can be `idle` between periodic agent runs; that alone does not mean recovery has stopped.

Times are Unix milliseconds; durations are seconds. `admissionAgeSeconds` starts when the slot was reserved. `start` and `runtimeSeconds` come from a single worker log filename in that guest, which does not establish when GitHub acknowledged the job. Manual commands instead report `executionRequested`, the command-file timestamp. Missing or ambiguous evidence stays `unknown`. `lastAdmission` is the newest lease time in the current ledger or the last 1 MiB of output containing a job result code and lease creation time. Errors keep unknown times, show the error file's last-write time separately, mask IP addresses and stop at 200 characters. Log paths come from the installed agent; the repository agent template omits them, so an installation using that template unchanged reports unknown history and errors.

The command uses the existing `~/.cache/wt-ssh/%C` connection with `ControlMaster=no`, `ControlPersist=600` and `ProxyCommand=false`. It keeps strict host-key checks and disables forwarding. An expired connection returns `host: "unknown"` instead of opening a fresh connection. Collection shares a 4.5-second budget; the command returns the local facts it obtained if the host read times out. It reads host preparation and result markers, never changes admission or recovery, and does not call GitHub.

Run its focused checks with `node --test scripts/disposable-tests/ci-status.test.mjs`.
