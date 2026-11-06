"""Trusted generation fencing for host-side stages and cancellation."""
from contextlib import contextmanager
import fcntl
import os
from pathlib import Path
import stat
from host import resource_id


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def directory(root, resource):
    resource_id(resource)
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = root.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
        raise ValueError('Unsafe host operation directory')
    target = root/resource
    target.mkdir(mode=0o700, exist_ok=True)
    info = target.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
        raise ValueError('Unsafe host operation directory')
    sync_directory(root.parent)
    sync_directory(root)
    return target


def fence(root, resource):
    target = directory(root, resource)
    try:
        fd = os.open(target/'closed', os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        if not (target/'closed').is_file() or (target/'closed').is_symlink():
            raise ValueError('Unsafe closed-generation record')
    else:
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    sync_directory(target)


@contextmanager
def owned(root, resource):
    target = directory(root, resource)
    fd = os.open(target/'lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
            raise ValueError('Unsafe host operation lock')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        # Closure is durable outside the live lock so cancellation can fence a
        # stage before stopping its service; a delayed worker cannot recreate it.
        if (target/'closed').exists():
            raise ValueError('This resource generation is closed')
        yield
    finally:
        os.close(fd)
