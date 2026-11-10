#!/usr/bin/env python3
"""Build and select an immutable tool disk on the trusted KVM host."""
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import time

RECIPE = Path(__file__).resolve().parent
OWNER = 0


def fingerprint(debian):
    digest = hashlib.sha512(debian.encode())
    for name in ['guest-tools.sh', 'runner-tools.sh', 'image.py']:
        data = (RECIPE/name).read_bytes()
        digest.update(len(data).to_bytes(8, 'big'))
        digest.update(data)
    return digest.hexdigest()


def metadata(path, mode):
    info = path.lstat()
    kind = stat.S_ISDIR if mode == 0o755 else stat.S_ISREG
    if (not kind(info.st_mode) or info.st_uid != OWNER or
            stat.S_IMODE(info.st_mode) != mode or (mode != 0o755 and info.st_nlink != 1)):
        raise ValueError('Unsafe prebuilt image artifact')
    if mode == 0o755:
        return (info.st_dev, info.st_ino)
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def select(root, debian):
    parent = root/'images'
    if not os.path.lexists(parent):
        return None
    metadata(parent, 0o755)
    directory = parent/fingerprint(debian)
    if not os.path.lexists(directory):
        return None
    disk, checksum = directory/'tools.qcow2', directory/'sha512'
    entries = [(p, mode, metadata(p, mode)) for p, mode in
               [(parent, 0o755), (directory, 0o755), (disk, 0o444), (checksum, 0o444)]]
    expected = checksum.read_text().strip()
    if len(expected) != 128 or any(c not in '0123456789abcdef' for c in expected):
        raise ValueError('Invalid prebuilt image digest')
    with disk.open('rb') as source:
        if hashlib.file_digest(source, 'sha512').hexdigest() != expected:
            raise ValueError('Prebuilt image digest mismatch')
    return {'path': disk, 'mode': 'prebuilt', 'entries': entries}


def recheck(chosen, run):
    for path, mode, before in chosen['entries']:
        if metadata(path, mode) != before:
            raise ValueError('Selected image changed during admission')
    info = json.loads(run('qemu-img', 'info', '--output=json', str(chosen['path'])).stdout)
    if (info.get('format') != 'qcow2' or info.get('backing-filename') or info.get('data-file') or
            info.get('format-specific', {}).get('data', {}).get('data-file')):
        raise ValueError('Selected image must be self-contained qcow2')


SANITIZE = r'''set -euo pipefail
for path in /work /opt/waitron-disposable /root/.npmrc /home/runner/.npmrc \
  /opt/actions-runner/.runner /opt/actions-runner/.credentials \
  /opt/actions-runner/.credentials_rsaparams /opt/actions-runner/_work; do
  test ! -e "$path" || { echo "Builder contains task or credential files: $path" >&2; exit 1; }
done
if test -e /opt/actions-runner/_diag || test -L /opt/actions-runner/_diag; then
  test ! -L /opt/actions-runner/_diag
  test -d /opt/actions-runner/_diag
  test -z "$(find /opt/actions-runner/_diag -mindepth 1 \( ! -type f -o ! -name 'Runner_*-utc.log' -o -links +1 \) -print)" || { echo 'Unexpected builder diagnostics' >&2; exit 1; }
  cat /opt/actions-runner/_diag/Runner_*-utc.log
  rm -r /opt/actions-runner/_diag
fi
help=$(cloud-init clean --help)
for flag in --logs --seed --machine-id; do grep -q -- "$flag" <<< "$help"; done
systemctl stop docker docker.socket containerd systemd-random-seed.service
rm -rf /var/lib/docker /var/lib/containerd /tmp/disposable-tools.* /tmp/disposable-runner.* \
  /var/cache/apt/archives/* /var/lib/apt/lists/* /var/log/* /root/.ssh /home/runner/.ssh
rm -f /root/.bash_history /home/runner/.bash_history /etc/ssh/ssh_host_* /var/lib/systemd/random-seed
cloud-init clean --logs --seed --machine-id
truncate -s 0 /etc/machine-id
if ! test -L /var/lib/dbus/machine-id; then truncate -s 0 /var/lib/dbus/machine-id; fi
test ! -s /etc/machine-id
test ! -s /var/lib/dbus/machine-id
test ! -e /root/.ssh
test ! -e /home/runner/.ssh
test -z "$(find /etc/ssh -name 'ssh_host_*' -print)"
test -z "$(find /var/lib/cloud -type f -print)"
test ! -e /var/lib/systemd/random-seed
test ! -e /var/lib/docker
test ! -e /var/lib/containerd
systemctl --no-block poweroff
'''


