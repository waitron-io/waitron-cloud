"""Opt-in dedicated-host proof; commands and package data execute only in a guest."""
import json
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import time
import unittest

RECIPE = Path(sys.argv.pop(1)).resolve()
SOURCE = Path(sys.argv.pop(1)).resolve()
DIGEST = sys.argv.pop(1)
PRIVATE = Path(sys.argv.pop(1)).resolve()


class GuestTools(unittest.TestCase):
    def command(self, *args, input=None, timeout=30):
        return subprocess.run(args, input=input, capture_output=True, timeout=timeout)

    def manager(self, mode, request):
        result = self.command('python3', str(RECIPE/'host.py'), mode,
                              input=json.dumps(request).encode(), timeout=180)
        print(mode, result.returncode, result.stdout.decode(), result.stderr.decode(), flush=True)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        return json.loads(result.stdout)

    def test_real_tools_dependencies_and_postgres(self):
        with tempfile.TemporaryDirectory(prefix='dt-tools-proof-') as temporary:
            key = Path(temporary)/'key'
            generated = self.command('ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(key))
            self.assertEqual(generated.returncode, 0, generated.stderr)
            resource = f'dt-tools-proof-0-{int(time.time()*1000)}'
            request = {'resourceId': resource, 'deadline': int(time.time()*1000)+1200000,
                       'sshPublicKey': ' '.join(key.with_suffix('.pub').read_text().split()[:2])}
            try:
                self.assertTrue(self.manager('create', request)['running'])
                known = Path(temporary)/'known'; end=time.monotonic()+120
                while time.monotonic()<end:
                    scan=self.command('ssh-keyscan','-T','2','-t','ed25519','-p','22000','127.0.0.1')
                    if scan.returncode==0 and scan.stdout.strip():
                        known.write_bytes(scan.stdout); break
                    time.sleep(1)
                else:self.fail('Guest SSH did not boot within120seconds')
                ssh=['ssh','-i',str(key),'-o','IdentitiesOnly=yes','-o','BatchMode=yes',
                     '-o','StrictHostKeyChecking=yes','-o',f'UserKnownHostsFile={known}',
                     '-o','ConnectTimeout=3','-p','22000','root@127.0.0.1']
                def guest(command, data=None, timeout=30):
                    result=self.command(*ssh,command,input=data,timeout=timeout)
                    print('GUEST',command,result.returncode,result.stdout.decode(errors='replace'),result.stderr.decode(errors='replace'),flush=True)
                    return result
                self.assertEqual(guest('cloud-init status --wait',timeout=120).returncode,0)
                prepared=guest('bash -s', (RECIPE/'guest-tools.sh').read_bytes(), timeout=360)
                self.assertEqual(prepared.returncode,0,prepared.stderr.decode())
                tools=guest('node --version && pnpm --version && docker compose version && docker info --format "{{.ServerVersion}}"')
                self.assertEqual(tools.returncode,0,tools.stderr.decode())
                self.assertIn(b'v26.13.0',tools.stdout)
                self.assertIn(b'9.15.0',tools.stdout)
                self.assertIn(b'26.1.5',tools.stdout)
                inventory=guest('cat /opt/waitron-tools/installed-packages.txt')
                self.assertEqual(inventory.returncode,0,inventory.stderr.decode())
                self.assertIn(b'docker-cli=26.1.5+dfsg1-9+deb13u1',inventory.stdout)
                self.assertEqual(guest('mkdir -p /work/source /work/private /opt/waitron-disposable').returncode,0)
                for path,target in [(SOURCE,'/work/source.tar'),(PRIVATE/'ui-core-0.1.0.tgz','/work/private/ui.tgz'),(RECIPE/'snapshot.py','/opt/waitron-disposable/snapshot.py'),(RECIPE/'guest-exec.py','/opt/waitron-disposable/guest-exec.py')]:
                    self.assertEqual(guest('cat > '+shlex.quote(target),path.read_bytes(),timeout=90).returncode,0)
                extracted=guest('python3 /opt/waitron-disposable/snapshot.py extract /work/source.tar '+shlex.quote(DIGEST)+' /work/source',timeout=30)
                self.assertEqual(extracted.returncode,0,extracted.stderr.decode())
                installed=guest("cd /work/source && export CI=true npm_config_store_dir=/work/pnpm-store npm_config_prefer_offline=true; pnpm store add /work/private/ui.tgz && pnpm install --frozen-lockfile",timeout=180)
                self.assertEqual(installed.returncode,0,installed.stderr.decode())
                clean=guest("test ! -e /work/source/.git && test ! -e /root/.npmrc && test -z \"${NODE_AUTH_TOKEN:-}${GH_TOKEN:-}${GITHUB_TOKEN:-}\"")
                self.assertEqual(clean.returncode,0,clean.stderr.decode())
                nested=guest("mkdir /work/nested-source && python3 /opt/waitron-disposable/snapshot.py extract /work/source.tar "+shlex.quote(DIGEST)+" /work/nested-source && cd /work/nested-source && CI=true npm_config_store_dir=/work/pnpm-store pnpm install --frozen-lockfile --offline",timeout=60)
                self.assertEqual(nested.returncode,0,nested.stderr.decode())
                executor='python3 /opt/waitron-disposable/guest-exec.py '+shlex.quote(resource)
                postgres=guest(executor,json.dumps({'argv':['node','scripts/test-postgres.mjs','exec','pnpm','--dir','packages/registration','exec','node','--test','test/monitoring.test.ts'],'deadline':request['deadline']-10000,'nonce':'b'*32}).encode(),timeout=180)
                self.assertEqual(postgres.returncode,0,postgres.stderr.decode())
                self.assertRegex(postgres.stdout.decode(),r'(?:# pass|ℹ pass) [1-9][0-9]*')
                receipt=guest('cat /run/waitron-disposable/result.json');self.assertEqual(receipt.returncode,0)
                self.assertEqual(json.loads(receipt.stdout),{'resourceId':resource,'nonce':'b'*32,'code':0})
                self.assertEqual(guest('rm /run/waitron-disposable/result.json').returncode,0)
                failed=guest(executor,json.dumps({'argv':['node','scripts/test-postgres.mjs','exec','node','-e','process.exit(3)'],'deadline':request['deadline']-10000,'nonce':'c'*32}).encode(),timeout=180)
                self.assertEqual(failed.returncode,0,failed.stderr.decode())
                receipt=guest('cat /run/waitron-disposable/result.json');self.assertEqual(receipt.returncode,0)
                self.assertEqual(json.loads(receipt.stdout),{'resourceId':resource,'nonce':'c'*32,'code':3})
                owning=guest('cd /work/source && node --test scripts/ci-disposable-local.test.mjs',timeout=60)
                self.assertEqual(owning.returncode,0,owning.stderr.decode())
                self.assertRegex(owning.stdout.decode(),r'(?:# pass|ℹ pass) [1-9][0-9]*')
                empty=guest("docker ps -aq")
                self.assertEqual(empty.returncode,0,empty.stderr.decode())
                self.assertEqual(empty.stdout.strip(),b'')
            finally:
                self.assertTrue(self.manager('destroy',{'resourceId':resource})['absent'])
                self.assertTrue(self.manager('inspect',{'resourceId':resource})['absent'])


unittest.main(verbosity=2)
