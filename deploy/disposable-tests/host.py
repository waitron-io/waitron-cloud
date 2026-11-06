#!/usr/bin/env python3
"""Narrow, trusted-host VM operations; candidate arguments never become host flags."""
import base64
from contextlib import contextmanager
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path('/var/lib/waitron-disposable')
IMAGE = ROOT / 'base/debian.qcow2'
IMAGE_URL = 'https://cloud.debian.org/images/cloud/trixie/20261103-2651/debian-13-genericcloud-amd64-20261103-2651.qcow2'
IMAGE_SHA512 = 'd25999de0770d4cde1be72c299ba3ad94eac7ea8fd4d18f8cc86c69df69337e2e8a91d64465a9bfd8f2a78c566fcbcb0842eacc91c09efdef72d719d9f13b535'


def resource_id(value):
    if not isinstance(value, str) or not re.fullmatch(r'dt-[A-Za-z0-9][A-Za-z0-9_-]{0,63}-0-[1-9][0-9]{0,14}', value):
        raise ValueError('Invalid local resource ID; only slot zero is qualified for development')
    return value


def run(*args, timeout=30, input=None, check=True):
    result = subprocess.run(args, input=input, text=True, capture_output=True, timeout=timeout)
    if check and result.returncode:
        raise ValueError(f'{args[0]} failed ({result.returncode}): {result.stderr.strip()}')
    return result


def directory(path, mode=0o700):
    path.mkdir(mode=mode, exist_ok=True)
    if path.is_symlink() or not path.is_dir() or path.stat().st_uid != 0:
        raise ValueError('Unsafe host resource directory')


@contextmanager
def locked():
    if os.geteuid() != 0 or not Path('/dev/kvm').is_char_device():
        raise ValueError('Dedicated root KVM host required')
    directory(ROOT, 0o755)
    lock = ROOT / 'lock'
    try:
        lock.mkdir(mode=0o700)
    except FileExistsError:
        raise BlockingIOError('Host operation already running or needs reconciliation')
    try:
        directory(ROOT / 'base', 0o755)
        directory(ROOT / 'turns', 0o755)
        directory(ROOT / 'history')
        yield
    finally:
        lock.rmdir()


def write_json(path, data):
    with path.open('x') as target:
        json.dump(data, target)
        target.write('\n')
        target.flush()
        os.fsync(target.fileno())
    fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def image_verified():
    if IMAGE.is_symlink() or not IMAGE.is_file() or IMAGE.stat().st_uid != 0:
        raise ValueError('Pinned base image is missing or unsafe')
    with IMAGE.open('rb') as source:
        if hashlib.file_digest(source, 'sha512').hexdigest() != IMAGE_SHA512:
            raise ValueError('Pinned base image digest mismatch')
    info = json.loads(run('qemu-img', 'info', '--output=json', str(IMAGE)).stdout)
    if info.get('format') != 'qcow2' or info.get('backing-filename') or info.get('data-file'):
        raise ValueError('Base image must be self-contained qcow2')


def prepare_image():
    with locked():
        try:
            pwd.getpwuid(62000)
        except KeyError:
            # systemd resolves service credentials through the account database,
            # even when User= is numeric. This account cannot log in or own keys.
            run('useradd', '--system', '--uid', '62000', '--gid', 'kvm',
                '--no-create-home', '--home-dir', '/nonexistent',
                '--shell', '/usr/sbin/nologin', 'dt-slot-0')
        guest_account()
        if not IMAGE.exists():
            fd, temporary = tempfile.mkstemp(prefix='image-', dir=ROOT / 'base')
            os.close(fd)
            try:
                run('curl', '--fail', '--silent', '--show-error', '--location',
                    '--proto', '=https', '--proto-redir', '=https', '--connect-timeout', '10',
                    '--max-time', '120', '--max-filesize', '1073741824',
                    '--output', temporary, IMAGE_URL, timeout=130)
                with open(temporary, 'rb') as source:
                    if hashlib.file_digest(source, 'sha512').hexdigest() != IMAGE_SHA512:
                        raise ValueError('Downloaded base image digest mismatch')
                    os.fsync(source.fileno())
                os.chmod(temporary, 0o444)
                os.link(temporary, IMAGE)
            finally:
                os.unlink(temporary)
        image_verified()
        return {'image': str(IMAGE), 'sha512': IMAGE_SHA512, 'url': IMAGE_URL}


def guest_account():
    account = pwd.getpwuid(62000)
    if (account.pw_name != 'dt-slot-0' or account.pw_dir != '/nonexistent' or
            account.pw_shell != '/usr/sbin/nologin'):
        raise ValueError('Reserved guest UID belongs to an unexpected host account')


