#!/usr/bin/env python3
"""Trusted per-turn staging. Candidate archives remain opaque on the host."""
import hashlib
import base64
import json
import os
from pathlib import Path
import shutil
import shlex
import signal
import subprocess
import sys
import tarfile
import time
import host
from host import resource_id

MAX_BUNDLE = 577 * 1024 * 1024
LIMITS = {'request.json': 65536, 'source.tar': 512 * 1024 * 1024}
PACKAGE_SHA512 = base64.b64decode('MzgeKuubpLe6LPEL1M6hZgWDuNSBeyQNVGnzw/J29UwKeZ/6nTKD8k/H1nrSMeOx95C/3f34eNYQtbMM8P+2ng==')
CONTROL = host.ROOT/'control'
RECIPE = Path(__file__).resolve().parent


def request_identity(value, resource):
    now = int(time.time()*1000)
    if not isinstance(value, dict) or set(value) != {'resourceId', 'snapshot', 'argv', 'deadline'}:
        raise ValueError('Unknown or missing turn request field')
    argv = value['argv']
    digest = value['snapshot']
    if (value['resourceId'] != resource or not isinstance(digest, str) or len(digest) != 64 or
            any(c not in '0123456789abcdef' for c in digest) or
            not isinstance(argv, list) or not 1 <= len(argv) <= 256 or
            any(not isinstance(v, str) or len(v) > 16384 or '\0' in v for v in argv) or not argv[0] or
            type(value['deadline']) is not int or not now < value['deadline'] <= now+3300000):
        raise ValueError('Invalid or expired turn request')
    return value


def receive(root, resource, stream):
    resource_id(resource)
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    if root.is_symlink() or not root.is_dir():
        raise ValueError('Unsafe transfer root')
    target = root/resource
    try:
        target.mkdir(mode=0o700)
    except FileExistsError:
        raise ValueError('This turn already has a transfer')
    try:
        bundle = target/'bundle.tar'
        size = 0
        with bundle.open('xb') as output:
            while True:
                data = stream.read(1024*1024)
                if not data:
                    break
                size += len(data)
                if size > MAX_BUNDLE:
                    raise ValueError('Turn bundle byte limit exceeded')
                output.write(data)
        seen = set()
        with tarfile.open(bundle, 'r:') as archive:
            for entry in archive:
                if (entry.name not in {*LIMITS, 'ui.tgz'} or entry.name in seen or not entry.isfile() or
                        entry.pax_headers or entry.size < 0 or entry.size > LIMITS.get(entry.name, 64*1024*1024)):
                    raise ValueError('Unknown, duplicate or unsafe transfer member')
                seen.add(entry.name)
                with archive.extractfile(entry) as source, (target/entry.name).open('xb') as output:
                    shutil.copyfileobj(source, output, length=1024*1024)
                    output.flush()
                    os.fsync(output.fileno())
        if not set(LIMITS) <= seen:
            raise ValueError('Missing transfer member')
        request = request_identity(json.loads((target/'request.json').read_text()), resource)
        with (target/'source.tar').open('rb') as source:
            if hashlib.file_digest(source, 'sha256').hexdigest() != request['snapshot']:
                raise ValueError('Snapshot digest mismatch')
        if 'ui.tgz' in seen:
            with (target/'ui.tgz').open('rb') as source:
                if hashlib.file_digest(source, 'sha512').digest() != PACKAGE_SHA512:
                    raise ValueError('Private package integrity mismatch')
        bundle.unlink()
        return request
    except (OSError, ValueError, tarfile.TarError) as error:
        shutil.rmtree(target)
        raise ValueError(str(error)) from error


