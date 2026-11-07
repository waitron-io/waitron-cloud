#!/usr/bin/env python3
"""Serialize the trusted Mac controller and recover before admitting local work."""
import fcntl
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys


def main(argv):
    if len(argv) < 3:
        raise ValueError('Usage: mac-controller.py ABSOLUTE_NODE CONFIG --once | LANE CHECKOUT -- COMMAND [ARGS]')
    node, configuration, *args = argv
    if not Path(node).is_absolute() or not Path(configuration).is_absolute():
        raise ValueError('Node and immutable configuration need absolute paths')
    config = json.loads(Path(configuration).read_text())
    state = Path(config['state'])
    if not state.is_absolute():
        raise ValueError('State needs an absolute path')
    state.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = state.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError('State must be a private owned directory')
    fd = os.open(state / 'mac-controller.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise ValueError('Controller lock must be a private owned file')
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('Disposable tests: Mac controller busy', flush=True)
            return 75
        script = Path(__file__).resolve().parents[2] / 'scripts/disposable-tests/manual.mjs'
        environment = {key: value for key, value in os.environ.items() if key not in ('NODE_OPTIONS', 'NODE_PATH', 'PYTHONPATH', 'PYTHONHOME')}
        environment['WAITRON_DISPOSABLE_LOCK_FD'] = str(fd)
        child = None
        cancelled = False
        def cancel(signum, _frame):
            nonlocal cancelled
            cancelled = True
            if child is not None:
                try:
                    child.send_signal(signum)
                except ProcessLookupError:
                    pass
        previous = {signum: signal.signal(signum, cancel) for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP)}
        try:
            # Node inherits the open lock, so launcher death cannot unlock live work.
            def run(arguments):
                nonlocal child
                if cancelled:
                    return 143
                child = subprocess.Popen([node, str(script), configuration, *arguments], cwd='/',
                                         env=environment, pass_fds=(fd,))
                if cancelled:
                    child.send_signal(signal.SIGTERM)
                result = child.wait()
                child = None
                return 143 if cancelled else result if result >= 0 else 128 - result
            if args == ['--once']:
                return run(['--reconcile'])
            if args[:1] != ['--recover']:
                result = run(['--reconcile'])
                if result != 0:
                    return result
            return run(args)
        finally:
            for signum, handler in previous.items():
                signal.signal(signum, handler)
    finally:
        os.close(fd)


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except (OSError, ValueError, KeyError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(125)
