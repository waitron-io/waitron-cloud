#!/usr/bin/env python3
"""Trusted per-turn staging. Candidate archives remain opaque on the host."""
import hashlib
import io
import re
import base64
import json
import os
from pathlib import Path
import shutil
import shlex
import signal
import secrets
import selectors
import subprocess
import sys
import tarfile
import time
import host
import operations
from host import resource_id

MAX_BUNDLE = 577 * 1024 * 1024
LIMITS = {'request.json': 65536, 'source.tar': 512 * 1024 * 1024}
PACKAGE_SHA512 = {base64.b64decode(value) for value in [
    'MzgeKuubpLe6LPEL1M6hZgWDuNSBeyQNVGnzw/J29UwKeZ/6nTKD8k/H1nrSMeOx95C/3f34eNYQtbMM8P+2ng==',
    'SzF5SF/NXCVkOwVIS9XLcVr1vQ6EOF14QHqqXs4QXRwG9dWdp3HBY1JTubRA8+Ygpx0z9Y8M0RE37Dliduy59w==',
]}
CONTROL = host.ROOT/'control'
OPERATIONS = host.ROOT/'operations'
RECIPE = Path(__file__).resolve().parent


def request_identity(value, resource, now=None):
    now = int(time.time()*1000) if now is None else now
    if not isinstance(value, dict) or set(value) not in ({'resourceId', 'snapshot', 'argv', 'deadline'}, {'resourceId', 'snapshot', 'argv', 'deadline', 'ci'}):
        raise ValueError('Unknown or missing turn request field')
    argv = value['argv']
    digest = value['snapshot']
    if (value['resourceId'] != resource or not isinstance(digest, str) or len(digest) != 64 or
            any(c not in '0123456789abcdef' for c in digest) or
            not isinstance(argv, list) or not 1 <= len(argv) <= 256 or
            any(not isinstance(v, str) or len(v) > 16384 or '\0' in v for v in argv) or not argv[0] or
            type(value['deadline']) is not int or not now < value['deadline'] <= now+3300000):
        raise ValueError('Invalid or expired turn request')
    if 'ci' in value:
        ci = value['ci']
        keys = ['repositoryId', 'workflowId', 'workflowPath', 'workflowSha', 'workflowDigest', 'event',
                'sourceSha', 'sourceTree', 'runId', 'attempt', 'jobId', 'jobKey']
        if (not isinstance(ci, dict) or set(ci) != set(keys) or
                any(type(ci[k]) is not int or not 0 < ci[k] <= 9007199254740991 for k in ['repositoryId','workflowId','runId','attempt','jobId']) or
                ci['workflowPath'] not in ['.github/workflows/disposable-ci-canary.yml', '.github/workflows/ci.yml'] or
                ci['event'] not in ['workflow_dispatch', 'pull_request'] or not isinstance(ci['jobKey'],str) or
                not re.fullmatch(r'(?:typecheck(?:-1)?|test-dashboard-[1-4]|test-server-(?:[1-9]|1[0-9]|2[0-4])|test-heavy-[1-3]|test-till-[1-7]|test-ui-1|(?:lint|root-guards|bundle-smoke|test-(?:setup|staffing|bookings|media|payments-stripe|payments-sumup|identity|workforce|light-a|light-b))-1|test-fiscal-verifactu-[1-4]|test-provisioning-[1-6]|mutation-shared-[1-4])',ci['jobKey']) or
                any(not isinstance(ci[k],str) or not re.fullmatch(r'[a-f0-9]{40}',ci[k]) for k in ['workflowSha','sourceSha','sourceTree']) or
                not isinstance(ci['workflowDigest'],str) or not re.fullmatch(r'[a-f0-9]{64}',ci['workflowDigest'])):
            raise ValueError('Invalid CI identity')
        canonical = json.dumps({k:ci[k] for k in keys},separators=(',',':')).encode()
        if value['snapshot'] != hashlib.sha256(canonical).hexdigest() or argv != ['/opt/actions-runner/bin/Runner.Listener','run']:
            raise ValueError('CI request identity differs')
    return value


