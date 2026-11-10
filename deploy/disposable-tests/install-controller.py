#!/usr/bin/env python3
"""Stage a private controller release without starting a second controller."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import shlex
import subprocess
import tempfile

SOURCE = Path(__file__).resolve().parents[2]
OPT = Path('/opt')
ROOT = Path('/var/lib/waitron-disposable-controller')
HOME = Path('/root')
OWNER = 0
NODE = '/opt/waitron-controller-node-v26.13.0/bin/node'
UNITS = Path('/etc/systemd/system')
NODE_ARCHIVE_SHA = 'd28a96af6c38596f6d9d97c0ee531c13d238d757742387d1928de822d959e997'


def command(argv, timeout=300):
    return subprocess.run(argv,check=True,capture_output=True,text=True,timeout=timeout).stdout


def write(path, data, mode):
    if os.path.lexists(path):
        info=path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=OWNER or info.st_mode&0o777&~mode or path.read_bytes()!=data:
            raise ValueError('Existing controller file differs: '+str(path))
        return
    path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    with path.open('xb') as output:
        output.write(data);output.flush();os.fsync(output.fileno())
    path.chmod(mode)


def install(plan, app_env, app_key):
    if os.geteuid()!=OWNER:
        raise ValueError('Dedicated root controller required')
    release=Path(plan['release']);config=plan['configuration']
    if release.parent!=OPT or not re.fullmatch(r'waitron-disposable-controller-[a-zA-Z0-9_-]+',release.name):
        raise ValueError('Invalid frozen controller path')
    if not all(0<len(value)<=65536 for value in (app_env,app_key)):
        raise ValueError('Invalid private App input size')
    if config['ci']['appEnv']!=str(ROOT/'app.env') or config['ci']['appKey']!=str(ROOT/'app.key'):
        raise ValueError('App credentials must stay outside the release')
    ROOT.mkdir(mode=0o700,parents=True,exist_ok=True)
    write(ROOT/'app.env',app_env,0o600);write(ROOT/'app.key',app_key,0o600)
    ssh=HOME/'.ssh';ssh.mkdir(mode=0o700,parents=True,exist_ok=True)
    key=ssh/'waitron-controller'
    if not os.path.lexists(key):
        command(['ssh-keygen','-q','-t','ed25519','-N','','-f',str(key)])
    info=key.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid!=OWNER or info.st_mode&0o077:
        raise ValueError('Unsafe controller SSH identity')
    write(ssh/'waitron-controller-known_hosts',plan['knownHosts'].encode(),0o600)
    hosts=sorted(set(config.get('slotHosts',[config['host']])))
    if not all(re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9.:-]*',host) for host in hosts):
        raise ValueError('Invalid controller SSH targets')
    ssh_config='Host '+' '.join(hosts)+'\n  IdentityFile '+str(key)+'\n  IdentitiesOnly yes\n  UserKnownHostsFile '+str(ssh/'waitron-controller-known_hosts')+'\n'
    write(ssh/'config',ssh_config.encode(),0o600)
    for area in ('scripts/disposable-tests','deploy/disposable-tests'):
        for path in (SOURCE/area).rglob('*'):
            if path.is_symlink():
                raise ValueError('Controller release contains a link')
            if path.is_file():
                write(release/path.relative_to(SOURCE),path.read_bytes(),0o500 if path.suffix=='.sh' else 0o400)
    write(release/'config.json',(json.dumps(config)+'\n').encode(),0o400)
    for path in sorted(release.rglob('*'),reverse=True):
        if path.is_dir():path.chmod(0o500)
    release.chmod(0o500)
    return dict(release=str(release),configuration=str(release/'config.json'),node=NODE,
                publicKey=key.with_suffix('.pub').read_text().strip())


def activate(receipt):
    configuration=Path(receipt['configuration']);config=json.loads(configuration.read_text())
    state=Path(config['state'])
    if os.path.lexists(state):
        raise ValueError('Activation requires fresh controller state')
    state.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    command(['/usr/bin/python3','-I','-B',str(Path(receipt['release'])/'deploy/disposable-tests/mac-controller.py'),receipt['node'],str(configuration),'--bootstrap'])
    previous=None
    service=UNITS/'waitron-disposable-controller.service'
    if os.path.lexists(service):
        info=service.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid!=OWNER or info.st_mode&0o022:
            raise ValueError('Unsafe installed controller service')
        lines=[line.removeprefix('ExecStart=') for line in service.read_text().splitlines() if line.startswith('ExecStart=')]
        if len(lines)!=1:raise ValueError('Unknown controller service')
        args=shlex.split(lines[0]);old_release=Path(args[3]).parents[2] if len(args)==7 else Path('/')
        if old_release.parent!=OPT or args[:3]!=['/usr/bin/python3','-I','-B'] or args[6]!='--once' or args[5]!=str(old_release/'config.json'):
            raise ValueError('Controller service belongs to another installation')
        previous=(old_release,args[4],args[5])
    for suffix in ('service','timer'):
        filename='waitron-disposable-controller.'+suffix
        def rendered(release,node,path):
            return (Path(release)/'deploy/disposable-tests'/(filename+'.in')).read_text().replace('@RELEASE@',str(release)).replace('@NODE@',node).replace('@CONFIGURATION@',path).replace('@STATE@',json.loads(Path(path).read_text())['state'])
        body=rendered(receipt['release'],receipt['node'],str(configuration));unit=UNITS/filename
        if os.path.lexists(unit):
            info=unit.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_uid!=OWNER or info.st_mode&0o022 or not previous or unit.read_text()!=rendered(*previous):
                raise ValueError('Unknown installed controller unit')
        fd,name=tempfile.mkstemp(prefix='.waitron-controller-',suffix='.'+suffix,dir=UNITS)
        candidate=Path(name)
        try:
            with os.fdopen(fd,'w') as output:output.write(body);output.flush();os.fsync(output.fileno())
            candidate.chmod(0o644);command(['systemd-analyze','verify',str(candidate)]);os.replace(candidate,unit)
        finally:candidate.unlink(missing_ok=True)
    command(['systemctl','daemon-reload'])
    command(['systemctl','enable','--now','waitron-disposable-controller.timer'])
    command(['systemctl','start','waitron-disposable-controller.service'])


def prepare_runtime():
    command(['bash',str(SOURCE/'deploy/disposable-tests/bootstrap-host.sh'),'--metadata'],timeout=200)
    pins={'git':'1:2.47.3-0+deb13u1','python3':'3.13.5-1'}
    command(['timeout','300','apt-get','-o','Dpkg::Lock::Timeout=10','-o','Acquire::Retries=1','-o','Acquire::http::Timeout=15','-o','Acquire::https::Timeout=15','install','--no-install-recommends','-y',*[name+'='+version for name,version in pins.items()]],timeout=310)
    for name,version in pins.items():
        if command(['dpkg-query','-W','-f=${Version}',name]).strip()!=version:
            raise ValueError('Controller package pin differs: '+name)
    node=Path(NODE)
    if not node.exists():
        with tempfile.TemporaryDirectory(prefix='waitron-controller-node-') as directory:
            archive=Path(directory)/'node.tar.xz'
            command(['curl','--fail','--silent','--show-error','--location','--proto','=https','--proto-redir','=https','--retry','2','--retry-delay','1','--connect-timeout','10','--max-time','60','--max-filesize','134217728','https://nodejs.org/dist/v26.13.0/node-v26.13.0-linux-x64.tar.xz','-o',str(archive)],timeout=190)
            if hashlib.sha256(archive.read_bytes()).hexdigest()!=NODE_ARCHIVE_SHA:
                raise ValueError('Controller Node archive integrity mismatch')
            command(['tar','--extract','--xz','--file',str(archive),'--directory',directory,'--no-same-owner'])
            node.parent.parent.parent.mkdir(mode=0o755,parents=True,exist_ok=True)
            os.rename(Path(directory)/'node-v26.13.0-linux-x64',node.parent.parent)
    if command([NODE,'--version']).strip()!='v26.13.0':
        raise ValueError('Controller Node version differs')
    return NODE
