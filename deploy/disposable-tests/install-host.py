#!/usr/bin/env python3
"""Install one frozen D599 recipe on a drained, dedicated Debian host."""
import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile

SOURCE = Path(__file__).resolve().parent
OPT = Path('/opt')
STATE = Path('/var/lib/waitron-disposable')
UNIT = Path('/etc/systemd/system/waitron-disposable-startup.service')
OWNER = 0
FILES = ['host.py','operations.py','session.py','startup.py','image.py','guest-tools.sh',
         'runner-tools.sh','guest-exec.py','bootstrap-host.sh','host-packages.txt',
         'harden-ssh.sh','ssh-policy.conf','waitron-disposable-startup.service.in',
         'host-runtime.test.py','session-runtime.test.py','cancellation-runtime.test.py','ci-status.py']


def sources():
    return {**{name: SOURCE/name for name in FILES},
            'snapshot.py': SOURCE.parent.parent/'scripts/disposable-tests/snapshot.py'}


def installation(recipe, peers):
    target = Path(recipe)
    if target.parent != OPT or not re.fullmatch(r'waitron-disposable-[a-zA-Z0-9_-]+',target.name):
        raise ValueError('Invalid immutable recipe path')
    addresses = sorted({str(ipaddress.IPv4Address(value)) for value in peers})
    if not addresses:
        raise ValueError('Explicit peer CI addresses required')
    pins = subprocess.run(['bash',str(SOURCE/'bootstrap-host.sh'),'--plan',str(SOURCE/'host-packages.txt')],
                          capture_output=True,text=True,check=True,timeout=10).stdout.splitlines()
    return dict(recipe=str(target),peers=addresses,pins=pins,
                files={name:hashlib.sha256(path.read_bytes()).hexdigest() for name,path in sources().items()})


def command(argv, timeout=600):
    subprocess.run(argv,check=True,timeout=timeout)


def install(plan):
    if os.geteuid() != OWNER:
        raise ValueError('Dedicated root host required')
    if any(STATE.glob('active*.json')):
        raise ValueError('Drain active allocations before installing a recipe')
    if plan != installation(plan['recipe'],plan['peers']):
        raise ValueError('Recipe source changed after planning')
    recipe = Path(plan['recipe'])
    data = {name:path.read_bytes() for name,path in sources().items()}
    data['peer-addresses.json'] = (json.dumps(plan['peers'])+'\n').encode()
    if os.path.lexists(recipe):
        info=recipe.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid!=OWNER or info.st_mode&0o022:
            raise ValueError('Unsafe frozen recipe directory')
        for name,value in data.items():
            path=recipe/name;info=path.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_uid!=OWNER or info.st_mode&0o022 or path.read_bytes()!=value:
                raise ValueError('Frozen recipe differs; choose a fresh recipe path')
    else:
        recipe.mkdir(mode=0o700)
        for name,value in data.items():
            path=recipe/name;path.write_bytes(value);path.chmod(0o500 if name.endswith('.sh') else 0o400)
        recipe.chmod(0o500)
    unit=(recipe/'waitron-disposable-startup.service.in').read_text().replace('@RECIPE@',str(recipe))
    if os.path.lexists(UNIT):
        info=UNIT.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=OWNER or info.st_mode&0o022:
            raise ValueError('Unsafe existing startup service')
    if UNIT.exists() and UNIT.read_text()!=unit:
        old=UNIT.read_text()
        match=re.search(r'ExecStart=/usr/bin/python3 -B (/opt/waitron-disposable-[a-zA-Z0-9_-]+)/startup.py',old)
        if not match or old!=(recipe/'waitron-disposable-startup.service.in').read_text().replace('@RECIPE@',match[1]):
            raise ValueError('Existing startup service belongs to another installation')
    command(['bash',str(recipe/'bootstrap-host.sh'),'--metadata'])
    command(['bash',str(recipe/'bootstrap-host.sh'),'--install',str(recipe/'host-packages.txt')])
    command(['bash',str(recipe/'harden-ssh.sh')])
    command(['python3','-B',str(recipe/'host.py'),'prepare-image'])
    descriptor,name=tempfile.mkstemp(prefix='.waitron-startup-',suffix='.service',dir=UNIT.parent)
    candidate=Path(name)
    try:
        with os.fdopen(descriptor,'w') as output:
            output.write(unit);output.flush();os.fsync(output.fileno())
        command(['systemd-analyze','verify',str(candidate)])
        candidate.chmod(0o644);os.replace(candidate,UNIT)
    finally:
        candidate.unlink(missing_ok=True)
    command(['systemctl','daemon-reload'])
    command(['systemctl','enable',UNIT.name])
    command(['systemctl','restart',UNIT.name])
    command(['python3','-B',str(recipe/'image.py'),'build','dt-tools-'+str(os.getpid())+'-0-1'],timeout=1260)
    return dict(installed=str(recipe),files=plan['files'])


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan',action='store_true')
    parser.add_argument('recipe')
    parser.add_argument('peers',nargs='+')
    args=parser.parse_args()
    plan=installation(args.recipe,args.peers)
    print(json.dumps(plan if args.plan else install(plan)))