def receive_ci(root, resource, stream):
    resource_id(resource)
    raw = stream.read(65537)
    if len(raw)>65536:
        raise ValueError('CI request byte limit exceeded')
    value = request_identity(json.loads(raw), resource)
    if 'ci' not in value:
        raise ValueError('CI request required')
    root.mkdir(mode=0o700,parents=True,exist_ok=True)
    if root.is_symlink() or not root.is_dir():
        raise ValueError('Unsafe transfer root')
    target=root/resource
    target.mkdir(mode=0o700)
    try:
        host.write_json(target/'request.json',value)
    except BaseException:
        shutil.rmtree(target)
        raise
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
        raw_request = json.loads((target/'request.json').read_text())
        now = int(time.time()*1000)
        candidate = raw_request
        if (isinstance(raw_request, dict) and type(raw_request.get('deadline')) is int and
                now < raw_request['deadline'] <= now+3300000+5000):
            candidate = {**raw_request, 'deadline': min(raw_request['deadline'], now+3300000)}
        request = request_identity(candidate, resource, now=now)
        if request != raw_request:
            normalized = target/'request-normalized.json'
            host.write_json(normalized, request)
            os.replace(normalized, target/'request.json')
            operations.sync_directory(target)
        with (target/'source.tar').open('rb') as source:
            if hashlib.file_digest(source, 'sha256').hexdigest() != request['snapshot']:
                raise ValueError('Snapshot digest mismatch')
        if 'ui.tgz' in seen:
            with (target/'ui.tgz').open('rb') as source:
                if hashlib.file_digest(source, 'sha512').digest() not in PACKAGE_SHA512:
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
    memory_input=stdin.getvalue() if isinstance(stdin,io.BytesIO) else None
    if memory_input is not None and (capture or len(memory_input)>65536):
        raise ValueError('Invalid memory-only command input')
    child = subprocess.Popen(argv, stdin=subprocess.PIPE if memory_input is not None else stdin or subprocess.DEVNULL,
                             stdout=subprocess.PIPE if capture else None,
                             stderr=subprocess.DEVNULL if capture else None,
                             start_new_session=True)
    try:
        if capture:
            output = bytearray()
            with selectors.DefaultSelector() as reader:
                reader.register(child.stdout, selectors.EVENT_READ)
                while True:
                    remaining = (deadline-int(time.time()*1000))/1000
                    if remaining <= 0:
                        raise TimeoutError('Absolute turn deadline exceeded')
                    if not reader.select(min(remaining, .2)):
                        continue
                    data = os.read(child.stdout.fileno(), min(65536, 4097-len(output)))
                    if not data:
                        break
                    output.extend(data)
                    if len(output) > 4096:
                        raise ValueError('Host capture output byte limit exceeded')
            child.wait(timeout=max(.001, (deadline-int(time.time()*1000))/1000))
            output = bytes(output)
        else:
            output, _ = child.communicate(input=memory_input,timeout=remaining)
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
        if child.stdout is not None:
            child.stdout.close()


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
            '-p', str(22000+host.slot_id(directory.name)), 'root@127.0.0.1']


