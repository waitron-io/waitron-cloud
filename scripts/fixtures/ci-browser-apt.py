"""Exercise real APT against a temporary signed archive, without installing packages."""

import datetime
import functools
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
import time


def run(command, **kwargs):
    return subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                          text=True, timeout=15, **kwargs).stdout


with tempfile.TemporaryDirectory(prefix='cloud-browser-apt-') as directory:
    root = Path(directory)
    root.chmod(0o755)
    apt = root / 'apt'
    apt.mkdir()
    keys = root / 'gnupg'
    keys.mkdir(mode=0o700)
    server = None
    try:
        run(['gpg', '--homedir', str(keys), '--batch', '--pinentry-mode', 'loopback',
             '--passphrase', '', '--quick-generate-key', 'Cloud APT fixture', 'rsa2048', 'sign', '0'])
        keyring = root / 'archive.gpg'
        keyring.write_bytes(subprocess.check_output(['gpg', '--homedir', str(keys), '--export']))
        archive = root / 'archive'
        package = root / 'package'
        (package / 'DEBIAN').mkdir(parents=True)
        (package / 'DEBIAN/control').write_text('Package: cloud-apt-fixture\nVersion: 1.0\n'
                                             'Architecture: all\nMaintainer: Cloud fixture <fixture@example.invalid>\n'
                                             'Description: isolated APT download fixture\n')
        archive.mkdir()
        deb = archive / 'fixture.deb'
        run(['dpkg-deb', '--build', str(package), str(deb)])
        index = archive / 'dists/noble/main/binary-amd64/Packages'
        index.parent.mkdir(parents=True)
        original_deb = deb.read_bytes()
        index.write_text('Package: cloud-apt-fixture\nVersion: 1.0\nArchitecture: all\n'
                         'Maintainer: Cloud fixture <fixture@example.invalid>\n'
                         'Description: isolated APT download fixture\nFilename: fixture.deb\n'
                         f'Size: {len(original_deb)}\nSHA256: {hashlib.sha256(original_deb).hexdigest()}\n\n')
        release = archive / 'dists/noble/Release'
        release.write_text('Origin: Cloud fixture\nLabel: Cloud fixture\nSuite: noble\nCodename: noble\n'
                           'Architectures: amd64\nComponents: main\n'
                           f'Date: {datetime.datetime.now(datetime.timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")}\n'
                           f'SHA256:\n {hashlib.sha256(index.read_bytes()).hexdigest()} {index.stat().st_size} main/binary-amd64/Packages\n')
        signed = release.with_name('InRelease')
        run(['gpg', '--homedir', str(keys), '--batch', '--yes', '--clearsign',
             '--output', str(signed), str(release)])
        original_signed = signed.read_bytes()
        cert = root / 'tls.pem'
        private = root / 'tls.key'
        run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
             '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
             '-keyout', str(private), '-out', str(cert)])
        requests = []
        mode = 'fallback'

        class Handler(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_GET(self):
                requests.append(self.path)
                if self.path.startswith('/first/'):
                    time.sleep(2)
                    return
                if mode == 'exhausted':
                    self.send_error(503)
                    return
                self.path = self.path.removeprefix('/second')
                try:
                    super().do_GET()
                except (BrokenPipeError, ConnectionResetError):
                    pass

        import ssl
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(archive)))
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cert, private)
        server.socket = context.wrap_socket(server.socket, server_side=True)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f'https://127.0.0.1:{server.server_port}'
        (apt / 'sources.list').write_text(f'deb [arch=amd64 signed-by={keyring}] https://archive.ubuntu.com/ubuntu noble main\n')
        run([sys.executable, 'scripts/ci-browser-source.py', '--apt-root', str(apt)])
        mirrors = apt / 'waitron-browser-mirrors.txt'
        assert mirrors.is_file(), 'source preparation must offer an alternate archive'
        # Substitute only network endpoints and elapsed time; real APT verifies every byte.
        mirrors.write_text(f'{base}/first\tpriority:1\n{base}/second\tpriority:2\n')
        config = apt / 'apt.conf.d/99waitron-browser-mirrors'
        assert config.read_text() == 'Acquire::https::Timeout "10";\n'
        config.write_text('Acquire::https::Timeout "1";\n')
        supervisor = [sys.executable, str(Path('scripts/ci-download.py').resolve()),
                      '--timeout', '8', '--attempts', '1', '--grace', '1',
                      '--lock-wait', '0', '--retry-delay', '0', '--']
        outcomes = {}
        for mode in ('fallback', 'exhausted', 'signature', 'package-hash'):
            state = root / mode
            (state / 'lists/partial').mkdir(parents=True)
            (state / 'cache/archives/partial').mkdir(parents=True)
            signed.write_bytes(original_signed.replace(b'Origin: Cloud fixture', b'Origin: Wrong fixture')
                               if mode == 'signature' else original_signed)
            deb.write_bytes(original_deb + b'tampered' if mode == 'package-hash' else original_deb)
            options = ['-o', f'Dir::Etc::sourcelist={apt}/sources.list', '-o', 'Dir::Etc::sourceparts=-',
                       '-o', f'Dir::Etc::parts={apt}/apt.conf.d', '-o', 'Dir::Etc::main=-',
                       '-o', f'Dir::State={state}', '-o', f'Dir::State::lists={state}/lists',
                       '-o', f'Dir::Cache={state}/cache', '-o', f'Acquire::https::CAInfo={cert}',
                       '-o', 'Acquire::Retries=0', '-o', 'APT::Update::Error-Mode=any',
                       '-o', f'APT::Sandbox::User={pwd.getpwuid(os.getuid()).pw_name}']
            start = len(requests)
            update = subprocess.run([*supervisor, 'apt-get', *options, 'update'], capture_output=True, text=True, timeout=12)
            log = update.stdout + update.stderr
            assert any(path.startswith('/first/') for path in requests[start:]), log
            assert any(path.startswith('/second/') for path in requests[start:]), log
            if mode in ('signature', 'exhausted'):
                assert update.returncode != 0, log
                if mode == 'signature':
                    assert 'BADSIG' in log or 'invalid' in log, log
                outcomes['signatureRefused' if mode == 'signature' else 'exhaustedRefused'] = True
                continue
            assert update.returncode == 0, log
            download = subprocess.run([*supervisor, 'apt-get', *options, 'download', 'cloud-apt-fixture=1.0'],
                                      cwd=state, capture_output=True, text=True, timeout=12)
            log = download.stdout + download.stderr
            if mode == 'package-hash':
                assert download.returncode != 0, log
                assert 'Hash Sum mismatch' in log or 'unexpected size' in log, log
                outcomes['packageHashRefused'] = True
            else:
                assert download.returncode == 0, log
                assert (state / 'cloud-apt-fixture_1.0_all.deb').read_bytes() == original_deb
                outcomes['fallbackDownloaded'] = True
        print(json.dumps(outcomes))
    finally:
        if server:
            server.shutdown()
            server.server_close()
        subprocess.run(['gpgconf', '--homedir', str(keys), '--kill', 'gpg-agent'],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
