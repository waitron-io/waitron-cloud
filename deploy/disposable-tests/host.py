#!/usr/bin/env python3
"""Narrow, trusted-host VM operations; candidate arguments never become host flags."""
import base64
from contextlib import contextmanager
import hashlib
import fcntl
import stat
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


GUEST_MEMORY_MIB = 16384
HOST_CAP_MIB = 18432


def resource_id(value):
    if not isinstance(value, str) or not re.fullmatch(r'dt-[A-Za-z0-9][A-Za-z0-9_-]{0,63}-(?:[0-9]|1[0-5])-[1-9][0-9]{0,14}', value):
        raise ValueError('Invalid local resource ID or slot')
    return value


def slot_id(resource):
    return int(resource_id(resource).rsplit('-', 2)[1])


def active_path(resource):
    slot = slot_id(resource)
    return ROOT/('active.json' if slot == 0 else f'active-{slot}.json')


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
    if (ROOT/'lock').exists():
        raise BlockingIOError('Legacy host operation needs reconciliation')
    fd = os.open(ROOT/'operation.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
            raise ValueError('Unsafe host operation lock')
        # Kernel ownership survives neither process death nor reboot. Durable
        # active/history records still require verified cleanup before reuse.
        fcntl.flock(fd, fcntl.LOCK_EX)
        directory(ROOT / 'base', 0o755)
        directory(ROOT / 'turns', 0o755)
        directory(ROOT / 'history')
        yield
    finally:
        os.close(fd)


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
        for slot in range(16):
            try:
                pwd.getpwuid(62000+slot)
            except KeyError:
                # systemd resolves numeric service credentials in the account database.
                run('useradd', '--system', '--uid', str(62000+slot), '--gid', 'kvm',
                    '--no-create-home', '--home-dir', '/nonexistent',
                    '--shell', '/usr/sbin/nologin', f'dt-slot-{slot}')
            guest_account(slot)
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


def guest_account(slot=0):
    account = pwd.getpwuid(62000+slot)
    if (account.pw_name != f'dt-slot-{slot}' or account.pw_dir != '/nonexistent' or
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
    uid = 62000+slot_id(resource)
    return f'''table inet {table_name(resource)} {{
 chain output {{
  type filter hook output priority -10; policy accept;
  meta skuid {uid} ct state established,related accept
  meta skuid {uid} meta nfproto ipv6 counter reject
  meta skuid {uid} ip daddr {{ {', '.join(denied)} }} counter reject
 }}
}}
'''


def budget(slots, *, memory, threads, disk_total, disk_free, allocated):
    if type(slots) is not int or not 1 <= slots <= 16:
        raise ValueError('Invalid host slot budget')
    if any(type(v) is not int or v < 0 for v in [memory, threads, disk_total, disk_free, allocated]):
        raise ValueError('Invalid host resource measurement')
    if slots > 10:
        raise ValueError('Ten-slot operating limit exceeded')
    if slots*HOST_CAP_MIB*1024**2+16*1024**3 > memory:
        raise ValueError('Insufficient memory for guest caps and host reserve')
    # On the 32-thread host, guests share 24; four complete cores stay reserved.
    if min(slots*4, 24)+8 > threads:
        raise ValueError('Insufficient execution threads after host reserve')
    remaining = max(0, slots*64*1024**3-allocated)
    if disk_free-remaining < (disk_total+4)//5:
        raise ValueError('Insufficient disk after guest maxima and twenty-percent reserve')


def guest_cpus(topology):
    if (not isinstance(topology, dict) or not topology or
            any(type(cpu) is not int or cpu < 0 or not isinstance(core, tuple) or len(core) != 2 or
                any(type(value) is not int or value < 0 for value in core) for cpu, core in topology.items())):
        raise ValueError('Invalid online CPU topology')
    cores = sorted(set(topology.values()))
    if len(cores) <= 4:
        raise ValueError('No guest CPU pool after reserving four physical cores')
    reserved = set(cores[:4])
    return sorted(cpu for cpu, core in topology.items() if core not in reserved)


def capacity(extra=None):
    resources = set()
    for path in sorted({ROOT/'active.json', *ROOT.glob('active-*.json')}):
        if not os.path.lexists(path):
            continue
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise ValueError('Unsafe active allocation record')
        resource = resource_id(json.loads(path.read_text()).get('resourceId'))
        if path != active_path(resource):
            raise ValueError('Active allocation belongs to another slot')
        resources.add(resource)
    allocated = 0
    turns = ROOT/'turns'
    if turns.exists():
        for path in turns.iterdir():
            resource = resource_id(path.name)
            info = path.lstat()
            if (not stat.S_ISDIR(info.st_mode) or info.st_uid not in (0,62000+slot_id(resource)) or info.st_mode & 0o022):
                raise ValueError('Unsafe retained guest allocation')
            resources.add(resource)
            for child in path.iterdir():
                info = child.lstat()
                if stat.S_ISLNK(info.st_mode):
                    raise ValueError('Linked guest allocation refused')
                if stat.S_ISREG(info.st_mode):
                    allocated += info.st_blocks*512
    if extra is not None:
        resources.add(resource_id(extra))
    slots = len(resources)+(extra is None)
    memory = int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemTotal:')))*1024
    topology = {}
    for cpu in os.sched_getaffinity(0):
        base = Path(f'/sys/devices/system/cpu/cpu{cpu}/topology')
        topology[cpu] = tuple(int((base/name).read_text()) for name in ['physical_package_id','core_id'])
    allowed = guest_cpus(topology)
    disk = shutil.disk_usage(ROOT)
    budget(slots,memory=memory,threads=min(len(topology),len(allowed)+8),disk_total=disk.total,disk_free=disk.free,allocated=allocated)
    return {'slots': slots, 'cpus': allowed}


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
    uid, port = 62000+slot_id(resource), 22000+slot_id(resource)
    qemu = ['/usr/bin/qemu-system-x86_64', '-no-user-config', '-nodefaults',
            '-machine', 'q35,accel=kvm', '-cpu', 'host', '-smp', '4', '-m', str(GUEST_MEMORY_MIB),
            '-display', 'none', '-monitor', 'none',
            '-chardev', 'ringbuf,id=serial0,size=16384', '-serial', 'chardev:serial0',
            '-device', 'VGA',
            '-fw_cfg', 'name=opt/org.seabios/sercon-port,string=0x3f8',
            '-qmp', f'unix:{directory}/qmp.sock,server=on,wait=off',
            '-drive', f'file={directory}/disk.qcow2,format=qcow2,if=virtio',
            '-drive', f'file={directory}/seed.img,format=raw,if=virtio,readonly=on',
            '-netdev', f'user,id=net0,ipv6=off,hostfwd=tcp:127.0.0.1:{port}-:22',
            '-device', 'virtio-net-pci,netdev=net0',
            '-sandbox', 'on,obsolete=deny,elevateprivileges=deny,spawn=deny,resourcecontrol=deny']
    service = [f'User={uid}', 'Group=kvm', 'KillMode=control-group', 'TimeoutStopSec=30',
               f'RuntimeMaxSec={(deadline - now) // 1000}', f'MemoryMax={HOST_CAP_MIB}M', 'CPUQuota=400%',
               'NoNewPrivileges=yes', 'ProtectSystem=strict', f'ReadWritePaths={directory}',
               'ProtectHome=yes', 'PrivateTmp=yes', 'DevicePolicy=closed', 'DeviceAllow=/dev/kvm rw']
    cloud = {'users': [{'name': 'root', 'lock_passwd': True, 'ssh_authorized_keys': [key]}],
             'disable_root': False, 'ssh_pwauth': False, 'package_update': False,
             'growpart': {'mode': 'auto', 'devices': ['/']}, 'resize_rootfs': True}
    return {'resourceId': resource, 'directory': str(directory), 'uid': uid,
            'port': port, 'deadline': deadline, 'qemu': qemu, 'service': service,
            'userData': '#cloud-config\n' + json.dumps(cloud) + '\n'}


def select_image(fresh=False):
    import image
    chosen = None if fresh else image.select(ROOT, IMAGE_SHA512)
    if chosen is None:
        image_verified()
        chosen = {'path': IMAGE, 'mode': 'install',
                  'entries': [(IMAGE, 0o444, image.metadata(IMAGE, 0o444))]}
    return chosen


def create(request):
    return _create(request)


def _create(request, *, fresh=False):
    initial = plan(request)
    resource = initial['resourceId']
    import image
    chosen = select_image(fresh)
    with locked():
        active = active_path(resource)
        if active.exists() or (ROOT / 'history' / (resource + '.json')).exists():
            raise BlockingIOError('A slot is occupied or this resource ID is already retired')
        admitted = capacity(resource)
        image.recheck(chosen, run)
        guest_account(slot_id(resource))
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
        run('qemu-img', 'create', '-f', 'qcow2', '-F', 'qcow2', '-b', str(chosen['path']), str(turn / 'disk.qcow2'), '64G')
        for child in turn.iterdir():
            os.chmod(child, 0o600)
            os.chown(child, initial['uid'], -1)
        os.chown(turn, initial['uid'], -1)
        run('nft', '-f', '-', input=policy)
        current = plan(request)
        current['service'].append('AllowedCPUs='+','.join(map(str,admitted['cpus'])))
        if request['deadline'] - int(time.time() * 1000) < 1000:
            raise ValueError('Turn deadline too close to start')
        command = ['systemd-run', '--quiet', '--service-type=exec', '--unit=' + resource]
        for setting in current['service']:
            command.extend(['--property', setting])
        run(*command, *current['qemu'])
        return {**observation(resource), 'preparation': chosen['mode']}


def destroy(resource):
    with locked():
        active = active_path(resource)
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
