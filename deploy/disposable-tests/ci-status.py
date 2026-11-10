#!/usr/bin/env python3
"""Read the installed disposable CI controller without changing its state."""
import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import ipaddress
import json
import os
from pathlib import Path
import plistlib
import re
import shlex
import subprocess
import sys
import time
from xml.parsers.expat import ExpatError

UNKNOWN = 'unknown'


def command(args, deadline, **kwargs):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        return None
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=remaining, **kwargs)
        return result.stdout if result.returncode == 0 else None
    except (OSError, UnicodeError, subprocess.TimeoutExpired):
        return None


def tail(path):
    with Path(path).open('rb') as stream:
        stream.seek(0, 2)
        stream.seek(max(0, stream.tell() - 1024 * 1024))
        return stream.read().decode('utf-8', errors='replace').splitlines()


def mask_ip(text):
    def replace(match):
        try:
            ipaddress.ip_address(match.group())
            return '[IP]'
        except ValueError:
            return match.group()
    return re.sub(r'(?<![\w:])[0-9a-fA-F]*:[0-9a-fA-F:.]+|(?:[0-9]{1,3}\.){3}[0-9]{1,3}', replace, text[:256])[:200]


def host_status(request):
    sys.path.insert(0, request['recipe'])
    import session
    deadline = time.monotonic() + max(0, min(4, request['budget']))
    resources = set(request['resources'])
    resources.update(p.name for p in session.CONTROL.glob('dt-*') if p.is_dir())
    def observe(resource):
        directory = session.CONTROL/resource
        result = dict(state=UNKNOWN, workerStart=UNKNOWN, executionRequested=UNKNOWN)
        try:
            if not directory.is_dir():
                result['state'] = 'absent'
            elif (directory/'result.json').is_file():
                result['state'] = 'completed'
            elif (directory/'prepared').is_file():
                result['state'] = 'prepared'
                if (directory/'command.json').is_file():
                    result['executionRequested'] = int((directory/'command.json').stat().st_mtime * 1000)
                else:
                    script = "import glob,json,os;print(json.dumps([os.path.basename(p) for p in glob.glob('/opt/actions-runner/_diag/Worker_*-utc.log')]))"
                    raw = command([*session.guest_ssh(directory), 'python3 -c '+shlex.quote(script)], deadline)
                    try:
                        names = json.loads(raw)
                        if len(names) == 1 and re.fullmatch(r'Worker_[0-9]{8}-[0-9]{6}-utc.log', names[0]):
                            result['workerStart'] = int(datetime.strptime(names[0], 'Worker_%Y%m%d-%H%M%S-utc.log').replace(tzinfo=timezone.utc).timestamp()*1000)
                    except (TypeError, ValueError):
                        pass
            else:
                result['state'] = 'preparing'
        except (OSError, ValueError, TypeError, KeyError):
            pass
        return resource, result
    with ThreadPoolExecutor(max_workers=8) as pool:
        return dict(pool.map(observe, sorted(resources)))


