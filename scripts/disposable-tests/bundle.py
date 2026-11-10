#!/usr/bin/env python3
"""Wrap already prepared source and package bytes; never inspect candidate code."""
import importlib.util
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import sys
import tarfile


spec = importlib.util.spec_from_file_location('private_packages', Path(__file__).with_name('private-packages.py'))
packages = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packages)
PACKAGE_FILES = {package['file'] for package in packages.PACKAGES}


def create(source, output, private_packages, request):
    sources = []
    published = False
    try:
        names = [Path(path).name for path in private_packages]
        if not names or len(names) != len(set(names)) or not set(names) <= PACKAGE_FILES:
            raise ValueError('Bundle needs reviewed private filenames without duplicates')
        for name, path, limit in [('source.tar', source, 512*1024*1024),
                                  *[(Path(path).name, path, 64*1024*1024) for path in private_packages]]:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            raw = os.fdopen(fd, 'rb')
            sources.append((name, raw))
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > limit:
                raise ValueError('Bundle input must be a bounded regular file without links')
        if hashlib.file_digest(sources[0][1], 'sha256').hexdigest() != request['snapshot']:
            raise ValueError('Snapshot digest mismatch')
        sources[0][1].seek(0)
        data = json.dumps(request).encode()
        if len(data) > 65536:
            raise ValueError('Turn request byte limit exceeded')
        with open(output, 'xb') as destination:
            published = True
            with tarfile.open(fileobj=destination, mode='w', format=tarfile.USTAR_FORMAT) as archive:
                entry = tarfile.TarInfo('request.json')
                entry.size = len(data)
                archive.addfile(entry, io.BytesIO(data))
                for name, raw in sources:
                    entry = tarfile.TarInfo(name)
                    entry.size = os.fstat(raw.fileno()).st_size
                    archive.addfile(entry, raw)
            destination.flush()
            os.fsync(destination.fileno())
    except BaseException:
        if published:
            Path(output).unlink()
        raise
    finally:
        for _, raw in sources:
            raw.close()


def receive(directory):
    header=sys.stdin.buffer.readline(32)
    if not header.endswith(b'\n') or not header.strip().isdigit():
        raise ValueError('Invalid manual upload length')
    size=int(header)
    if not 0<size<=641*1024*1024:
        raise ValueError('Manual upload byte limit exceeded')
    archive_path=Path(directory)/'upload.tar'
    with archive_path.open('xb') as output:
        while size:
            block=sys.stdin.buffer.read(min(size,1024*1024))
            if not block:raise EOFError('Manual upload disconnected')
            output.write(block);size-=len(block)
    limits={'request.json':65536,'source.tar':512*1024*1024,**{name:64*1024*1024 for name in PACKAGE_FILES}}
    required={'request.json','source.tar'}
    with tarfile.open(archive_path,'r:') as archive:
        for entry in archive:
            if entry.name not in limits or not entry.isfile() or entry.pax_headers or not 0<=entry.size<=limits.pop(entry.name):
                raise ValueError('Invalid manual upload member')
            with archive.extractfile(entry) as source,(Path(directory)/entry.name).open('xb') as output:
                while block:=source.read(1024*1024):output.write(block)
    archive_path.unlink()
    if required & limits.keys() or not any(name.startswith('ui-core-') and name not in limits for name in PACKAGE_FILES):
        raise ValueError('Incomplete manual upload')
    request=json.loads((Path(directory)/'request.json').read_bytes())
    if set(request)!={'snapshot','argv'}:
        raise ValueError('Invalid manual request fields')
    with (Path(directory)/'source.tar').open('rb') as source:
        if hashlib.file_digest(source,'sha256').hexdigest()!=request['snapshot']:
            raise ValueError('Manual snapshot digest mismatch')
    return request


if __name__ == '__main__':
    try:
        if len(sys.argv)==3 and sys.argv[1]=='--receive':
            print(json.dumps(receive(sys.argv[2])));sys.exit(0)
        if len(sys.argv) < 4:
            raise ValueError('Usage: bundle.py SOURCE OUTPUT PRIVATE_PACKAGE...')
        create(sys.argv[1], sys.argv[2], sys.argv[3:], json.loads(sys.stdin.buffer.read(65537)))
    except EOFError as error:
        print(str(error),file=sys.stderr);sys.exit(143)
    except (OSError, ValueError, KeyError, tarfile.TarError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(125)
