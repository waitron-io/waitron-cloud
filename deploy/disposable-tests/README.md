# Prepare the disposable test host

The slot manager needs KVM and QEMU before it can start an isolated machine. Run this recipe only on the dedicated Debian 13 x86 host whose SSH fingerprint you have independently verified. The installer checks the operating system, root access and KVM before changing packages.

From the copied repository recipe on that host, inspect the pinned package set, then install it:

```sh
bash deploy/disposable-tests/bootstrap-host.sh --plan deploy/disposable-tests/host-packages.txt
bash deploy/disposable-tests/bootstrap-host.sh --install deploy/disposable-tests/host-packages.txt
```

The installer requires the four named versions and verifies them after installation. It preserves an existing service-start policy, or suppresses package service starts temporarily and removes only the policy file it created. It does not configure VM networking or start a guest. The package file pins the direct prerequisites; a complete reproducible guest image remains to be built.

If a version leaves your package mirror, stop and review a replacement pin. `--metadata` refreshes the host's signed package indexes and prints current candidates; it never rewrites the committed pins. Do not substitute candidates silently.

The controller's `LocalLeases` ledger lives in a private directory on the Mac. Each reservation records its lane, turn, source digest, command, host/slot generation and deadline. An occupied or uncertain slot stays unavailable until the host adapter observes all its recorded resources absent. Expiry alone cannot free it. A ledger lock left by controller death closes admission until recovery reconciles it; automatic recovery is still to be implemented.

Run the ownership and prerequisite planning checks locally:

```sh
node --test scripts/disposable-tests/leases.test.mjs scripts/disposable-tests/bootstrap.test.mjs
```

Before sending source to a guest, create an archive outside your checkout:

```sh
python3 scripts/disposable-tests/snapshot.py create "$PWD" /tmp/cloud-source.tar
```

The command prints the archive's SHA256 digest and source file count. It includes tracked edits and untracked, unignored files, but omits Git state, environment files, credentials and dependencies. It refuses links and reads each path through directory handles that cannot follow links. Inspect a refused path before retrying. Static `.pem` and `.key` fixtures are also excluded conservatively; a test needing one is unsupported until its credential boundary has been reviewed.

Copy the trusted extractor separately from candidate source. In the guest, verify that digest before extracting into an empty directory:

```sh
python3 /opt/waitron-disposable/snapshot.py extract /tmp/cloud-source.tar SHA256 /work/source
```

All archive members are checked before extraction. A changed digest, escaping path, link, duplicate or file/directory conflict refuses the archive. Nothing is extracted on the host.

This foundation does not supply a usable test slot yet. The VM adapter, dependency access, network isolation, absolute guest deadlines, reboot reconciliation and bounded destruction must qualify before you move a lane's work here. No GitHub runner is enrolled.
