#!/usr/bin/env python3
"""Run candidate commands only inside the disposable guest."""
import os
import signal
import subprocess
import time


def execute(request, directory):
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
        child = subprocess.Popen(argv, cwd=directory, start_new_session=True)
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


if __name__ == '__main__':
    import json
    from pathlib import Path
    import re
    import sys
    try:
        identity = Path('/var/lib/cloud/data/instance-id')
        if (len(sys.argv) != 2 or not identity.is_file() or
                not re.fullmatch(r'dt-[A-Za-z0-9_-]+-0-[1-9][0-9]*', sys.argv[1]) or
                identity.read_text().strip() != sys.argv[1]):
            raise ValueError('The command entry point requires a disposable guest')
        raw = sys.stdin.buffer.read(5*1024*1024+1)
        if len(raw) > 5*1024*1024:
            raise ValueError('Command request byte limit exceeded')
        sys.exit(execute(json.loads(raw), '/work/source'))
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(125)
