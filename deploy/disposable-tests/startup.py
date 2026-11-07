#!/usr/bin/env python3
"""Remove recorded interrupted turns before admitting work after a host boot."""
import fcntl
import json
import os
from pathlib import Path
import stat
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


def owned(path, directory=False, guest=False):
    info = path.lstat()
    kind = stat.S_ISDIR if directory else stat.S_ISREG
    if (not kind(info.st_mode) or info.st_uid not in ({os.geteuid(), 62000} if guest else {os.geteuid()}) or
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
    active = None
    path = host.ROOT/'active.json'
    if os.path.lexists(path):
        owned(path)
        value = json.loads(path.read_text())
        if not isinstance(value, dict):
            raise ValueError('Invalid active host record')
        active = host.resource_id(value.get('resourceId'))
    resources = {active} if active else set()
    for name in ('control', 'turns', 'operations'):
        directory = host.ROOT/name
        if not os.path.lexists(directory):
            continue
        owned(directory, directory=True)
        for entry in directory.iterdir():
            host.resource_id(entry.name)
            owned(entry, directory=True, guest=name == 'turns')
            resources.add(entry.name)
    # Old completed generations may still have operation fences. Clean the
    # actual slot owner first so stale destruction cannot target its successor.
    return ([active] if active else []) + sorted(resources - {active})


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


if __name__ == '__main__':
    try:
        if len(sys.argv) != 1 or os.geteuid() != 0 or not Path('/dev/kvm').is_char_device():
            raise ValueError('Startup reconciliation requires the dedicated root KVM host')
        print(json.dumps(reconcile()))
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(125)
