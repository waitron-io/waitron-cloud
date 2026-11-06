"""Explicit opt-in lifecycle proof on the dedicated test host, never a CI import."""
import json
import base64
import pwd
import os
import select
from pathlib import Path
import shlex
import socket
import subprocess
import sys
import tempfile
import time
import unittest

MANAGER = sys.argv.pop(1)


def qmp_request(resource, command, arguments=None):
    path = Path('/var/lib/waitron-disposable/turns') / resource / 'qmp.sock'
    with socket.socket(socket.AF_UNIX) as connection:
        connection.settimeout(3)
        connection.connect(str(path))
        with connection.makefile('rwb') as stream:
            json.loads(stream.readline(65536))
            for identity, operation, values in [('capability', 'qmp_capabilities', {}),
                                                 ('request', command, arguments or {})]:
                stream.write((json.dumps({'execute': operation, 'arguments': values, 'id': identity}) + '\n').encode())
                stream.flush()
                for _ in range(100):
                    result = json.loads(stream.readline(65536))
                    if result.get('id') == identity:
                        if 'error' in result:
                            raise ValueError(result['error'])
                        break
                else:
                    raise ValueError('QMP response missing')
            return result['return']


class GuestLifecycle(unittest.TestCase):
    def command(self, *args, **kwargs):
        return subprocess.run(args, text=True, capture_output=True, timeout=kwargs.pop('timeout', 30), **kwargs)

    def manager(self, operation, request=None):
        result = self.command('python3', MANAGER, operation,
                              input=json.dumps(request) if request else '', timeout=180)
        print(operation, result.returncode, result.stdout, result.stderr, flush=True)
        return result

    def test_isolated_boot_exit_and_fresh_successor(self):
        # A missing VM adapter, shared disk, reachable host or uncertain cleanup fails this proof.
        prepared = self.manager('prepare-image')
        self.assertEqual(prepared.returncode, 0, prepared.stderr)
        account = pwd.getpwnam('dt-slot-0')
        self.assertEqual(account.pw_uid, 62000)
        self.assertEqual(account.pw_shell, '/usr/sbin/nologin')
        with tempfile.TemporaryDirectory(prefix='disposable-runtime-') as temporary:
            key = Path(temporary) / 'key'
            generated = self.command('ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(key))
            self.assertEqual(generated.returncode, 0, generated.stderr)
            public = key.with_suffix('.pub').read_text().strip().split(' ')
            for generation in (1, 2):
                resource = f'dt-runtime-{int(time.time())}-0-{generation}'
                request = {'resourceId': resource, 'deadline': int(time.time() * 1000) + 600000,
                           'sshPublicKey': ' '.join(public[:2])}
                try:
                    created = self.manager('create', request)
                    self.assertEqual(created.returncode, 0, created.stderr)
                    observed = self.manager('inspect', {'resourceId': resource})
                    self.assertEqual(observed.returncode, 0, observed.stderr)
                    self.assertTrue(json.loads(observed.stdout)['running'])
                    busy = self.manager('create', {**request, 'resourceId': resource + '1'})
                    self.assertEqual(busy.returncode, 75, busy.stderr)
                    deadline = time.monotonic() + 120
                    known = Path(temporary) / 'known_hosts'
                    while time.monotonic() < deadline:
                        scan = self.command('ssh-keyscan', '-T', '2', '-t', 'ed25519', '-p', '22000', '127.0.0.1')
                        if scan.returncode == 0 and scan.stdout.strip():
                            known.write_text(scan.stdout)
                            break
                        time.sleep(1)
                    else:
                        self.fail('Guest SSH did not boot within 120 seconds')
                    ssh = ['ssh', '-i', str(key), '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes',
                           '-o', 'StrictHostKeyChecking=yes', '-o', f'UserKnownHostsFile={known}',
                           '-o', 'ConnectTimeout=3', '-p', '22000', 'root@127.0.0.1']
                    ready = self.command(*ssh, 'cloud-init status --wait', timeout=120)
                    self.assertEqual(ready.returncode, 0, ready.stderr)
                    serial = self.command(*ssh, "python3 -c \"open('/dev/ttyS0','wb').write(b's'*1048576+b'D592-SERIAL-END')\"")
                    self.assertEqual(serial.returncode, 0, serial.stderr)
                    turn = Path('/var/lib/waitron-disposable/turns') / resource
                    self.assertLessEqual(sum(p.stat().st_size for p in turn.glob('console*')), 16384)
                    serial_bytes = base64.b64decode(qmp_request(resource, 'ringbuf-read',
                                                    {'device': 'serial0', 'size': 16384, 'format': 'base64'}))
                    self.assertLessEqual(len(serial_bytes), 16384)
                    self.assertIn(b'D592-SERIAL-END', serial_bytes)
                    if generation == 1:
                        exit3 = self.command(*ssh, 'touch /root/predecessor; exit 3')
                        self.assertEqual(exit3.returncode, 3, exit3.stderr)
                    else:
                        clean = self.command(*ssh, 'test ! -e /root/predecessor')
                        self.assertEqual(clean.returncode, 0, clean.stderr)
                    probe = """import socket
for host,port in [('10.0.2.2',22),('169.254.169.254',80),('2.29.248.230',22),('2a01:4f9:3120:2fd2::2',22),('127.0.0.1',22000)]:
 try:
  connection=socket.create_connection((host,port),2)
 except OSError:
  print('DENIED',host,flush=True)
 else:
  connection.close();raise RuntimeError('Guest reached management: '+host)
"""
                    isolated = self.command(*ssh, 'python3 -c ' + shlex.quote(probe))
                    print(isolated.stdout, isolated.stderr, flush=True)
                    self.assertEqual(isolated.returncode, 0, isolated.stderr)
                    internet = self.command(*ssh, 'curl --fail --silent --show-error --max-time 15 https://deb.debian.org/debian/README')
                    self.assertEqual(internet.returncode, 0, internet.stderr)
                finally:
                    try:
                        qmp_path = Path('/var/lib/waitron-disposable/turns') / resource / 'qmp.sock'
                        if qmp_path.exists():
                            with socket.socket(socket.AF_UNIX) as connection:
                                connection.settimeout(3)
                                connection.connect(str(qmp_path))
                                with connection.makefile('rwb') as stream:
                                    print('QMP', stream.readline().decode().strip(), flush=True)
                                    for command in ['qmp_capabilities', 'query-status', 'query-block', 'query-cpus-fast']:
                                        stream.write((json.dumps({'execute': command}) + '\n').encode()); stream.flush()
                                        print('QMP', command, stream.readline().decode().strip(), flush=True)
                        console = Path('/var/lib/waitron-disposable/turns') / resource / 'console.log'
                        if console.is_file():
                            with console.open('rb') as source:
                                source.seek(max(0, console.stat().st_size - 16000))
                                print('GUEST CONSOLE', source.read().decode(errors='replace'), flush=True)
                    finally:
                        destroyed = self.manager('destroy', {'resourceId': resource})
                        self.assertEqual(destroyed.returncode, 0, destroyed.stderr)
                        absent = self.manager('inspect', {'resourceId': resource})
                        self.assertEqual(absent.returncode, 0, absent.stderr)
                        self.assertTrue(json.loads(absent.stdout)['absent'])


def network_path_probe():
    # Record only SYN metadata from the controller's public address, never payloads.
    source_ip = '2.47.236.171'
    capture = socket.socket(socket.AF_PACKET, socket.SOCK_RAW, socket.htons(0x0800))
    try:
        with socket.create_server(('0.0.0.0', 22022)) as listener:
            capture.setblocking(False)
            listener.setblocking(False)
            end = time.monotonic() + 60
            print(json.dumps({'ready': True, 'pid': os.getpid(), 'source': source_ip,
                              'listener': 22022, 'durationSeconds': 60}), flush=True)
            syns = 0
            while time.monotonic() < end:
                ready, _, _ = select.select([capture, listener], [], [], 0.5)
                if listener in ready:
                    connection, address = listener.accept()
                    with connection:
                        connection.settimeout(1)
                        connection.sendall(b'disposable-network-probe\n')
                    print(json.dumps({'otherPortAccepted': address, 'at': time.time()}), flush=True)
                if capture in ready:
                    packet = capture.recv(65535)
                    if len(packet) < 54 or packet[23] != 6 or socket.inet_ntoa(packet[26:30]) != source_ip:
                        continue
                    tcp = 14 + (packet[14] & 15) * 4
                    if len(packet) < tcp + 20:
                        continue
                    port = int.from_bytes(packet[tcp + 2:tcp + 4], 'big')
                    if port == 22 and packet[tcp + 13] & 0x12 == 0x02:
                        syns += 1
                        print(json.dumps({'sshSyn': syns, 'sourcePort': int.from_bytes(packet[tcp:tcp + 2], 'big'),
                                          'at': time.time()}), flush=True)
            print(json.dumps({'complete': True, 'sshSyns': syns, 'listenerClosed': True}), flush=True)
    finally:
        capture.close()


if sys.argv[1:] == ['--network-path']:
    network_path_probe()
else:
    unittest.main(verbosity=2)
