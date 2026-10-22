"""Bound CI downloads and stop only the descendants of each owned attempt."""

import argparse
import errno
import fcntl
import os
import signal
import subprocess
import time


def stop_attempt(child, grace):
    # The privileged supervisor owns this session, including apt's root children.
    try:
        os.killpg(child.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        child.wait(timeout=grace)
    except subprocess.TimeoutExpired:
        pass
    # A leader can exit on TERM while a descendant keeps the package lock open.
    try:
        os.killpg(child.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    child.wait(timeout=grace)


def wait_for_locks(paths, seconds):
    deadline = time.monotonic() + seconds
    while True:
        handles = []
        try:
            for path in paths:
                try:
                    handle = open(path, 'r+')
                except FileNotFoundError:
                    continue
                handles.append(handle)
                fcntl.lockf(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except OSError as error:
            if error.errno not in (errno.EACCES, errno.EAGAIN):
                raise
        finally:
            for handle in handles:
                handle.close()
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return False
        time.sleep(min(0.1, remaining))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--timeout', type=float, required=True)
    parser.add_argument('--attempts', type=int, required=True)
    parser.add_argument('--grace', type=float, required=True)
    parser.add_argument('--lock-wait', type=float, required=True)
    parser.add_argument('--retry-delay', type=float, required=True)
    parser.add_argument('--lock', action='append', default=[])
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    if not command or args.attempts < 1 or min(args.timeout, args.grace) <= 0 or min(args.lock_wait, args.retry_delay) < 0:
        parser.error('a command, positive attempt bounds and nonnegative waits are required')

    def cancelled(signum, _frame):
        raise SystemExit(128 + signum)

    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, cancelled)
    for attempt in range(1, args.attempts + 1):
        if not wait_for_locks(args.lock, args.lock_wait):
            print('Package-manager lock is still held; refusing another install attempt', flush=True)
            return 1
        print(f'Download attempt {attempt}/{args.attempts}', flush=True)
        child = subprocess.Popen(command, start_new_session=True)
        try:
            try:
                status = child.wait(timeout=args.timeout)
            except subprocess.TimeoutExpired:
                print('Download attempt exceeded its time limit; stopping its descendants', flush=True)
                status = 124
        finally:
            stop_attempt(child, args.grace)
        if status == 0:
            return 0
        if attempt < args.attempts:
            time.sleep(args.retry_delay)
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
