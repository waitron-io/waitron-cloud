#!/usr/bin/env python3
"""Wrap already prepared source and package bytes; never inspect candidate code."""
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import sys
import tarfile


def create(source, package, output, request):
    sources = []
    published = False
    try:
        for name, path, limit in [('source.tar', source, 512*1024*1024), ('ui.tgz', package, 64*1024*1024)]:
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


if __name__ == '__main__':
    try:
        if len(sys.argv) != 4:
            raise ValueError('Usage: bundle.py SOURCE PRIVATE_PACKAGE OUTPUT')
        create(*sys.argv[1:], json.loads(sys.stdin.buffer.read(65537)))
    except (OSError, ValueError, KeyError, tarfile.TarError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(125)
