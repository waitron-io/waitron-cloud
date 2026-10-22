import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

// Rewriting a release, component or trust setting must fail the byte-for-byte checks.
test('browser source preparation changes only recognised Ubuntu archive URIs and is repeatable', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-browser-source-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'sources.list.d'));
  const cases = [
    ['sources.list.d/ubuntu.sources',
      'Types: deb deb-src\nURIs: http://azure.archive.ubuntu.com/ubuntu/\nSuites: noble noble-updates noble-backports\nComponents: main restricted universe multiverse\nArchitectures: amd64\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n\nTypes: deb\nURIs: https://security.ubuntu.com/ubuntu\nSuites: noble-security\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n',
      'Types: deb deb-src\nURIs: https://mirrors.kernel.org/ubuntu/\nSuites: noble noble-updates noble-backports\nComponents: main restricted universe multiverse\nArchitectures: amd64\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n\nTypes: deb\nURIs: https://security.ubuntu.com/ubuntu\nSuites: noble-security\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n'],
    ['sources.list',
      'deb [arch=amd64 signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] https://azure.archive.ubuntu.com/ubuntu jammy main universe\n',
      'deb [arch=amd64 signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] https://mirrors.kernel.org/ubuntu jammy main universe\n'],
    ['sources.list.d/runner.sources',
      'Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble noble-updates noble-backports noble-security\nComponents: main restricted universe multiverse\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n',
      'Types: deb\nURIs: https://mirrors.kernel.org/ubuntu\nSuites: noble noble-updates noble-backports noble-security\nComponents: main restricted universe multiverse\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n'],
    ['sources.list.d/legacy-runner.list',
      'deb [signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] mirror+file:/etc/apt/apt-mirrors.txt jammy main\n',
      'deb [signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] https://mirrors.kernel.org/ubuntu jammy main\n'],
    ['sources.list.d/primary.sources',
      'Types: deb\nURIs: https://archive.ubuntu.com/ubuntu/\nSuites: noble noble-updates noble-backports noble-security\nComponents: main restricted universe multiverse\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n',
      'Types: deb\nURIs: https://mirrors.kernel.org/ubuntu/\nSuites: noble noble-updates noble-backports noble-security\nComponents: main restricted universe multiverse\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n'],
    ['sources.list.d/primary.list',
      'deb [arch=amd64 signed-by=/keys/ubuntu.gpg] http://archive.ubuntu.com/ubuntu noble universe\n',
      'deb [arch=amd64 signed-by=/keys/ubuntu.gpg] https://mirrors.kernel.org/ubuntu noble universe\n'],
    ['sources.list.d/primary-lookalike.list', 'deb https://archive.ubuntu.com.example/ubuntu noble main\n'],
    ['sources.list.d/archive-path.list', 'deb https://archive.ubuntu.com/ubuntu-other noble main\n'],
    ['sources.list.d/prefixed.list', 'deb tor+http://archive.ubuntu.com/ubuntu noble main\n'],
    ['sources.list.d/windows.list',
      '# retained comment\r\ndeb [signed-by=/keys/ubuntu.gpg] https://archive.ubuntu.com/ubuntu noble main\r\n# retained end\r\n',
      '# retained comment\r\ndeb [signed-by=/keys/ubuntu.gpg] https://mirrors.kernel.org/ubuntu noble main\r\n# retained end\r\n'],
    ['sources.list.d/vendor-mirror.list', 'deb mirror+file:/vendor-mirrors.txt noble main\n'],
    ['sources.list.d/vendor.list', 'deb [signed-by=/vendor.gpg] https://vendor.example/ubuntu noble main\n'],
    ['sources.list.d/lookalike.list', 'deb https://azure.archive.ubuntu.com.example/ubuntu noble main\n'],
    ['sources.list.d/disabled.list.save', 'deb http://azure.archive.ubuntu.com/ubuntu noble main\n'],
  ];
  for (const [path, before] of cases) await writeFile(join(root, path), before);
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = spawnSync('python3', ['scripts/ci-browser-source.py', '--apt-root', root], {encoding: 'utf8'});
    assert.equal(result.status, 0, result.stdout + result.stderr);
    for (const [path, before, after = before] of cases) assert.equal(await readFile(join(root, path), 'utf8'), after, path);
  }
});
