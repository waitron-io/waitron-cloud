# Prepare the disposable test host

The slot manager needs KVM and QEMU before it can start an isolated machine. Run this recipe only on the dedicated Debian 13 x86 host whose SSH fingerprint you have independently verified. The installer checks the operating system, root access and KVM before changing packages.

Every Mac connection to this host must use `ssh.sh`, including the controller. It shares one SSH connection across commands, keeps strict host-key verification and stores its socket in your private `~/.cache/wt-ssh` directory. Fresh connection bursts trigger the home gateway's intrusion protection. Keep the canonical host address consistent across lanes; a different alias creates a different socket. Do not move SSH to another port.

```sh
bash deploy/disposable-tests/ssh.sh YOUR_VERIFIED_HOST 'true'
bash deploy/disposable-tests/ssh.sh --check YOUR_VERIFIED_HOST
```

The second command reports the existing master process. Repeated commands must report the same process. The controller owns that process; a lane must not close a connection another process started. The watcher’s 6 November 18:23 instruction authorizes deliberate manual Cloud jobs while the remaining recovery drills proceed. Automatic lane routing and GitHub runners remain closed.

From the copied repository recipe on that host, inspect the pinned package set, then install it:

```sh
bash deploy/disposable-tests/bootstrap-host.sh --plan deploy/disposable-tests/host-packages.txt
bash deploy/disposable-tests/bootstrap-host.sh --install deploy/disposable-tests/host-packages.txt
```

The installer requires the four named versions and verifies them after installation. It preserves an existing service-start policy, or suppresses package service starts temporarily and removes only the policy file it created. It does not configure VM networking or start a guest. The package file pins the direct host prerequisites. `guest-tools.sh` pins Node, pnpm, Docker, its command-line client, Compose and Git inside each fresh guest, and records every installed Debian package. Transitive package resolution still uses Debian’s signed current indexes; a completely frozen guest package inventory remains open.

If a version leaves your package mirror, stop and review a replacement pin. `--metadata` refreshes the host's signed package indexes and prints current candidates; it never rewrites the committed pins. Do not substitute candidates silently.

Copy `harden-ssh.sh` and `ssh-policy.conf` beside the host recipe and run the former through the shared connection. It disables password and keyboard-interactive authentication, permits root only with a public key, validates the effective policy and reloads SSH while preserving existing sessions. It refuses an unrelated existing drop-in and removes only its own new file if validation fails. Prove a fresh key login after applying it. Keep Hetzner Robot's rescue system as the supported recovery path; do not enable passwords or add an alternate port to bypass a network problem. Read authentication logs for your controller's source address so internet password attempts do not obscure its evidence.

The controller's `LocalLeases` ledger lives in a private directory on the Mac. Each reservation records its lane, turn, source digest, command, host/slot generation and deadline. An occupied or uncertain slot stays unavailable until the host adapter observes all its recorded resources absent. Expiry alone cannot free it. A ledger lock left by controller death closes admission until recovery reconciles it; automatic recovery is still to be implemented.

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

To run the complete private command-path proof, first prepare the snapshot and reviewed package bytes on your Mac. Copy the trusted host recipe separately, including `session.py`, `operations.py`, `host.py`, `guest-tools.sh`, `guest-exec.py` and the trusted `snapshot.py`. The recipe path must be an explicit directory under `/opt/waitron-disposable-`; candidate source never supplies host programs.

```sh
node scripts/disposable-tests/local-runtime.proof.mjs YOUR_VERIFIED_HOST \
  /opt/waitron-disposable-REVIEWED_RECIPE /tmp/cloud-source.tar \
  /tmp/cloud-private-packages/ui-core-0.1.0.tgz /tmp/cloud-proof-ledger
```

This opt-in proof runs 43 real PostgreSQL checks and deliberately returns exit 3. The controller reserves and starts a durable lease, constructs a bounded bundle, transfers it over the shared connection, prepares a fresh guest and preserves that status only after destruction and an independent absence readback. A duplicate request returns 75; a failed destruction or mismatched receipt quarantines the slot. The host checks the exact request and source digest and, when supplied, the private package integrity. It never extracts candidate source onto the host. The root entry point imports only the named owning tests, never this runtime proof.

Stopping your SSH client does not prove that its remote command stopped. Each host stage therefore runs in a systemd service named for its unique resource generation. Destruction first records that the generation is closed, stops its timers and entire operation service, and checks absence before removing the guest. A delayed stage cannot reopen that generation. Kernel-held locks serialize host changes and release automatically when their owner dies; the persistent `operation.lock` file is not itself a live lock. Durable active records still require verified cleanup before reuse.