def prepare(resource):
    directory = turn_directory(resource)
    request = request_identity(json.loads((directory/'request.json').read_text()), resource)
    deadline = request['deadline']
    if 'ci' not in request and not (directory/'ui.tgz').is_file():
        raise ValueError('Reviewed private dependency bytes are required')
    command(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(directory/'key')], deadline)
    public = ' '.join((directory/'key.pub').read_text().split()[:2])
    host.create({'resourceId': resource, 'deadline': deadline, 'sshPublicKey': public})
    boot_end = min(deadline, int(time.time()*1000)+120000)
    while int(time.time()*1000) < boot_end:
        code, output = command(['ssh-keyscan', '-T', '2', '-t', 'ed25519', '-p', str(22000+host.slot_id(resource)), '127.0.0.1'],
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
    if 'ci' in request:
        for source_path, target in [(RECIPE/'runner-tools.sh','/opt/waitron-disposable/runner-tools.sh'),
                                    (RECIPE/'guest-exec.py','/opt/waitron-disposable/guest-exec.py')]:
            with source_path.open('rb') as source:
                command([*ssh,'cat > '+target],deadline,stdin=source)
        command([*ssh,'bash /opt/waitron-disposable/runner-tools.sh'],min(deadline,int(time.time()*1000)+180000))
        (directory/'prepared').touch(exist_ok=False)
        return
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


def execute(resource, ci_stream=None):
    directory = turn_directory(resource)
    request = request_identity(json.loads((directory/'request.json').read_text()), resource)
    if not (directory/'prepared').is_file() or not host.observation(resource)['running']:
        raise ValueError('The exact turn must be prepared and running')
    if request['deadline']-10000 <= int(time.time()*1000):
        raise ValueError('Insufficient command completion readback budget')
    nonce = secrets.token_hex(16)
    if 'ci' in request:
        command([*guest_ssh(directory),'sha256sum --check --status /opt/waitron-tools/runner-listener.sha256'],request['deadline'])
        if ci_stream is None:
            raise ValueError('CI credentials require the memory-only channel')
        raw=ci_stream.read(65537)
        if len(raw)>65536:
            raise ValueError('CI credential input byte limit exceeded')
        credentials=json.loads(raw)
        if not isinstance(credentials,dict) or set(credentials)!={'jitconfig'} or not isinstance(credentials['jitconfig'],str) or not 1<=len(credentials['jitconfig'])<=64000:
            raise ValueError('Invalid CI credential input')
        payload={'deadline':request['deadline']-10000,'nonce':nonce,'jitconfig':credentials['jitconfig']}
        code,_=command([*guest_ssh(directory),'python3 /opt/waitron-disposable/guest-exec.py '+shlex.quote(resource)+' --ci'],
                       request['deadline'],stdin=io.BytesIO(json.dumps(payload).encode()),check=False)
    else:
        with (directory/'command.json').open('x') as output:
            json.dump({'argv': request['argv'], 'deadline': request['deadline']-10000, 'nonce': nonce}, output)
        with (directory/'command.json').open('rb') as source:
            code, _ = command([*guest_ssh(directory),
                               'env CI=true npm_config_store_dir=/work/pnpm-store npm_config_prefer_offline=true '
                               'python3 /opt/waitron-disposable/guest-exec.py '+shlex.quote(resource)],
                              request['deadline'], stdin=source, check=False)
    if code != 0:
        raise ValueError('Execution channel did not confirm guest completion')
    if 'ci' in request:
        command([*guest_ssh(directory),'sha256sum --check --status /opt/waitron-tools/runner-listener.sha256'],request['deadline'])
    _, raw = command([*guest_ssh(directory), 'cat /run/waitron-disposable/result.json'],
                      request['deadline'], capture=True)
    receipt = json.loads(raw)
    if (not isinstance(receipt, dict) or set(receipt) != {'resourceId', 'nonce', 'code'} or
            receipt['resourceId'] != resource or receipt['nonce'] != nonce or
            type(receipt['code']) is not int or not 0 <= receipt['code'] <= 255):
        raise ValueError('Invalid or replayed guest completion nonce')
    host.write_json(directory/'result.json', {'resourceId': resource, 'code': receipt['code']})
    return 0


def result(resource):
    receipt = json.loads((turn_directory(resource)/'result.json').read_text())
    if (not isinstance(receipt, dict) or set(receipt) != {'resourceId', 'code'} or
            receipt['resourceId'] != resource or type(receipt['code']) is not int or not 0 <= receipt['code'] <= 255):
        raise ValueError('Invalid trusted host completion')
    return receipt


def inspect(resource):
    observed = host.observation(resource)
    observed['controlPresent'] = (CONTROL/resource).exists()
    operation = host.service_state(resource+'-operation')
    observed['operationPresent'] = not operation['absent']
    observed['absent'] = observed['absent'] and not observed['controlPresent'] and operation['absent']
    return observed


def destroy(resource):
    # Closure precedes stop: even a delayed service start must refuse this generation.
    operations.fence(OPERATIONS, resource)
    for suffix in ('transfer-expiry', 'expiry'):
        stop_timer(resource, suffix)
    if not host.service_state(resource+'-operation')['absent']:
        host.run('systemctl', 'stop', resource+'-operation.service', timeout=15)
    if not host.service_state(resource+'-operation')['absent']:
        raise ValueError('Owned operation still present; slot quarantined')
    observed = host.destroy(resource)
    if not observed['absent']:
        raise ValueError('Owned VM cleanup remains uncertain')
    directory = CONTROL/resource
    if directory.exists() or directory.is_symlink():
        turn_directory(resource)
        shutil.rmtree(directory)
    return inspect(resource)


def stop_timer(resource, suffix):
    unit = resource+'-'+suffix+'.timer'
    host.run('systemctl', 'stop', unit, check=False, timeout=10)
    result = host.run('systemctl', 'show', unit, '--property=ActiveState', timeout=10)
    if result.stdout.strip() != 'ActiveState=inactive':
        raise ValueError('Owned deadline timer did not stop')


def arm_expiry(resource, deadline, suffix):
    if (OPERATIONS/resource/'closed').exists():
        raise ValueError('This resource generation is closed')
    now = int(time.time()*1000)
    if type(deadline) is not int or not now < deadline <= now+3300000:
        raise ValueError('Invalid server cleanup deadline')
    # The longer turn timer is installed before the short transfer timer stops.
    # A controller/worker death during the handoff therefore retains a watchdog.
    host.write_json(operations.directory(OPERATIONS, resource)/(suffix+'.json'),
                    {'resourceId': resource, 'deadline': deadline,
                     'bootId': Path('/proc/sys/kernel/random/boot_id').read_text().strip()})
    host.run('systemd-run', '--quiet', '--collect', '--unit='+resource+'-'+suffix,
             '--on-calendar=@'+str((deadline+999)//1000), '--timer-property=AccuracySec=1s',
             '--timer-property=RandomizedDelaySec=0', '--property=Type=exec',
             '--property=RuntimeMaxSec=115', '--property=TimeoutStopSec=5',
             '--property=KillMode=control-group',
             sys.executable, '-B', str(RECIPE/'session.py'), '_cleanup', resource)


def stage(mode, resource):
    if mode in ('transfer','transfer-ci'):
        arm_expiry(resource, int(time.time()*1000)+120000, 'transfer-expiry')
        request = (receive_ci if mode=='transfer-ci' else receive)(CONTROL, resource, sys.stdin.buffer)
        arm_expiry(resource, request['deadline'], 'expiry')
        stop_timer(resource, 'transfer-expiry')
        print(json.dumps({'received': True, 'resourceId': resource, 'snapshot': request['snapshot']}))
    elif mode == 'prepare':
        prepare(resource)
    elif mode in ('execute-v2','execute-ci'):
        return execute(resource,sys.stdin.buffer if mode=='execute-ci' else None)
    else:
        raise ValueError('Unknown owned stage')
    return 0


def supervise(mode, resource):
    now = int(time.time()*1000)
    if mode in ('transfer','transfer-ci'):
        deadline = now+120000
    else:
        request = request_identity(json.loads((turn_directory(resource)/'request.json').read_text()), resource)
        deadline = request['deadline']
    # The service owns all host children independently of the SSH channel. systemd
    # binds the unit to this unique resource generation and kills the whole group.
    argv = ['systemd-run', '--quiet', '--wait', '--pipe', '--collect', '--service-type=exec',
            '--unit='+resource+'-operation', '--property=KillMode=control-group',
            '--property=TimeoutStopSec=5', '--property=SendSIGKILL=yes',
            '--property=RuntimeMaxSec='+str(max(1, (deadline-now)//1000)),
            sys.executable, '-B', str(RECIPE/'session.py'), '_worker', mode, resource]
    return subprocess.run(argv).returncode


def main():
    import startup
    if os.geteuid() != 0 or not Path('/dev/kvm').is_char_device():
        raise ValueError('Dedicated root KVM host required')
    if len(sys.argv) == 2 and sys.argv[1] == 'health':
        healthy = startup.ready()
        if healthy:
            try:
                with host.locked():
                    host.capacity()
            except (OSError,ValueError):
                healthy = False
        print(json.dumps({'healthy': healthy}))
        return 0
    if len(sys.argv) == 3 and sys.argv[1] == '_cleanup':
        resource = resource_id(sys.argv[2])
        print(json.dumps(destroy(resource)))
        return 0
    if len(sys.argv) == 4 and sys.argv[1] == '_worker':
        mode, resource = sys.argv[2:]
        startup.require_ready()
        with operations.owned(OPERATIONS, resource):
            return stage(mode, resource)
    if len(sys.argv) != 3:
        raise ValueError('Usage: session.py transfer|prepare|execute-v2|result|inspect|destroy RESOURCE')
    mode, resource = sys.argv[1:]
    resource_id(resource)
    if mode in ('transfer', 'transfer-ci', 'prepare', 'execute-v2', 'execute-ci'):
        startup.require_ready()
        return supervise(mode, resource)
    elif mode == 'destroy':
        argv = ['systemd-run', '--quiet', '--wait', '--pipe', '--collect', '--service-type=exec',
                '--unit='+resource+'-cleanup', '--property=KillMode=control-group',
                '--property=TimeoutStopSec=5', '--property=RuntimeMaxSec=115',
                sys.executable, '-B', str(RECIPE/'session.py'), '_cleanup', resource]
        return subprocess.run(argv).returncode
    elif mode == 'inspect':
        print(json.dumps(inspect(resource)))
    elif mode == 'result':
        print(json.dumps(result(resource)))
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
    except BlockingIOError as error:
        print(str(error), file=sys.stderr)
        sys.exit(75)
    except KeyboardInterrupt:
        sys.exit(143)
    except (TimeoutError, subprocess.TimeoutExpired) as error:
        print(str(error), file=sys.stderr)
        sys.exit(124)
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(125)
