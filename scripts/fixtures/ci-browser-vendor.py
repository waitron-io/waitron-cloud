"""Exercise vendor index publication with isolated real APT and signed local data."""

import datetime
import functools
import gzip
import hashlib
import http.server
import json
import os
from pathlib import Path
import pwd
import subprocess
import sys
import tempfile
import threading


def run(command, **kwargs):
    return subprocess.run(command, check=True, capture_output=True, text=True,
                          timeout=15, **kwargs).stdout


with tempfile.TemporaryDirectory(prefix='cloud-browser-vendor-') as directory:
    root = Path(directory)
    keys = root / 'keys'
    keys.mkdir(mode=0o700)
    server = None
    try:
        run(['gpg', '--homedir', str(keys), '--batch', '--pinentry-mode', 'loopback',
             '--passphrase', '', '--quick-generate-key', 'Cloud vendor fixture', 'rsa2048', 'sign', '0'])
        keyring = root / 'archive.gpg'
        keyring.write_bytes(subprocess.check_output(['gpg', '--homedir', str(keys), '--export']))
        archive = root / 'archive'
        content = (b'Package: cloud-vendor-fixture\nVersion: 1.0\nArchitecture: amd64\n'
                   b'Maintainer: Cloud fixture <fixture@example.invalid>\n'
                   b'Description: isolated signed vendor index\n\n')
        compressed = gzip.compress(content, mtime=0)
        digest = hashlib.sha256(compressed).hexdigest()
        for name in ('ubuntu', 'vendor'):
            suite = archive / name / 'dists/noble'
            indexes = suite / 'main/binary-amd64'
            indexes.mkdir(parents=True)
            (indexes / 'Packages').write_bytes(content)
            (indexes / 'Packages.gz').write_bytes(compressed)
            hashed = indexes / 'by-hash/SHA256' / digest
            hashed.parent.mkdir(parents=True)
            hashed.write_bytes(compressed)
            release = suite / 'Release'
            release.write_text('Origin: Cloud vendor fixture\nLabel: Cloud vendor fixture\n'
                               'Suite: noble\nCodename: noble\nArchitectures: amd64\nComponents: main\n'
                               'Acquire-By-Hash: yes\n'
                               f'Date: {datetime.datetime.now(datetime.timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")}\n'
                               'SHA256:\n'
                               f' {hashlib.sha256(content).hexdigest()} {len(content)} main/binary-amd64/Packages\n'
                               f' {digest} {len(compressed)} main/binary-amd64/Packages.gz\n')
            run(['gpg', '--homedir', str(keys), '--batch', '--yes', '--clearsign',
                 '--output', str(suite / 'InRelease'), str(release)])
        vendor = archive / 'vendor/dists/noble/main/binary-amd64'
        # Stable filenames represent a stale CDN object; immutable paths retain the signed bytes.
        (vendor / 'Packages.gz').write_bytes(bytes([compressed[0] ^ 1]) + compressed[1:])
        (vendor / 'Packages').write_bytes(content.replace(b'1.0', b'0.9'))
        requests = []

        class Handler(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_GET(self):
                requests.append(self.path)
                super().do_GET()

        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0),
                    functools.partial(Handler, directory=str(archive)))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f'http://127.0.0.1:{server.server_port}'
        apt = root / 'apt'
        (apt / 'apt.conf.d').mkdir(parents=True)
        source = (f'deb [arch=amd64 signed-by={keyring}] https://archive.ubuntu.com/ubuntu noble main\n'
                  f'deb [arch=amd64 signed-by={keyring}] {base}/vendor noble main\n')
        source_file = apt / 'sources.list'
        if '--deb822' in sys.argv:
            source_file = apt / 'sources.list.d/fixture.sources'
            source_file.parent.mkdir()
            source = (f'Types: deb\nURIs: https://archive.ubuntu.com/ubuntu\nSuites: noble\n'
                      f'Components: main\nArchitectures: amd64\nSigned-By: {keyring}\n\n'
                      f'Types: deb\nURIs: {base}/vendor\nSuites: noble\nComponents: main\n'
                      f'Architectures: amd64\nSigned-By: {keyring}\n')
        source_file.write_text(source)
        run([sys.executable, 'scripts/ci-browser-source.py', '--apt-root', str(apt)])
        mirrors = apt / 'waitron-browser-mirrors.txt'
        mirrors.write_text(f'{base}/ubuntu\n')
        bootstrap = root / 'apt.conf'
        bootstrap.write_text(f'Dir::Etc::parts "{apt}/apt.conf.d";\nDir::Etc::main "-";\n')
        os.environ['APT_CONFIG'] = str(bootstrap)
        signed = archive / 'vendor/dists/noble/InRelease'
        original_signed = signed.read_bytes()
        hashed = vendor / 'by-hash/SHA256' / digest
        outcomes = {}
        for mode in ('stable', 'candidate', 'hash', 'signature'):
            state = root / mode
            (state / 'lists/partial').mkdir(parents=True)
            (state / 'cache/archives/partial').mkdir(parents=True)
            hashed.write_bytes(bytes([compressed[0] ^ 1]) + compressed[1:] if mode == 'hash' else compressed)
            signed.write_bytes(original_signed.replace(b'Origin: Cloud vendor fixture', b'Origin: Wrong vendor fixture')
                               if mode == 'signature' else original_signed)
            options = ['-o', f'Dir::Etc::sourcelist={source_file}', '-o', 'Dir::Etc::sourceparts=-',
                       '-o', f'Dir::State={state}', '-o', f'Dir::State::lists={state}/lists',
                       '-o', f'Dir::Cache={state}/cache', '-o', 'Acquire::Languages=none',
                       '-o', 'APT::Update::Error-Mode=any',
                       '-o', f'APT::Sandbox::User={pwd.getpwuid(os.getuid()).pw_name}']
            if mode == 'stable':
                options.extend(['-o', 'Acquire::By-Hash=false'])
            start = len(requests)
            result = subprocess.run(['apt-get', *options, 'update'], capture_output=True, text=True, timeout=10)
            log = result.stdout + result.stderr
            observed = requests[start:]
            if mode == 'candidate':
                assert result.returncode == 0, log
                assert f'/vendor/dists/noble/main/binary-amd64/by-hash/SHA256/{digest}' in observed, observed
                assert '/vendor/dists/noble/main/binary-amd64/Packages.gz' not in observed, observed
                assert '/ubuntu/dists/noble/main/binary-amd64/Packages.gz' in observed, observed
                assert not any('/ubuntu/' in path and '/by-hash/' in path for path in observed), observed
                outcomes['vendorByHashSucceeded'] = True
            else:
                assert result.returncode != 0, log
                assert ('BADSIG' if mode == 'signature' else 'Hash Sum mismatch') in log, log
                outcomes[{'stable': 'stableMismatchRefused', 'hash': 'alteredHashRefused',
                          'signature': 'alteredSignatureRefused'}[mode]] = True
        print(json.dumps(outcomes))
    finally:
        if server:
            server.shutdown()
            server.server_close()
        subprocess.run(['gpgconf', '--homedir', str(keys), '--kill', 'gpg-agent'],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
