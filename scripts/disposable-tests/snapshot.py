#!/usr/bin/env python3
"""Copy source as data, without following candidate-controlled filesystem links."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import sys
import tarfile
import tempfile

MAX_BYTES = 512 * 1024 * 1024
MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_FILES = 100000


def parts(name):
    values = name.split('/')
    if (not name or len(name.encode('utf-8')) > 4096 or
            any(p in ('', '.', '..') or '\\' in p or '\0' in p for p in values) or
            PurePosixPath(name).is_absolute()):
        raise ValueError('Unsafe snapshot path')
    return values


def excluded(values):
    for value in values:
        lower = value.lower()
        if (lower in {'.git', '.ssh', '.aws', '.gnupg', '.npmrc', '.netrc',
                      'node_modules', '.pnpm-store', '.yarn', 'credentials.json',
                      'credentials', 'id_rsa', 'id_ed25519'} or
                lower.startswith('.env') or lower.endswith(('.key', '.pem', '.p12', '.pfx'))):
            return True
    return False


def open_child(root_fd, values, flags, create_parents=False, mode=0o600):
    directory_fd = os.dup(root_fd)
    try:
        for value in values[:-1]:
            if create_parents:
                try:
                    os.mkdir(value, 0o755, dir_fd=directory_fd)
                except FileExistsError:
                    pass
            next_fd = os.open(value, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                              dir_fd=directory_fd)
            os.close(directory_fd)
            directory_fd = next_fd
        return os.open(values[-1], flags | os.O_NOFOLLOW, mode, dir_fd=directory_fd)
    finally:
        os.close(directory_fd)


def create(root_name, output_name):
    root = Path(root_name).resolve(strict=True)
    output = Path(output_name).absolute()
    if Path(root_name).is_symlink() or output.resolve().is_relative_to(root):
        raise ValueError('Unsafe snapshot root or output inside checkout')
    top = subprocess.check_output(['git', '-C', str(root), 'rev-parse', '--show-toplevel'],
                                  timeout=10).decode().strip()
    if Path(top).resolve() != root:
        raise ValueError('Snapshot must name the Git checkout root')
    names = subprocess.check_output(['git', '-C', str(root), 'ls-files', '-z',
                                     '--cached', '--others', '--exclude-standard'], timeout=10)
    selected = sorted(set(n.decode('utf-8') for n in names.split(b'\0') if n))
    if len(selected) > MAX_FILES:
        raise ValueError('Snapshot file count exceeds limit')
    root_fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    temporary = None
    count, size = 0, 0
    try:
        fd, temporary = tempfile.mkstemp(prefix='.snapshot-', dir=output.parent)
        with os.fdopen(fd, 'wb') as raw, tarfile.open(fileobj=raw, mode='w', format=tarfile.USTAR_FORMAT) as archive:
            for name in selected:
                values = parts(name)
                if excluded(values):
                    continue
                try:
                    source_fd = open_child(root_fd, values, os.O_RDONLY | os.O_NONBLOCK)
                except FileNotFoundError:
                    # Tracked deletions are part of the intended working tree.
                    continue
                except OSError as error:
                    raise ValueError('Snapshot requires a regular file, never a symlink') from error
                with os.fdopen(source_fd, 'rb') as source:
                    before = os.fstat(source.fileno())
                    if not stat.S_ISREG(before.st_mode):
                        raise ValueError('Snapshot requires a regular file, never a symlink')
                    size += before.st_size
                    if before.st_size > MAX_FILE_BYTES or size > MAX_BYTES:
                        raise ValueError('Snapshot byte limit exceeded')
                    entry = tarfile.TarInfo(name)
                    entry.size = before.st_size
                    entry.mode = 0o755 if before.st_mode & 0o111 else 0o644
                    archive.addfile(entry, source)
                    after = os.fstat(source.fileno())
                    if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                        raise ValueError('Source changed during snapshot; retry with a quiet checkout')
                    count += 1
        if os.stat(temporary).st_size > MAX_BYTES:
            raise ValueError('Snapshot archive byte limit exceeded')
        with open(temporary, 'rb') as raw:
            digest = hashlib.file_digest(raw, 'sha256').hexdigest()
            os.fsync(raw.fileno())
        # Linking publishes atomically and refuses to replace an existing snapshot.
        os.link(temporary, output)
        print(json.dumps({'sha256': digest, 'files': count, 'bytes': size}))
    finally:
        os.close(root_fd)
        if temporary is not None:
            os.unlink(temporary)


def extract(archive_name, expected, destination):
    with open(archive_name, 'rb') as raw:
        if os.fstat(raw.fileno()).st_size > MAX_BYTES:
            raise ValueError('Snapshot archive byte limit exceeded')
        if len(expected) != 64 or hashlib.file_digest(raw, 'sha256').hexdigest() != expected:
            raise ValueError('Snapshot digest mismatch')
        raw.seek(0)
        with tarfile.open(fileobj=raw, mode='r:') as archive:
            members = []
            seen, size = set(), 0
            for entry in archive:
                values = parts(entry.name)
                if excluded(values):
                    raise ValueError('Excluded snapshot path')
                if entry.name in seen:
                    raise ValueError('Duplicate snapshot path')
                if not entry.isfile() or entry.mode not in (0o644, 0o755) or entry.pax_headers:
                    raise ValueError('Snapshot requires a regular file with safe mode')
                size += entry.size
                if entry.size < 0 or entry.size > MAX_FILE_BYTES or size > MAX_BYTES or len(seen) >= MAX_FILES:
                    raise ValueError('Snapshot byte or file count limit exceeded')
                seen.add(entry.name)
                members.append((entry, values))
            # Validate every member and file/directory conflict before writing any.
            for _, values in members:
                if any('/'.join(values[:i]) in seen for i in range(1, len(values))):
                    raise ValueError('Unsafe snapshot file/directory conflict')
            target_fd = os.open(destination, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                if os.listdir(target_fd):
                    raise ValueError('Snapshot destination must be empty')
                for entry, values in members:
                    fd = open_child(target_fd, values, os.O_WRONLY | os.O_CREAT | os.O_EXCL,
                                    create_parents=True)
                    with os.fdopen(fd, 'wb') as target, archive.extractfile(entry) as source:
                        remaining = entry.size
                        while remaining:
                            data = source.read(min(remaining, 1024 * 1024))
                            if not data:
                                raise ValueError('Truncated snapshot')
                            target.write(data)
                            remaining -= len(data)
                        os.fchmod(target.fileno(), entry.mode)
                print(json.dumps({'sha256': expected, 'files': len(members), 'bytes': size}))
            finally:
                os.close(target_fd)


if __name__ == '__main__':
    try:
        if len(sys.argv) == 4 and sys.argv[1] == 'create':
            create(*sys.argv[2:])
        elif len(sys.argv) == 5 and sys.argv[1] == 'extract':
            extract(*sys.argv[2:])
        else:
            raise ValueError('Usage: snapshot.py create ROOT OUTPUT | extract ARCHIVE SHA256 EMPTY_DIRECTORY')
    except (ValueError, OSError, tarfile.TarError, subprocess.SubprocessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