def table_name(resource):
    return 'dt_' + hashlib.sha256(resource.encode()).hexdigest()[:24]


def service_state(resource):
    result = run('systemctl', 'show', resource + '.service', '--property=LoadState',
                 '--property=ActiveState', '--property=ControlGroup', check=False)
    values = dict(line.split('=', 1) for line in result.stdout.splitlines() if '=' in line)
    if values.get('LoadState') == 'not-found':
        return {'running': False, 'absent': True}
    if result.returncode or values.get('LoadState') != 'loaded':
        raise ValueError('Unable to determine owned service state')
    cgroup = values.get('ControlGroup')
    if cgroup and cgroup != f'/system.slice/{resource}.service':
        raise ValueError('Unexpected owned service control group')
    live = bool(cgroup and Path('/sys/fs/cgroup' + cgroup).exists())
    return {'running': values.get('ActiveState') == 'active',
            'absent': values.get('ActiveState') in ('inactive', 'failed') and not live}


def table_present(resource):
    tables = json.loads(run('nft', '-j', 'list', 'tables').stdout)['nftables']
    return any(row.get('table', {}).get('family') == 'inet' and
               row.get('table', {}).get('name') == table_name(resource) for row in tables)


def observation(resource):
    service = service_state(resource)
    disk = (ROOT / 'turns' / resource).exists()
    network = table_present(resource)
    return {'resourceId': resource, 'running': service['running'],
            'diskPresent': disk, 'networkPresent': network,
            'absent': service['absent'] and not disk and not network}


def network_policy(resource):
    interfaces = json.loads(run('ip', '-json', 'address', 'show').stdout)
    hosts = {str(ipaddress.ip_address(address['local'])) for interface in interfaces
             for address in interface.get('addr_info', []) if address['family'] == 'inet'}
    denied = ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8',
              '169.254.0.0/16', '172.16.0.0/12', '192.0.0.0/24', '192.0.2.0/24',
              '192.168.0.0/16', '198.18.0.0/15', '198.51.100.0/24',
              '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4'] + sorted(hosts)
    return f'''table inet {table_name(resource)} {{
 chain output {{
  type filter hook output priority -10; policy accept;
  meta skuid 62000 ct state established,related accept
  meta skuid 62000 meta nfproto ipv6 counter reject
  meta skuid 62000 ip daddr {{ {', '.join(denied)} }} counter reject
 }}
}}
'''


def plan(request):
    if not isinstance(request, dict) or set(request) != {'resourceId', 'deadline', 'sshPublicKey'}:
        raise ValueError('Unknown or missing host request field')
    resource = resource_id(request['resourceId'])
    deadline = request['deadline']
    now = int(time.time() * 1000)
    if type(deadline) is not int or not now < deadline <= now + 3300000:
        raise ValueError('Invalid absolute turn deadline')
    key = request['sshPublicKey']
    if not isinstance(key, str) or not re.fullmatch(r'ssh-ed25519 [A-Za-z0-9+/]{68}', key):
        raise ValueError('Invalid per-turn SSH public key')
    decoded = base64.b64decode(key.split(' ')[1], validate=True)
    if len(decoded) != 51 or decoded[:19] != b'\0\0\0\x0bssh-ed25519\0\0\0\x20':
        raise ValueError('Invalid per-turn SSH public key')
    directory = ROOT / 'turns' / resource
    qemu = ['/usr/bin/qemu-system-x86_64', '-no-user-config', '-nodefaults',
            '-machine', 'q35,accel=kvm', '-cpu', 'host', '-smp', '4', '-m', '16384',
            '-display', 'none', '-monitor', 'none', '-serial', f'file:{directory}/console.log',
            '-device', 'VGA',
            '-fw_cfg', 'name=opt/org.seabios/sercon-port,string=0x3f8',
            '-qmp', f'unix:{directory}/qmp.sock,server=on,wait=off',
            '-drive', f'file={directory}/disk.qcow2,format=qcow2,if=virtio',
            '-drive', f'file={directory}/seed.img,format=raw,if=virtio,readonly=on',
            '-netdev', 'user,id=net0,ipv6=off,hostfwd=tcp:127.0.0.1:22000-:22',
            '-device', 'virtio-net-pci,netdev=net0',
            '-sandbox', 'on,obsolete=deny,elevateprivileges=deny,spawn=deny,resourcecontrol=deny']
    service = ['User=62000', 'Group=kvm', 'KillMode=control-group', 'TimeoutStopSec=30',
               f'RuntimeMaxSec={(deadline - now) // 1000}', 'MemoryMax=18G', 'CPUQuota=400%',
               'NoNewPrivileges=yes', 'ProtectSystem=strict', f'ReadWritePaths={directory}',
               'ProtectHome=yes', 'PrivateTmp=yes', 'DevicePolicy=closed', 'DeviceAllow=/dev/kvm rw']
    cloud = {'users': [{'name': 'root', 'lock_passwd': True, 'ssh_authorized_keys': [key]}],
             'disable_root': False, 'ssh_pwauth': False, 'package_update': False,
             'growpart': {'mode': 'auto', 'devices': ['/']}, 'resize_rootfs': True}
    return {'resourceId': resource, 'directory': str(directory), 'uid': 62000,
            'port': 22000, 'deadline': deadline, 'qemu': qemu, 'service': service,
            'userData': '#cloud-config\n' + json.dumps(cloud) + '\n'}


