#!/usr/bin/env python3
"""Narrow, trusted-host VM operations; candidate arguments never become host flags."""
import base64
import json
from pathlib import Path
import re
import sys
import time

ROOT = Path('/var/lib/waitron-disposable')
IMAGE = ROOT / 'base/debian.qcow2'


def plan(request):
    if not isinstance(request, dict) or set(request) != {'resourceId', 'deadline', 'sshPublicKey'}:
        raise ValueError('Unknown or missing host request field')
    resource = request['resourceId']
    if not isinstance(resource, str) or not re.fullmatch(r'dt-[A-Za-z0-9][A-Za-z0-9_-]{0,63}-0-[1-9][0-9]{0,14}', resource):
        raise ValueError('Invalid local resource ID; only slot zero is qualified for development')
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


if __name__ == '__main__':
    try:
        if sys.argv[1:] != ['plan']:
            raise ValueError('Usage: host.py plan < request.json')
        print(json.dumps(plan(json.load(sys.stdin))))
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
