#!/usr/bin/env python3
"""Run candidate commands only inside the disposable guest."""
import os
import json
import re
import pwd
from pathlib import Path
import signal
import subprocess
import time


def execute(request, directory, environment=None, user=None, group=None, extra_groups=None):
    now = int(time.time()*1000)
    if not isinstance(request, dict) or set(request) != {'argv', 'deadline'}:
        raise ValueError('Unknown or missing command request field')
    argv, deadline = request['argv'], request['deadline']
    if (not isinstance(argv, list) or not 1 <= len(argv) <= 256 or
            any(not isinstance(v, str) or len(v) > 16384 or '\0' in v for v in argv) or not argv[0]):
        raise ValueError('Invalid command arguments')
    if type(deadline) is not int or not now < deadline <= now+3300000:
        raise ValueError('Invalid absolute command deadline')
    cancelled = 0
    def cancel(signum, frame):
        nonlocal cancelled
        cancelled = 128+signum
    previous = {sig: signal.signal(sig, cancel) for sig in (signal.SIGTERM, signal.SIGINT)}
    child = None
    end = time.monotonic()+(deadline-now)/1000
    try:
        child = subprocess.Popen(argv, cwd=directory, start_new_session=True, env=environment,
                                 user=user, group=group, extra_groups=extra_groups)
        while True:
            remaining = end-time.monotonic()
            if cancelled or remaining <= 0:
                try:
                    os.killpg(child.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    child.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    pass
                return cancelled or 124
            try:
                code = child.wait(timeout=min(0.1, remaining))
                return cancelled or (code if code >= 0 else 128-code)
            except subprocess.TimeoutExpired:
                pass
    finally:
        # Descendants cannot survive a completed or interrupted command turn.
        if child is not None:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait()
        for sig, handler in previous.items():
            signal.signal(sig, handler)


def complete(request, directory, resource, output):
    if (not isinstance(request, dict) or set(request) != {'argv', 'deadline', 'nonce'} or
            not isinstance(request['nonce'], str) or not re.fullmatch(r'[a-f0-9]{32}', request['nonce'])):
        raise ValueError('Invalid command completion nonce')
    code = execute({'argv': request['argv'], 'deadline': request['deadline']}, directory)
    receipt = {'resourceId': resource, 'nonce': request['nonce'], 'code': code}
    output = Path(output)
    output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with output.open('x') as target:
        json.dump(receipt, target)
        target.flush()
        os.fsync(target.fileno())
    return receipt


def complete_ci(request, directory, resource, output):
    if (not isinstance(request,dict) or set(request)!={'deadline','nonce','jitconfig'} or
            not isinstance(request['nonce'],str) or not re.fullmatch(r'[a-f0-9]{32}',request['nonce']) or
            not isinstance(request['jitconfig'],str) or not 1<=len(request['jitconfig'])<=64000):
        raise ValueError('Invalid CI credential input')
    try:
        account=pwd.getpwnam('runner')
    except KeyError:
        raise ValueError('The ordinary CI runner account is missing') from None
    groups=os.getgrouplist(account.pw_name,account.pw_gid)
    if account.pw_uid==0 or account.pw_gid==0 or 0 in groups:
        raise ValueError('The CI runner account must have an ordinary identity and groups')
    environment={key:value for key,value in os.environ.items()
                 if key in ('LANG','LANGUAGE','TZ') or key.startswith('LC_')}
    environment.update(HOME=account.pw_dir,USER=account.pw_name,LOGNAME=account.pw_name,
                       PATH='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',SHELL=account.pw_shell,
                       ACTIONS_RUNNER_INPUT_JITCONFIG=request['jitconfig'],
                       ACTIONS_RUNNER_RETURN_VERSION_DEPRECATED_EXIT_CODE='1')
    code=execute({'argv':['/opt/actions-runner/bin/Runner.Listener','run'],'deadline':request['deadline']},directory,
                 environment=environment,user=account.pw_uid,group=account.pw_gid,extra_groups=groups)
    receipt={'resourceId':resource,'nonce':request['nonce'],'code':code}
    output=Path(output);output.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    with output.open('x') as target:
        json.dump(receipt,target);target.flush();os.fsync(target.fileno())
    return receipt


if __name__ == '__main__':
    import json
    from pathlib import Path
    import re
    import sys
    try:
        identity = Path('/var/lib/cloud/data/instance-id')
        ci_mode=len(sys.argv)==3 and sys.argv[2]=='--ci'
        if (not (len(sys.argv)==2 or ci_mode) or not identity.is_file() or
                not re.fullmatch(r'dt-[A-Za-z0-9_-]+-(?:[0-9]|1[0-5])-[1-9][0-9]*', sys.argv[1]) or
                identity.read_text().strip() != sys.argv[1]):
            raise ValueError('The command entry point requires a disposable guest')
        raw = sys.stdin.buffer.read(5*1024*1024+1)
        if len(raw) > 5*1024*1024:
            raise ValueError('Command request byte limit exceeded')
        (complete_ci if ci_mode else complete)(json.loads(raw), '/opt/actions-runner' if ci_mode else '/work/source', sys.argv[1], '/run/waitron-disposable/result.json')
        sys.exit(0)
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(125)