The server installs a two-minute transfer watchdog before reading input. After validating the complete bundle, it installs the absolute turn-deadline watchdog before stopping the transfer watchdog, so interruption cannot leave a gap between them. Destruction runs independently of the SSH channel with a 115-second service limit and a five-second termination grace. An unfinished cleanup still quarantines the Mac lease. These transient watchdogs do not survive a host reboot; startup reconciliation remains required before activation.

Run the opt-in Mac cancellation proof with the same source and package inputs as the PostgreSQL proof:

```sh
node scripts/disposable-tests/cancellation-runtime.proof.mjs YOUR_VERIFIED_HOST \
  /opt/waitron-disposable-REVIEWED_RECIPE /tmp/cloud-source.tar \
  /tmp/cloud-private-packages/ui-core-0.1.0.tgz /tmp/cloud-cancel-ledger
```

The proof waits for an actual guest command to start, cancels its SSH channel and requires status 143, a free ledger slot and an independent absence readback. A shared SSH master can retain output pipes after its client exits; failed transport closes its own handles so cleanup can use a fresh channel without stopping that master. Dedicated-host tests also cancel during transfer and package installation and verify autonomous cleanup of an abandoned transfer at its deadline.

Controller-death recovery with a running guest, automatic Mac/host startup reconciliation, actual reboot, active-guest deadline, failed-boot and small throwaway-filesystem disk-full drills remain open, as does the frozen transitive package inventory. The provisional helper below is for deliberate manual Cloud work. Automatic routing and GitHub runners remain closed.


For one manual Cloud job, use the shared helper from the Mac. It runs frozen controller bytes, verifies the checkout belongs to Cloud, then snapshots that checkout into a fresh guest:

```sh
~/waitron-campaign-shared/disposable-test-run.sh I "$PWD" \
  node scripts/test-postgres.mjs exec pnpm --dir packages/registration exec \
  node --test test/monitoring.test.ts
```

You receive the command’s verified exit status after independent cleanup verification. The guest completes ten seconds before the fixed host deadline so its result can be read back. The new `execute-v2` operation rejects old execution clients; a root-owned result record, checked through a separate read, distinguishes command status from SSH or supervisor failure. A second lane gets 75 immediately, before source copying or package downloads. The helper prints its manual mode, host generation and source digest. Combined guest stdout/stderr is limited to 64 MiB per stage to bound logs on the shared Mac; exceeding it fails the command and runs normal cleanup. It accepts literal arguments; keep shell interpretation explicit inside your guest command when you need it. The Mac downloads only reviewed private package bytes; its package token stays on the Mac.

This first helper has one slot and no automatic crash or reboot recovery. A dead Mac owner leaves its manual lock closed; a failed or uncertain destruction leaves the recorded lease occupied. Do not erase a lock or free a lease because it is old. Read the exact resource from the private ledger, use the trusted host recipe to destroy and independently inspect it, then reconcile that same lease before reopening admission. Startup reconciliation, active-guest deadline/reboot/failed-boot/disk-full drills and frozen transitive packages remain on D592. Current guest tools have direct version pins but still resolve transitives from current signed Debian indexes. This manual release makes no measured capacity or unattended-service claim.


For an occupied or quarantined slot, read the exact resource ID from the ledger path printed by the installed configuration. Recover it explicitly:

```sh
~/waitron-campaign-shared/disposable-test-run.sh --recover RESOURCE_ID
```

Recovery skips the normal health check because an active guest is exactly what it must destroy. It takes a separate recovery guard, refuses a live or unknown ordinary owner, destroys and independently inspects only the recorded resource, then releases that same lease. A quarantined lease without an ordinary gate is also supported. Only a PID lookup returning `ESRCH` proves an owner dead; a reused or inaccessible PID keeps admission closed. Normal failure removes its own recovery guard and retains the ordinary gate and lease for a retry. If recovery itself dies, its guard stays closed too.

If recovery reports a locked or unreadable ledger, keep admission closed. Read `manual.lock/owner.json`, `recovery.lock/owner.json` when present, and `ledger/state.json` under the private state directory named by the immutable configuration. Check the recorded PID with `ps -p PID -o pid,ppid,command`. A live or inaccessible process prevents repair. An ownerless legacy gate or ledger lock cannot be cleared on age: require the creator’s recorded process proof and independently inspect its exact host resource first. The manual command deliberately refuses an unknown ledger instead of inventing an empty slot. Automatic crash/startup repair remains later D592 work.

Only source receipt allows up to five seconds of incoming clock skew. It uses one host timestamp, clamps the deadline to at most 55 minutes, and atomically persists that strict value before arming the turn timer. Preparation, execution, the VM and guest retain strict deadlines. Transfer acknowledgment is small even for a maximum-size argument request. SIGTERM, SIGINT and SIGHUP all report 143; a closed terminal output pipe cannot abort cleanup.