def collect(home=None):
    home = Path.home() if home is None else Path(home)
    deadline = time.monotonic() + 4.5
    now = int(time.time()*1000)
    result = dict(observedAt=now, slots=dict(total=UNKNOWN, busy=UNKNOWN, free=UNKNOWN), jobs=[], lastAdmission=UNKNOWN,
                  host=UNKNOWN, controller=dict(registered=UNKNOWN, state=UNKNOWN, pid=UNKNOWN, lastExit=UNKNOWN, version=UNKNOWN, recipe=UNKNOWN), errors=UNKNOWN, errorsWrittenAt=UNKNOWN)
    try:
        agent = plistlib.loads((home/'Library/LaunchAgents/com.waitron.disposable-recovery.plist').read_bytes())
        configuration = Path(agent['ProgramArguments'][5])
        config = json.loads(configuration.read_text())
        result['controller'].update(version=str(configuration.parent), recipe=config['recipe'])
        total = config['slots']
        assert type(total) is int and 1 <= total <= 16
        result['slots']['total'] = total
    except (OSError, ValueError, KeyError, IndexError, TypeError, AssertionError, ExpatError):
        return result
    observed = command(['launchctl', 'print', f'gui/{os.getuid()}/com.waitron.disposable-recovery'], deadline)
    if observed is not None:
        pid = re.search(r'^\s*pid = ([0-9]+)$', observed, re.M)
        code = re.search(r'^\s*last exit code = (-?[0-9]+)$', observed, re.M)
        result['controller'].update(registered=True, state='running' if pid else 'idle', pid=int(pid[1]) if pid else UNKNOWN,
                                    lastExit=int(code[1]) if code else UNKNOWN)
    admitted = []
    try:
        ledger = json.loads((Path(config['state'])/'ledger/state.json').read_text())
        assert ledger['version'] == 1 and ledger['hostGeneration'] == config['hostGeneration'] and len(ledger['slots']) == total
        jobs = []
        for index, slot in enumerate(ledger['slots']):
            assert type(slot['generation']) is int and slot['generation'] >= 0
            assert slot['id'] == index and slot['state'] in ['free', 'reserved', 'running', 'quarantined']
            lease = slot.get('lease')
            assert (lease is None) if slot['state'] == 'free' else (isinstance(lease, dict) and lease['generation'] == slot['generation'])
            if lease:
                assert lease['resourceId'] == f"dt-{config['hostGeneration']}-{index}-{slot['generation']}"
                assert type(lease['createdAt']) is int and type(lease['deadline']) is int and lease['deadline'] > lease['createdAt']
            intent = slot.get('ciInvocation')
            assert intent is None or isinstance(intent, dict)
            intent = intent or {}
            if slot['state'] == 'free' and not intent and not slot.get('orphanRunners'):
                continue
            lease = lease or {}
            created = lease.get('createdAt', intent.get('createdAt'))
            assert created is None or type(created) is int and created >= 0
            if lease and created is not None:
                admitted.append(created)
            identity = lease.get('ci', intent or dict(lane=lease.get('lane', UNKNOWN), turn=lease.get('turn', UNKNOWN)))
            jobs.append(dict(slot=index, state=slot['state'], job={key: identity[key] for key in ['runId', 'attempt', 'jobId', 'jobKey', 'lane', 'turn'] if key in identity}, resource=lease.get('resourceId', UNKNOWN),
                             admittedAt=created if created is not None else UNKNOWN, admissionAgeSeconds=(now-created)/1000 if created is not None else UNKNOWN,
                             expired=lease.get('deadline', now+1) <= now, start=UNKNOWN, runtimeSeconds=UNKNOWN, guestState=UNKNOWN, executionRequested=UNKNOWN,
                             pendingIntent=bool(intent), retainedRunners=bool(slot.get('orphanRunners'))))
        assert total == 1 or not ledger.get('ciInvocation') and not ledger.get('orphanRunners')
        if total == 1 and (ledger.get('ciInvocation') or ledger.get('orphanRunners')) and not jobs:
            jobs.append(dict(slot=0, state='legacy-gate', job=UNKNOWN, resource=UNKNOWN, start=UNKNOWN, runtimeSeconds=UNKNOWN, guestState=UNKNOWN, executionRequested=UNKNOWN, pendingIntent=bool(ledger.get('ciInvocation')), retainedRunners=bool(ledger.get('orphanRunners'))))
        result.update(jobs=jobs, slots=dict(total=total, busy=len(jobs), free=total-len(jobs)))
    except (OSError, ValueError, KeyError, TypeError, AssertionError):
        admitted = []
    try:
        for line in tail(agent['StandardOutPath']):
            try:
                record = json.loads(line)
                created = record.get('lease', {}).get('createdAt')
                if 'code' in record and type(created) is int and created >= 0:
                    admitted.append(created)
            except (ValueError, AttributeError):
                pass
    except (OSError, KeyError, TypeError):
        pass
    result['lastAdmission'] = max(admitted, default=UNKNOWN)
    try:
        result['errors'] = [dict(time=UNKNOWN, message=mask_ip(line)) for line in tail(agent['StandardErrorPath']) if line.strip()][-5:]
        result['errorsWrittenAt'] = int(Path(agent['StandardErrorPath']).stat().st_mtime*1000)
    except (OSError, KeyError, TypeError):
        pass
    if not isinstance(config.get('host'), str) or not config['host']:
        return result
    slot_hosts=config.get('slotHosts',[config['host']]*total)
    if not isinstance(slot_hosts,list) or len(slot_hosts)!=total or not all(isinstance(host,str) and re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9.:-]*',host) for host in slot_hosts):
        return result
    options = ['BatchMode=yes', 'StrictHostKeyChecking=yes', 'ConnectTimeout=3', 'ServerAliveInterval=15', 'ServerAliveCountMax=2',
               'ForwardAgent=no', 'ForwardX11=no', 'ClearAllForwardings=yes', 'ControlMaster=no', 'ControlPersist=600',
               'ControlPath='+str(home/'.cache/wt-ssh/%C'), 'ProxyCommand=false']
    expected={job['resource']:slot_hosts[job['slot']] for job in result['jobs'] if job['resource']!=UNKNOWN}
    def read_host(target):
        payload=dict(recipe=config['recipe'],resources=[resource for resource,host in expected.items() if host==target],budget=max(0,deadline-time.monotonic()-0.2))
        remote='python3 -B - --host '+shlex.quote(base64.b64encode(json.dumps(payload).encode()).decode())
        raw=command(['ssh',*[word for option in options for word in ['-o',option]],'root@'+target,remote],deadline,input=Path(__file__).read_text())
        try:
            values=json.loads(raw)
            assert isinstance(values,dict) and all(isinstance(value,dict) for value in values.values())
            return target,{resource:value for resource,value in values.items() if expected.get(resource,target)==target}
        except (ValueError,TypeError,AssertionError):
            return target,None
    with ThreadPoolExecutor(max_workers=len(set(slot_hosts))) as pool:
        observed=dict(pool.map(read_host,dict.fromkeys(slot_hosts)))
    if any(values is not None for values in observed.values()):
        result['host']={resource:value for values in observed.values() if values is not None for resource,value in values.items()}
        for job in result['jobs']:
            seen = (observed[slot_hosts[job['slot']]] or {}).get(job['resource'], {})
            job['guestState'] = seen.get('state', UNKNOWN)
            job['executionRequested'] = seen.get('executionRequested', UNKNOWN)
            started = seen.get('workerStart', UNKNOWN)
            if type(started) is int and 0 <= started <= now:
                job.update(start=started, runtimeSeconds=(now-started)/1000)
    return result


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--host':
        answer = host_status(json.loads(base64.b64decode(sys.argv[2])))
    else:
        answer = collect()
    print(json.dumps(answer, separators=(',', ':')))
