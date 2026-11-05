"""Prepare pinned software without invoking infrastructure commands."""

import hashlib
import json
import platform
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path
import shutil
import stat
import zipfile


def install_archive(archive, digest, member, destination):
    archive, destination = Path(archive), Path(destination)
    with archive.open('rb') as contents:
        actual = hashlib.file_digest(contents, 'sha256').hexdigest()
    if actual != digest:
        raise ValueError('Software archive checksum mismatch')
    if not member or Path(member).name != member or member in ('.', '..'):
        raise ValueError('Unsafe executable member')
    with zipfile.ZipFile(archive) as package:
        matches = [entry for entry in package.infolist() if entry.filename == member]
        if len(matches) != 1:
            raise ValueError('Archive must contain exactly one executable member')
        entry = matches[0]
        kind = stat.S_IFMT(entry.external_attr >> 16)
        if kind not in (0, stat.S_IFREG) or not 0 < entry.file_size <= 1024**3:
            raise ValueError('Unsupported executable archive entry')
        destination.parent.mkdir(parents=True, exist_ok=True)
        with package.open(entry) as source, destination.open('xb') as output:
            shutil.copyfileobj(source, output, length=1024*1024)
        destination.chmod(0o755)


def official_url(url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https':
        raise ValueError('Software downloads require HTTPS')
    if parsed.username is not None or parsed.password is not None:
        raise ValueError('URL credentials are forbidden')
    if parsed.hostname not in ('github.com', 'release-assets.githubusercontent.com', 'releases.hashicorp.com') or parsed.port not in (None, 443):
        raise ValueError('Software source must be an official distribution host')


class OfficialRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        official_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def download(url, destination, *, open_url=None, clock=None, max_bytes=256*1024*1024):
    official_url(url)
    if open_url is None:
        # Software downloads never inherit host proxy credentials or custom handlers.
        open_url = urllib.request.build_opener(urllib.request.ProxyHandler({}), OfficialRedirect()).open
    clock = clock or time.monotonic
    deadline = clock() + 180
    destination = Path(destination)
    created = False
    try:
        with open_url(url, timeout=15) as response:
            official_url(response.geturl())
            with destination.open('xb') as output:
                created = True
                size = 0
                while True:
                    if clock() >= deadline:
                        raise TimeoutError('Software download deadline exceeded')
                    chunk = response.read(1024*1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > max_bytes:
                        raise ValueError('Software download size limit exceeded')
                    output.write(chunk)
    except BaseException:
        if created:
            destination.unlink()
        raise


def prepare(destination, *, architecture=None, fetch=download):
    architecture = architecture or platform.machine()
    architecture = {'aarch64': 'arm64', 'x86_64': 'amd64'}.get(architecture, architecture)
    if architecture not in ('amd64', 'arm64'):
        raise ValueError('Unsupported software architecture')
    pins = json.loads(Path(__file__).with_name('tools-pins.json').read_text())
    destination = Path(destination)
    with tempfile.TemporaryDirectory(prefix='cloud-aws-software-') as scratch:
        for name in ('tofu', 'aws'):
            pin = pins[name]['platforms'][architecture]
            archive = Path(scratch)/(name+'.zip')
            fetch(pin['url'], archive)
            if name == 'tofu':
                target = destination/'bin/tofu'
            else:
                target = destination/'provider-mirror/registry.opentofu.org/hashicorp/aws'/pins[name]['version']/('linux_'+architecture)/pin['member']
            install_archive(archive, pin['sha256'], pin['member'], target)


if __name__ == '__main__':
    prepare('/opt/software')
