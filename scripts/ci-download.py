"""Bound CI downloads and stop only the descendants of each owned attempt."""

import argparse
import ctypes
import errno
import fcntl
import os
import signal
import subprocess
import sys
import time


def owned_children():
    with open(f'/proc/self/task/{os.getpid()}/children') as handle:
        return [int(pid) for pid in handle.read().split()]


def adopt_descendants():
    if sys.platform != 'linux':
        return False
    if not hasattr(os, 'pidfd_open') or not hasattr(signal, 'pidfd_send_signal'):
        raise RuntimeError('Linux process ownership tracking is unavailable')
    # Reparent orphaned descendants here even when dpkg starts another session.
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))
    owned_children()
    return True


def stop_adopted(child, grace):
    deadline = time.monotonic() + grace
    term_deadline = deadline - min(1, grace / 2)
    while True:
        child.poll()
        children = owned_children()
        for pid in children:
            if pid != child.pid:
                try:
                    os.waitpid(pid, os.WNOHANG)
                except ChildProcessError:
                    pass
            handle = None
            try:
                handle = os.pidfd_open(pid)
                with open(f'/proc/{pid}/status') as status:
                    parent = next(int(line.split()[1]) for line in status if line.startswith('PPid:'))
                # Check parentage after opening the stable process handle; PID reuse
                # must never turn a stale child number into an unrelated target.
                if parent == os.getpid():
                    sig = signal.SIGTERM if time.monotonic() < term_deadline else signal.SIGKILL
                    signal.pidfd_send_signal(handle, sig)
            except (ProcessLookupError, FileNotFoundError):
                pass
            except OSError:
                # A process can finish between enumeration and signalling. The
                # final child set, rather than a stale syscall error, proves exit.
                pass
            finally:
                if handle is not None:
                    os.close(handle)
        child.poll()
        if not owned_children():
            return True
        if time.monotonic() >= deadline:
            return False
        time.sleep(min(0.01, max(0, deadline - time.monotonic())))


def stop_attempt(child, grace, adopted=False):
    if adopted:
        return stop_adopted(child, grace)
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
    try:
        child.wait(timeout=grace)
    except subprocess.TimeoutExpired:
        return False
    return True


def wait_for_locks(paths, seconds, cancelled=lambda: False):
    deadline = time.monotonic() + seconds
    while True:
        if cancelled():
            return False
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

    adopted = adopt_descendants()
    cancel_signal = None

    def cancelled(signum, _frame):
        nonlocal cancel_signal
        # Signals record intent; raising here can interrupt forced cleanup.
        if cancel_signal is None:
            cancel_signal = signum

    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, cancelled)
    for attempt in range(1, args.attempts + 1):
        if not wait_for_locks(args.lock, args.lock_wait, lambda: cancel_signal is not None):
            if cancel_signal is not None:
                return 128 + cancel_signal
            print('Package-manager lock is still held; refusing another install attempt', flush=True)
            return 1
        print(f'Download attempt {attempt}/{args.attempts}', flush=True)
        if cancel_signal is not None:
            return 128 + cancel_signal
        child = None
        cleanup_confirmed = True
        try:
            child = subprocess.Popen(command, start_new_session=True)
            deadline = time.monotonic() + args.timeout
            while child.poll() is None and cancel_signal is None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    break
                try:
                    child.wait(timeout=min(0.05, remaining))
                except subprocess.TimeoutExpired:
                    pass
            status = child.poll()
            if status is None:
                status = 124
                if cancel_signal is None:
                    print('Download attempt exceeded its time limit; stopping its descendants', flush=True)
        finally:
            if child is not None:
                cleanup_confirmed = stop_attempt(child, args.grace, adopted)
        if not cleanup_confirmed:
            print('Attempt cleanup is unconfirmed; refusing another install attempt', flush=True)
            return 1
        if cancel_signal is not None:
            return 128 + cancel_signal
        if status == 0:
            return 0
        if attempt < args.attempts:
            deadline = time.monotonic() + args.retry_delay
            while cancel_signal is None and time.monotonic() < deadline:
                time.sleep(min(0.05, max(0, deadline - time.monotonic())))
            if cancel_signal is not None:
                return 128 + cancel_signal
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
