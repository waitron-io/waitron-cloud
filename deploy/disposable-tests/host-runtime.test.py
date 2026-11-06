"""Explicit opt-in lifecycle proof on the dedicated test host, never a CI import."""
import json
import pwd
from pathlib import Path
import shlex
import socket
import subprocess
import sys
import tempfile
import time
import unittest

MANAGER = sys.argv.pop(1)


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


unittest.main(verbosity=2)
