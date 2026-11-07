#!/usr/bin/env python3
"""Prepare reviewed private package bytes on the Mac; no credential leaves it."""
import base64
import hashlib
import re
import sys
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import tarfile
import urllib.request
import urllib.error
import urllib.parse


def verify(path, integrity):
    if not isinstance(integrity, str) or not re.fullmatch(r'sha512-[A-Za-z0-9+/]{86}==', integrity):
        raise ValueError('Invalid package integrity')
    expected = base64.b64decode(integrity[7:], validate=True)
    with open(path, 'rb') as source:
        actual = hashlib.file_digest(source, 'sha512').digest()
    if actual != expected:
        raise ValueError('Package integrity mismatch')


# Only reviewed releases may use workstation authentication. Candidate lockfiles
# are never parsed into authenticated URLs on the Mac.
PACKAGES = [{
    'file': 'ui-core-0.1.0.tgz',
    'url': 'https://npm.pkg.github.com/download/@waitron-io/ui-core/0.1.0/d2467965338838c9162336c791083d10d56522c9',
    'integrity': 'sha512-MzgeKuubpLe6LPEL1M6hZgWDuNSBeyQNVGnzw/J29UwKeZ/6nTKD8k/H1nrSMeOx95C/3f34eNYQtbMM8P+2ng=='
}, {
    'file': 'ui-core-0.2.1.tgz',
    'url': 'https://npm.pkg.github.com/download/@waitron-io/ui-core/0.2.1/04b5f4e9e2d872e3b1e955211bc64290beb28f58',
    'integrity': 'sha512-SzF5SF/NXCVkOwVIS9XLcVr1vQ6EOF14QHqqXs4QXRwG9dWdp3HBY1JTubRA8+Ygpx0z9Y8M0RE37Dliduy59w=='
}]


def select(snapshot):
    with tarfile.open(snapshot, 'r:') as archive:
        members = [member for member in archive if member.name == 'pnpm-lock.yaml']
        if len(members) != 1 or not members[0].isfile() or members[0].pax_headers or not 0 < members[0].size <= 8*1024*1024:
            raise ValueError('Captured snapshot needs one bounded regular lockfile')
        lock = archive.extractfile(members[0]).read().decode('utf8')
    pins = set((integrity,url) for integrity,url in re.findall(
        r'resolution: \{integrity: (sha512-[^,}]+), tarball: ([^}]+)\}',lock)
        if 'npm.pkg.github.com' in url)
    approved = {(package['integrity'],package['url']):package['file'] for package in PACKAGES}
    if len(pins) != 1 or not pins <= approved.keys():
        raise ValueError('Captured lockfile needs one approved private release; missing, unknown or mixed pins refused')
    return approved[next(iter(pins))]


class RefuseRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, newurl):
        parsed = urllib.parse.urlsplit(newurl)
        if parsed.scheme != 'https' or parsed.netloc != 'pkg-npm.githubusercontent.com':
            raise ValueError('Unapproved package redirect origin')
        # Construct a new request rather than carrying Authorization or cookies
        # to GitHub storage. The short-lived signed URL is its only authority.
        return urllib.request.Request(newurl)


def fetch(destination):
    target = Path(destination)
    target.mkdir(mode=0o700)
    try:
        token = subprocess.check_output(['gh', 'auth', 'token', '--hostname', 'github.com'],
                                        text=True, timeout=10).strip()
        if not token or any(c in token for c in '\r\n'):
            raise ValueError('Package authentication unavailable')
        opener = urllib.request.build_opener(RefuseRedirect())
        for package in PACKAGES:
            # Fail closed if a future pin accidentally changes the credential origin.
            if not re.fullmatch(r'https://npm\.pkg\.github\.com/download/@waitron-io/[A-Za-z0-9_.-]+/[0-9]+\.[0-9]+\.[0-9]+/[a-f0-9]{40}', package['url']):
                raise ValueError('Unapproved authenticated package origin')
            request = urllib.request.Request(package['url'], headers={'Authorization': 'Bearer ' + token})
            end = time.monotonic() + 60
            path = target / package['file']
            size = 0
            with opener.open(request, timeout=15) as response, path.open('xb') as output:
                while True:
                    if time.monotonic() >= end:
                        raise ValueError('Package download deadline exceeded')
                    data = response.read(65536)
                    if not data:
                        break
                    size += len(data)
                    if size > 64 * 1024 * 1024:
                        raise ValueError('Package download byte limit exceeded')
                    output.write(data)
                output.flush()
                os.fsync(output.fileno())
            verify(path, package['integrity'])
        (target / 'manifest.json').write_text(json.dumps(PACKAGES) + '\n')
        print(json.dumps({'packages': len(PACKAGES), 'directory': str(target), 'credentialsCopied': False}))
    except BaseException:
        shutil.rmtree(target)
        raise


if __name__ == '__main__':
    try:
        if len(sys.argv) == 4 and sys.argv[1] == 'verify':
            verify(sys.argv[2], sys.argv[3])
        elif len(sys.argv) == 3 and sys.argv[1] == 'select':
            print(select(sys.argv[2]))
        elif len(sys.argv) == 3 and sys.argv[1] == 'fetch':
            fetch(sys.argv[2])
        else:
            raise ValueError('Usage: private-packages.py fetch NEW_DIRECTORY | verify FILE INTEGRITY | select SOURCE_TAR')
    except (ValueError, OSError, tarfile.TarError, subprocess.SubprocessError, urllib.error.URLError) as error:
        print('Package download failed' if isinstance(error, urllib.error.URLError) else str(error), file=sys.stderr)
        sys.exit(1)
