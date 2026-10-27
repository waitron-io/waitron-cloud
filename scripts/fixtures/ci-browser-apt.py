"""Exercise real APT against a temporary signed archive, without installing packages."""

import datetime
import functools
import hashlib
import http.server
import json
import lzma
import os
from pathlib import Path
import pwd
import socket
import subprocess
import sys
import tempfile
import threading

runner_indexes = '--runner-indexes' in sys.argv
multi_component = '--multi-component' in sys.argv or runner_indexes
suites = ('noble', 'noble-updates', 'noble-backports', 'noble-security') if multi_component else ('noble',)
components = ('main', 'universe', 'restricted', 'multiverse') if multi_component else ('main',)


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
    blackhole = None
    blocker = None
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
        expected_indexes = []
        if multi_component:
            # Each suite has an independently signed release and four required indexes.
            index_bytes = index.read_bytes()
            for suite in suites:
                hashes = []
                for component in components:
                    relative = f'{component}/binary-amd64/Packages'
                    entries = [(relative, index_bytes)]
                    if runner_indexes:
                        entries.extend([(f'{component}/i18n/Translation-en',
                                         b'Package: cloud-apt-fixture\nDescription-en: '
                                         + b'isolated APT download fixture ' * 80 + b'\n\n'),
                                        (f'{component}/cnf/Commands-amd64', b'fixture command metadata\n' * 80)])
                    for name, content in entries:
                        variants = [(name, content)]
                        if runner_indexes:
                            variants.append((name + '.xz', lzma.compress(content)))
                        for filename, data in variants:
                            target = archive / 'dists' / suite / filename
                            target.parent.mkdir(parents=True, exist_ok=True)
                            target.write_bytes(data)
                            digest = hashlib.sha256(data).hexdigest()
                            hashes.append(f' {digest} {len(data)} {filename}\n')
                            if runner_indexes:
                                hashed = target.parent / 'by-hash/SHA256' / digest
                                hashed.parent.mkdir(parents=True, exist_ok=True)
                                hashed.write_bytes(data)
                                if filename.endswith('.xz'):
                                    expected_indexes.append(f'/second/dists/{suite}/{hashed.relative_to(archive / "dists" / suite)}')
                            else:
                                expected_indexes.append(f'/second/dists/{suite}/{filename}')
                target_release = archive / 'dists' / suite / 'Release'
                target_release.write_text('Origin: Cloud fixture\nLabel: Cloud fixture\n'
                                          f'Suite: {suite}\nCodename: {suite}\nArchitectures: amd64\n'
                                          f'Components: {" ".join(components)}\n'
                                          + ('Acquire-By-Hash: yes\n' if runner_indexes else '')
                                          + f'Date: {datetime.datetime.now(datetime.timezone.utc).strftime("%a, %d %b %Y %H:%M:%S +0000")}\n'
                                          'SHA256:\n' + ''.join(hashes))
                run(['gpg', '--homedir', str(keys), '--batch', '--yes', '--clearsign',
                     '--output', str(target_release.with_name('InRelease')), str(target_release)])
            original_signed = signed.read_bytes()
        cert = root / 'tls.pem'
        private = root / 'tls.key'
        run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
             '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1',
             '-keyout', str(private), '-out', str(cert)])
        # Fill this owned listener's only pending slot. Later SYNs never complete.
        blackhole = socket.socket()
        blackhole.bind(('127.0.0.2', 0))
        blackhole.listen(0)
        blocker = socket.create_connection(blackhole.getsockname(), timeout=1)
        with socket.socket() as probe:
            probe.settimeout(0.2)
            try:
                probe.connect(blackhole.getsockname())
            except TimeoutError:
                pass
            else:
                raise AssertionError('first mirror must not complete a connection')
        requests = []
        mode = 'fallback'

        class Handler(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_GET(self):
                requests.append(self.path)
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
        if multi_component:
            (apt / 'sources.list').write_text(''.join(
                f'deb [arch=amd64 signed-by={keyring}] https://archive.ubuntu.com/ubuntu {suite} {" ".join(components)}\n'
                for suite in suites))
        (apt / 'apt.conf.d').mkdir()
        # Match the runner image's late settings, including its real retry count.
        (apt / 'apt.conf.d/zz-retries').write_text('Acquire::Retries "1";\nAcquire::https::Timeout "15";\n')
        if multi_component:
            # Match ubuntu24/20261012.334's request scheduling as well as its retries.
            (apt / 'apt.conf.d/99bad_proxy').write_text('Acquire::http::Pipeline-Depth "0";\n'
                                                       'Acquire::http::No-Cache "true";\n'
                                                       'Acquire::https::Pipeline-Depth "0";\n'
                                                       'Acquire::https::No-Cache "true";\n'
                                                       'Acquire::BrokenProxy "true";\n')
        if runner_indexes:
            (apt / 'apt.conf.d/50command-not-found').write_text(
                'Acquire::Languages "en";\n'
                'Acquire::IndexTargets::deb::CNF {\n'
                ' MetaKey "$(COMPONENT)/cnf/Commands-$(NATIVE_ARCHITECTURE)";\n'
                ' ShortDescription "c-n-f Metadata";\n'
                ' Description "$(RELEASE)/$(COMPONENT) $(NATIVE_ARCHITECTURE) c-n-f Metadata";\n'
                '};\n')
        bootstrap = root / 'apt.conf'
        bootstrap.write_text(f'Dir::Etc::parts "{apt}/apt.conf.d";\nDir::Etc::main "-";\n')
        os.environ['APT_CONFIG'] = str(bootstrap)
        run([sys.executable, 'scripts/ci-browser-source.py', '--apt-root', str(apt)])
        effective = run(['apt-config', 'dump', 'Acquire::https::Timeout', 'Acquire::Retries'])
        assert 'Acquire::https::Timeout "10";' in effective, effective
        assert 'Acquire::Retries "1";' in effective, effective
        # Reproduce the old filename's precedence defect, then restore the candidate.
        generated = apt / 'apt.conf.d/zzzz-waitron-browser-mirrors'
        legacy = apt / 'apt.conf.d/99waitron-browser-mirrors'
        generated.rename(legacy)
        try:
            legacy_effective = run(['apt-config', 'dump', 'Acquire::https::Timeout'])
            assert 'Acquire::https::Timeout "15";' in legacy_effective, legacy_effective
        finally:
            legacy.rename(generated)
        mirrors = apt / 'waitron-browser-mirrors.txt'
        assert mirrors.is_file(), 'source preparation must offer an alternate archive'
        # Substitute only network endpoints and elapsed time; real APT verifies every byte.
        mirrors.write_text(mirrors.read_text().replace('https://mirror.math.princeton.edu/pub/ubuntu',
                                                       f'https://127.0.0.2:{blackhole.getsockname()[1]}/first')
                           .replace('https://archive.ubuntu.com/ubuntu', f'{base}/second'))
        config = generated
        assert config.read_text() == 'Acquire::https::Timeout "10";\n'
        config.write_text('Acquire::https::Timeout "1";\n')
        supervisor = [sys.executable, str(Path('scripts/ci-download.py').resolve()),
                      '--timeout', '8', '--attempts', '1', '--grace', '1',
                      '--lock-wait', '0', '--retry-delay', '0', '--']
        outcomes = {}
        for mode in (('fallback',) if multi_component else ('fallback', 'exhausted', 'signature', 'package-hash')):
            state = root / mode
            (state / 'lists/partial').mkdir(parents=True)
            (state / 'cache/archives/partial').mkdir(parents=True)
            signed.write_bytes(original_signed.replace(b'Origin: Cloud fixture', b'Origin: Wrong fixture')
                               if mode == 'signature' else original_signed)
            deb.write_bytes(bytes([original_deb[0] ^ 1]) + original_deb[1:] if mode == 'package-hash' else original_deb)
            options = ['-o', f'Dir::Etc::sourcelist={apt}/sources.list', '-o', 'Dir::Etc::sourceparts=-',
                       '-o', f'Dir::Etc::parts={apt}/apt.conf.d', '-o', 'Dir::Etc::main=-',
                       '-o', f'Dir::State={state}', '-o', f'Dir::State::lists={state}/lists',
                       '-o', f'Dir::Cache={state}/cache', '-o', f'Acquire::https::CAInfo={cert}',
                       '-o', 'APT::Update::Error-Mode=any',
                       '-o', f'APT::Sandbox::User={pwd.getpwuid(os.getuid()).pw_name}']
            start = len(requests)
            update = subprocess.run([*supervisor, 'apt-get', *options, 'update'], capture_output=True, text=True, timeout=12)
            log = update.stdout + update.stderr
            assert 'Download attempt exceeded' not in log, log
            assert any(path.startswith('/second/') for path in requests[start:]), log
            if mode in ('signature', 'exhausted'):
                assert update.returncode != 0, log
                if mode == 'signature':
                    assert 'BADSIG' in log, log
                else:
                    # APT retains the first connection error after exhausting its mirrors.
                    assert 'connection timed out' in log and 'Failed to fetch' in log, log
                outcomes['signatureRefused' if mode == 'signature' else 'exhaustedRefused'] = True
                continue
            assert update.returncode == 0, log
            if multi_component:
                for expected in expected_indexes:
                    assert expected in requests[start:], (expected, requests[start:], log)
                outcomes['allSixteenIndexesFetched'] = True
                if runner_indexes:
                    outcomes['allFortyEightIndexesFetched'] = True
            download = subprocess.run([*supervisor, 'apt-get', *options, 'download', 'cloud-apt-fixture=1.0'],
                                      cwd=state, capture_output=True, text=True, timeout=12)
            log = download.stdout + download.stderr
            assert 'Download attempt exceeded' not in log, log
            if mode == 'package-hash':
                assert download.returncode != 0, log
                assert 'Hash Sum mismatch' in log, log
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
        if blocker:
            blocker.close()
        if blackhole:
            blackhole.close()
        subprocess.run(['gpgconf', '--homedir', str(keys), '--kill', 'gpg-agent'],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