def build(resource):
    import host
    import session
    host.resource_id(resource)
    existing = select(host.ROOT, host.IMAGE_SHA512)
    if existing:
        with host.locked():
            recheck(existing, host.run)
        return {'mode': 'prebuilt', 'image': str(existing['path'])}
    deadline = int(time.time()*1000)+1200000
    request = None
    allocated = False
    with tempfile.TemporaryDirectory(prefix='disposable-builder-') as temporary:
        directory = Path(temporary)/resource
        directory.mkdir(mode=0o700)
        session.command(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(directory/'key')], deadline)
        request = {'resourceId': resource, 'deadline': deadline,
                   'sshPublicKey': ' '.join((directory/'key.pub').read_text().split()[:2])}
        try:
            host._create(request, fresh=True)
            allocated = True
            ssh = session.wait_for_guest(directory, deadline)
            for name, seconds in [('guest-tools.sh', 360), ('runner-tools.sh', 180)]:
                with (RECIPE/name).open('rb') as source:
                    session.command([*ssh, 'bash -s'], min(deadline, int(time.time()*1000)+seconds*1000), stdin=source)
            for name in ['guest-tools.sh', 'runner-tools.sh']:
                print(f'Checking {name} offline', file=sys.stderr, flush=True)
                with (RECIPE/name).open('rb') as source:
                    session.command([*ssh, 'bash -s -- --check'], deadline, stdin=source)
            session.command([*ssh, SANITIZE], deadline)
            while not host.service_state(resource)['absent']:
                if int(time.time()*1000) >= deadline:
                    raise TimeoutError('Builder did not shut down before its deadline')
                time.sleep(0.25)
            parent = host.ROOT/'images'
            host.directory(parent, 0o755)
            parent.chmod(0o755)
            with tempfile.TemporaryDirectory(prefix='.building-', dir=parent) as staging:
                staging = Path(staging)
                disk = staging/'tools.qcow2'
                host.run('qemu-img', 'convert', '-O', 'qcow2', str(host.ROOT/'turns'/resource/'disk.qcow2'),
                         str(disk), timeout=max(1, (deadline-int(time.time()*1000))//1000))
                with disk.open('rb') as source:
                    digest = hashlib.file_digest(source, 'sha512').hexdigest()
                    os.fsync(source.fileno())
                (staging/'sha512').write_text(digest+'\n')
                disk.chmod(0o444)
                (staging/'sha512').chmod(0o444)
                staging.chmod(0o755)
                destination = parent/fingerprint(host.IMAGE_SHA512)
                with host.locked():
                    if not os.path.lexists(destination):
                        os.rename(staging, destination)
                # TemporaryDirectory only removes the unpublished staging name.
            chosen = select(host.ROOT, host.IMAGE_SHA512)
            with host.locked():
                recheck(chosen, host.run)
            return {'mode': 'prebuilt', 'image': str(chosen['path'])}
        finally:
            active = host.active_path(resource)
            if allocated or (active.is_file() and json.loads(active.read_text()) == request):
                try:
                    cleaned = host.destroy(resource)
                finally:
                    observed = host.observation(resource)
                if not cleaned['absent'] or not observed['absent']:
                    raise ValueError('Builder cleanup is incomplete')


if __name__ == '__main__':
    import subprocess
    try:
        if len(sys.argv) != 3 or sys.argv[1] != 'build':
            raise ValueError('Usage: image.py build <resourceId>')
        print(json.dumps(build(sys.argv[2])))
    except BlockingIOError as error:
        print(str(error), file=sys.stderr)
        sys.exit(75)
    except (ValueError, OSError, TimeoutError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