def command(argv, deadline, stdin=None, capture=False, check=True):
    remaining = (deadline-int(time.time()*1000))/1000
    if remaining <= 0:
        raise TimeoutError('Absolute turn deadline exceeded')
    child = subprocess.Popen(argv, stdin=stdin or subprocess.DEVNULL,
                             stdout=subprocess.PIPE if capture else None,
                             stderr=subprocess.DEVNULL if capture else None,
                             start_new_session=True)
    try:
        output, _ = child.communicate(timeout=remaining)
        if check and child.returncode:
            raise ValueError(f'Turn stage failed with status {child.returncode}')
        return child.returncode, output
    finally:
        try:
            os.killpg(child.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            child.wait(timeout=2)
        except subprocess.TimeoutExpired:
            pass
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        child.wait()


def turn_directory(resource):
    resource_id(resource)
    directory = CONTROL/resource
    if directory.is_symlink() or not directory.is_dir() or directory.stat().st_uid != 0:
        raise ValueError('Missing or unsafe turn control directory')
    return directory


def guest_ssh(directory):
    return ['ssh', '-i', str(directory/'key'), '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes',
            '-o', 'StrictHostKeyChecking=yes', '-o', f'UserKnownHostsFile={directory}/known',
            '-o', 'ConnectTimeout=3', '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=2',
            '-p', '22000', 'root@127.0.0.1']


def prepare(resource):
    directory = turn_directory(resource)
    request = request_identity(json.loads((directory/'request.json').read_text()), resource)
    deadline = request['deadline']
    if not (directory/'ui.tgz').is_file():
        raise ValueError('Reviewed private dependency bytes are required')
    command(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(directory/'key')], deadline)
    public = ' '.join((directory/'key.pub').read_text().split()[:2])
    host.create({'resourceId': resource, 'deadline': deadline, 'sshPublicKey': public})
    boot_end = min(deadline, int(time.time()*1000)+120000)
    while int(time.time()*1000) < boot_end:
        code, output = command(['ssh-keyscan', '-T', '2', '-t', 'ed25519', '-p', '22000', '127.0.0.1'],
                               boot_end, capture=True, check=False)
        if code == 0 and output.strip():
            (directory/'known').write_bytes(output)
            break
        time.sleep(0.25)
    else:
        raise TimeoutError('Guest did not boot within120seconds')
    ssh = guest_ssh(directory)
    command([*ssh, 'cloud-init status --wait'], boot_end)
    with (RECIPE/'guest-tools.sh').open('rb') as source:
        command([*ssh, 'bash -s'], min(deadline, int(time.time()*1000)+360000), stdin=source)
    command([*ssh, 'mkdir -p /work/source /work/private /opt/waitron-disposable'], deadline)
    for source_path, target in [(RECIPE/'snapshot.py', '/opt/waitron-disposable/snapshot.py'),
                                (RECIPE/'guest-exec.py', '/opt/waitron-disposable/guest-exec.py'),
                                (directory/'source.tar', '/work/source.tar'),
                                (directory/'ui.tgz', '/work/private/ui.tgz')]:
        with source_path.open('rb') as source:
            command([*ssh, 'cat > '+shlex.quote(target)], deadline, stdin=source)
    command([*ssh, 'python3 /opt/waitron-disposable/snapshot.py extract /work/source.tar '+
             shlex.quote(request['snapshot'])+' /work/source'], deadline)
    command([*ssh, 'cd /work/source && export CI=true npm_config_store_dir=/work/pnpm-store npm_config_prefer_offline=true; '
             'pnpm store add /work/private/ui.tgz && pnpm install --frozen-lockfile'],
            min(deadline, int(time.time()*1000)+180000))
    (directory/'prepared').touch(exist_ok=False)


def execute(resource):
    directory = turn_directory(resource)
    request = request_identity(json.loads((directory/'request.json').read_text()), resource)
    if not (directory/'prepared').is_file() or not host.observation(resource)['running']:
        raise ValueError('The exact turn must be prepared and running')
    with (directory/'command.json').open('x') as output:
        json.dump({'argv': request['argv'], 'deadline': request['deadline']}, output)
    with (directory/'command.json').open('rb') as source:
        code, _ = command([*guest_ssh(directory),
                           'env CI=true npm_config_store_dir=/work/pnpm-store npm_config_prefer_offline=true '
                           'python3 /opt/waitron-disposable/guest-exec.py '+shlex.quote(resource)],
                          request['deadline'], stdin=source, check=False)
    return code if code >= 0 else 128-code


def inspect(resource):
    observed = host.observation(resource)
    observed['controlPresent'] = (CONTROL/resource).exists()
    observed['absent'] = observed['absent'] and not observed['controlPresent']
    return observed


def destroy(resource):
    observed = host.destroy(resource)
    if not observed['absent']:
        raise ValueError('Owned VM cleanup remains uncertain')
    directory = CONTROL/resource
    if directory.exists() or directory.is_symlink():
        turn_directory(resource)
        shutil.rmtree(directory)
    return inspect(resource)


def main():
    if os.geteuid() != 0 or not Path('/dev/kvm').is_char_device():
        raise ValueError('Dedicated root KVM host required')
    if len(sys.argv) == 2 and sys.argv[1] == 'health':
        print(json.dumps({'healthy': not (host.ROOT/'active.json').exists()}))
        return 0
    if len(sys.argv) != 3:
        raise ValueError('Usage: session.py transfer|prepare|execute|inspect|destroy RESOURCE')
    mode, resource = sys.argv[1:]
    resource_id(resource)
    if mode == 'transfer':
        print(json.dumps(receive(CONTROL, resource, sys.stdin.buffer)))
    elif mode == 'prepare':
        prepare(resource)
    elif mode == 'execute':
        return execute(resource)
    elif mode in ('inspect', 'destroy'):
        print(json.dumps((inspect if mode == 'inspect' else destroy)(resource)))
    else:
        raise ValueError('Unknown turn operation')
    return 0


if __name__ == '__main__':
    def interrupted(signum, frame):
        raise KeyboardInterrupt()
    for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(signum, interrupted)
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(143)
    except (TimeoutError, subprocess.TimeoutExpired) as error:
        print(str(error), file=sys.stderr)
        sys.exit(124)
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(125)