def create(request):
    initial = plan(request)
    resource = initial['resourceId']
    with locked():
        active = ROOT / 'active.json'
        if active.exists() or (ROOT / 'history' / (resource + '.json')).exists():
            raise BlockingIOError('A slot is occupied or this resource ID is already retired')
        image_verified()
        guest_account()
        if not observation(resource)['absent']:
            raise ValueError('Resource already exists without a matching active record')
        policy = network_policy(resource)
        run('nft', '--check', '-f', '-', input=policy)
        # Durable ownership precedes every resource creation. A failed create
        # remains occupied until destroy verifies all recorded resources absent.
        write_json(active, request)
        turn = Path(initial['directory'])
        turn.mkdir(mode=0o700)
        (turn / 'user-data').write_text(initial['userData'])
        (turn / 'meta-data').write_text(json.dumps({'instance-id': resource, 'local-hostname': 'disposable'}))
        run('cloud-localds', str(turn / 'seed.img'), str(turn / 'user-data'), str(turn / 'meta-data'))
        run('qemu-img', 'create', '-f', 'qcow2', '-F', 'qcow2', '-b', str(IMAGE), str(turn / 'disk.qcow2'), '64G')
        for child in turn.iterdir():
            os.chmod(child, 0o600)
            os.chown(child, 62000, -1)
        os.chown(turn, 62000, -1)
        run('nft', '-f', '-', input=policy)
        current = plan(request)
        if request['deadline'] - int(time.time() * 1000) < 1000:
            raise ValueError('Turn deadline too close to start')
        command = ['systemd-run', '--quiet', '--service-type=exec', '--unit=' + resource]
        for setting in current['service']:
            command.extend(['--property', setting])
        run(*command, *current['qemu'])
        return observation(resource)


def destroy(resource):
    with locked():
        active = ROOT / 'active.json'
        if not active.exists():
            observed = observation(resource)
            if not observed['absent']:
                raise ValueError('Unrecorded resource needs reconciliation')
            return observed
        request = json.loads(active.read_text())
        if request.get('resourceId') != resource:
            raise ValueError('Another turn owns the slot; stale destruction refused')
        if not service_state(resource)['absent']:
            run('systemctl', 'stop', resource + '.service', timeout=40)
        if not service_state(resource)['absent']:
            raise ValueError('Owned guest still present; slot quarantined')
        if table_present(resource):
            run('nft', 'delete', 'table', 'inet', table_name(resource))
        turn = ROOT / 'turns' / resource
        if turn.is_symlink():
            raise ValueError('Unsafe owned resource directory')
        if turn.exists():
            shutil.rmtree(turn)
        observed = observation(resource)
        if not observed['absent']:
            raise ValueError('Cleanup uncertain; slot quarantined')
        history = ROOT / 'history' / (resource + '.json')
        if not history.exists():
            write_json(history, {**request, 'absent': True})
        active.unlink()
        run('systemctl', 'reset-failed', resource + '.service', check=False)
        return observed


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError('Usage: host.py plan|prepare-image|create|inspect|destroy')
        mode = sys.argv[1]
        if mode == 'prepare-image':
            result = prepare_image()
        elif mode in ('plan', 'create'):
            result = (plan if mode == 'plan' else create)(json.load(sys.stdin))
        elif mode in ('inspect', 'destroy'):
            request = json.load(sys.stdin)
            if not isinstance(request, dict) or set(request) != {'resourceId'}:
                raise ValueError('Unknown or missing host request field')
            resource = resource_id(request['resourceId'])
            result = (observation if mode == 'inspect' else destroy)(resource)
        else:
            raise ValueError('Unknown host operation')
        print(json.dumps(result))
    except BlockingIOError as error:
        print(str(error), file=sys.stderr)
        sys.exit(75)
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
