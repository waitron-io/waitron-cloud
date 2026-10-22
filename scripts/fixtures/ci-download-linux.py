"""Exercise the supervisor with real Linux sessions, locks and an unrelated child."""

import fcntl
import ctypes
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time


def gone(pid):
    try:
        os.kill(pid, 0)
        return False
    except ProcessLookupError:
        return True


assert ctypes.CDLL(None).prctl(36, 1, 0, 0, 0) == 0
mode = sys.argv[2] if len(sys.argv) > 2 else 'detached'
with tempfile.TemporaryDirectory(prefix='ci-download-linux-') as directory:
    root = Path(directory)
    lock = root / 'apt.lock'
    unrelated_lock = root / 'unrelated.lock'
    foreign = subprocess.Popen([sys.executable, '-u', '-c', '''
import fcntl, sys, time
with open(sys.argv[1], 'a+') as lock:
    fcntl.lockf(lock, fcntl.LOCK_EX)
    print('LOCKED', flush=True)
    time.sleep(60)
''', str(unrelated_lock)], stdout=subprocess.PIPE, text=True)
    assert foreign.stdout.readline().strip() == 'LOCKED'
    installer = root / 'installer.py'
    installer.write_text('''
import os, pathlib, subprocess, sys, time
root = pathlib.Path(sys.argv[1])
count = root / 'attempts'
n = int(count.read_text()) + 1 if count.exists() else 1
count.write_text(str(n))
if n == 1:
    subprocess.Popen([sys.executable, '-c', """
import fcntl, os, pathlib, signal, sys, time
root = pathlib.Path(sys.argv[1])
signal.signal(signal.SIGTERM, signal.SIG_IGN)
with (root / 'apt.lock').open('a+') as lock:
    fcntl.lockf(lock, fcntl.LOCK_EX)
    (root / 'detached.pid').write_text(str(os.getpid()))
    while True: time.sleep(0.01)
""", str(root)], start_new_session=True,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    while not (root / 'detached.pid').exists(): time.sleep(0.01)
    while True: time.sleep(0.01)
(root / 'installed').write_text('yes')
''')
    detached = None
    try:
        supervisor = [sys.executable, '-I', sys.argv[1]]
        if mode != 'detached':
            wrapper = root / 'supervisor.py'
            wrapper.write_text('''
import importlib.util, os, signal, sys
spec=importlib.util.spec_from_file_location('supervisor',sys.argv[1])
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
sys.argv=sys.argv[1:]
if os.environ['PROBE_MODE']=='stale':
    children=module.owned_children
    injected=False
    def stale_children():
        global injected
        result=children()
        if result and not injected:
            injected=True
            result.append(int(os.environ['FOREIGN_PID']))
        return result
    module.owned_children=stale_children
elif os.environ['PROBE_MODE']=='unavailable':
    del os.pidfd_open
elif os.environ['PROBE_MODE']=='adoption-refused':
    class Refused:
        def prctl(self,*args):
            module.ctypes.set_errno(1)
            return -1
    module.ctypes.CDLL=lambda *args,**kwargs:Refused()
else:
    send=signal.pidfd_send_signal
    def refused_kill(handle,sig,*args):
        if sig==signal.SIGKILL: raise PermissionError('injected kernel refusal')
        return send(handle,sig,*args)
    signal.pidfd_send_signal=refused_kill
raise SystemExit(module.main())
''')
            supervisor = [sys.executable, '-I', str(wrapper), sys.argv[1]]
        result = subprocess.run([
            *supervisor, '--timeout', '0.3', '--attempts', '2',
            '--grace', '0.4', '--lock-wait', '0.2', '--retry-delay', '0.01',
            *(['--lock', str(lock)] if mode != 'uncertain' else []),
            '--', sys.executable, str(installer), str(root),
        ], env={**os.environ, 'PROBE_MODE':mode, 'FOREIGN_PID':str(foreign.pid)},
            capture_output=True, text=True, timeout=5)
        if mode in ('unavailable','adoption-refused'):
            assert result.returncode == 1, result.stdout + result.stderr
            assert not (root / 'attempts').exists(), 'unconfirmed ownership started an installer'
        elif mode == 'uncertain':
            detached = int((root / 'detached.pid').read_text())
            assert result.returncode == 1, result.stdout + result.stderr
            assert (root / 'attempts').read_text() == '1'
            assert not (root / 'installed').exists()
            assert 'cleanup is unconfirmed' in result.stdout
        else:
            detached = int((root / 'detached.pid').read_text())
            assert result.returncode == 0, result.stdout + result.stderr
            assert (root / 'attempts').read_text() == '2'
            assert (root / 'installed').read_text() == 'yes'
            assert gone(detached), 'the detached lock holder survived supervision'
        assert foreign.poll() is None, 'an unrelated holder was stopped'
        with unrelated_lock.open('a+') as handle:
            try:
                fcntl.lockf(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                pass
            else:
                raise AssertionError('the unrelated lock was released')
        if mode in ('unavailable','adoption-refused'):
            print(json.dumps({'attempts':0, 'ownershipUnavailable':True, 'unrelatedAlive':True}))
        elif mode == 'uncertain':
            print(json.dumps({'attempts':1, 'cleanupUnconfirmed':True, 'unrelatedAlive':True}))
        else:
            print(json.dumps({'attempts': 2, 'detachedGone': True, 'unrelatedAlive': True}))
    finally:
        if detached is None and (root / 'detached.pid').exists():
            detached = int((root / 'detached.pid').read_text())
        if detached is not None:
            try:
                os.kill(detached, signal.SIGKILL)
            except ProcessLookupError:
                pass
            try:
                os.waitpid(detached, 0)
            except ChildProcessError:
                pass
        foreign.kill()
        foreign.wait()
        # A deliberately broken supervisor can leave other adopted fixture children.
        deadline = time.monotonic() + 2
        children_file = Path(f'/proc/self/task/{os.getpid()}/children')
        while children_file.read_text().split():
            for value in children_file.read_text().split():
                pid = int(value)
                handle = None
                try:
                    handle = os.pidfd_open(pid)
                    with open(f'/proc/{pid}/status') as status:
                        parent = next(int(line.split()[1]) for line in status if line.startswith('PPid:'))
                    if parent == os.getpid():
                        signal.pidfd_send_signal(handle, signal.SIGKILL)
                        os.waitpid(pid, 0)
                except (ProcessLookupError, FileNotFoundError, ChildProcessError):
                    pass
                finally:
                    if handle is not None:
                        os.close(handle)
            assert time.monotonic() < deadline, 'fixture cleanup did not finish'
            time.sleep(0.01)
