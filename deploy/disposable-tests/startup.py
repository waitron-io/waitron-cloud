#!/usr/bin/env python3
"""Remove recorded interrupted turns before admitting work after a host boot."""
import fcntl
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import uuid

import host
import operations

BOOT_ID = Path('/proc/sys/kernel/random/boot_id')


def boot_id():
    value = BOOT_ID.read_text().strip()
    if str(uuid.UUID(value)) != value:
        raise ValueError('Invalid host boot identity')
    return value


def owned(path, directory=False, guest_uid=None):
    info = path.lstat()
    kind = stat.S_ISDIR if directory else stat.S_ISREG
    if (not kind(info.st_mode) or info.st_uid not in ({os.geteuid(), guest_uid} if guest_uid is not None else {os.geteuid()}) or
            info.st_mode & 0o022 or (not directory and info.st_size > 65536)):
        raise ValueError('Unsafe startup inventory or readiness path')


def read_ready():
    path = host.ROOT/'startup.json'
    if not os.path.lexists(path):
        return None
    owned(path)
    value = json.loads(path.read_text())
    if (not isinstance(value, dict) or set(value) != {'version', 'bootId'} or
            value['version'] != 1 or not isinstance(value['bootId'], str) or
            str(uuid.UUID(value['bootId'])) != value['bootId']):
        raise ValueError('Invalid startup readiness record')
    return value


def ready():
    try:
        owned(host.ROOT, directory=True)
        return read_ready() == {'version': 1, 'bootId': boot_id()}
    except (OSError, ValueError, TypeError):
        return False


def require_ready():
    if not ready():
        raise ValueError('Host startup reconciliation is incomplete')


def inventory():
    active = []
    for path in sorted({host.ROOT/'active.json', *host.ROOT.glob('active-*.json')}):
        if not os.path.lexists(path):
            continue
        owned(path)
        value = json.loads(path.read_text())
        if not isinstance(value, dict):
            raise ValueError('Invalid active host record')
        resource = host.resource_id(value.get('resourceId'))
        if path != host.active_path(resource):
            raise ValueError('Active record belongs to another slot')
        active.append(resource)
    resources = set(active)
    closed = set()
    for name in ('control', 'turns', 'operations'):
        directory = host.ROOT/name
        if not os.path.lexists(directory):
            continue
        owned(directory, directory=True)
        for entry in directory.iterdir():
            host.resource_id(entry.name)
            owned(entry, directory=True, guest_uid=62000+host.slot_id(entry.name) if name == 'turns' else None)
            if name == 'operations' and os.path.lexists(entry/'closed'):
                owned(entry/'closed')
                closed.add(entry.name)
            else:
                resources.add(entry.name)
    if closed - resources:
        units = {line.split()[0] for line in host.run(
            'systemctl', 'list-units', '--all', '--plain', '--no-legend', '--no-pager',
            'dt-*.service', 'dt-*.timer').stdout.splitlines() if line.strip()}
        for resource in closed - resources:
            # A fence can precede a failed stop. Skip completed history only
            # when one systemd inventory also finds no remaining owned unit.
            suffixes = ('.service', '-operation.service', '-cleanup.service', '-expiry.service',
                        '-expiry.timer', '-transfer-expiry.service', '-transfer-expiry.timer')
            if any(resource+suffix in units for suffix in suffixes):
                resources.add(resource)
    # Old completed generations may still have operation fences. Clean the
    # actual slot owner first so stale destruction cannot target its successor.
    return active + sorted(resources - set(active))


def reconcile():
    import session
    host.ROOT.mkdir(mode=0o755, parents=True, exist_ok=True)
    owned(host.ROOT, directory=True)
    fd = os.open(host.ROOT/'startup.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
            raise ValueError('Unsafe startup lock')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        current = {'version': 1, 'bootId': boot_id()}
        if read_ready() == current:
            return current
        resources = inventory()
        for resource in resources:
            session.destroy(resource)
            observation = session.inspect(resource)
            if observation.get('resourceId') != resource or observation.get('absent') is not True:
                raise ValueError('Independent startup resource absence was not proved')
        host.capacity()
        temporary = host.ROOT/('startup-'+uuid.uuid4().hex+'.tmp')
        try:
            host.write_json(temporary, current)
            os.replace(temporary, host.ROOT/'startup.json')
            operations.sync_directory(host.ROOT)
        finally:
            temporary.unlink(missing_ok=True)
        return current
    finally:
        os.close(fd)


def main():
    try:
        if len(sys.argv) != 1 or os.geteuid() != 0 or not Path('/dev/kvm').is_char_device():
            raise ValueError('Startup reconciliation requires the dedicated root KVM host')
        print(json.dumps(reconcile()))
        return 0
    except BlockingIOError as error:
        print(str(error), file=sys.stderr)
        return 75
    except (TimeoutError, subprocess.TimeoutExpired) as error:
        print(str(error), file=sys.stderr)
        return 124
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        return 125


if __name__ == '__main__':
    sys.exit(main())
