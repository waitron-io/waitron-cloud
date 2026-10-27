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
      'Types: deb deb-src\nURIs: mirror+file:' + root + '/waitron-browser-mirrors.txt\nSuites: noble noble-updates noble-backports\nComponents: main restricted universe multiverse\nArchitectures: amd64\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n\nTypes: deb\nURIs: https://security.ubuntu.com/ubuntu\nSuites: noble-security\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n'],
    ['sources.list',
      'deb [arch=amd64 signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] https://azure.archive.ubuntu.com/ubuntu jammy main universe\n',
      'deb [arch=amd64 signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] mirror+file:' + root + '/waitron-browser-mirrors.txt jammy main universe\n'],
    ['sources.list.d/runner.sources',
      'Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble noble-updates noble-backports noble-security\nComponents: main restricted universe multiverse\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n',
      'Types: deb\nURIs: mirror+file:' + root + '/waitron-browser-mirrors.txt\nSuites: noble noble-updates noble-backports noble-security\nComponents: main restricted universe multiverse\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n'],
    ['sources.list.d/legacy-runner.list',
      'deb [signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] mirror+file:/etc/apt/apt-mirrors.txt jammy main\n',
      'deb [signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] mirror+file:' + root + '/waitron-browser-mirrors.txt jammy main\n'],
    ['sources.list.d/primary.sources',
      'Types: deb\nURIs: https://archive.ubuntu.com/ubuntu/\nSuites: noble noble-updates noble-backports noble-security\nComponents: main restricted universe multiverse\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n',
      'Types: deb\nURIs: mirror+file:' + root + '/waitron-browser-mirrors.txt\nSuites: noble noble-updates noble-backports noble-security\nComponents: main restricted universe multiverse\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n'],
    ['sources.list.d/primary.list',
      'deb [arch=amd64 signed-by=/keys/ubuntu.gpg] http://archive.ubuntu.com/ubuntu noble universe\n',
      'deb [arch=amd64 signed-by=/keys/ubuntu.gpg] mirror+file:' + root + '/waitron-browser-mirrors.txt noble universe\n'],
    ['sources.list.d/primary-lookalike.list', 'deb https://archive.ubuntu.com.example/ubuntu noble main\n'],
    ['sources.list.d/archive-path.list', 'deb https://archive.ubuntu.com/ubuntu-other noble main\n'],
    ['sources.list.d/prefixed.list', 'deb tor+http://archive.ubuntu.com/ubuntu noble main\n'],
    ['sources.list.d/windows.list',
      '# retained comment\r\ndeb [signed-by=/keys/ubuntu.gpg] https://archive.ubuntu.com/ubuntu noble main\r\n# retained end\r\n',
      '# retained comment\r\ndeb [signed-by=/keys/ubuntu.gpg] mirror+file:' + root + '/waitron-browser-mirrors.txt noble main\r\n# retained end\r\n'],
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

// Reading a later vendor file must fail before any earlier source is rewritten.
test('invalid UTF-8 in a later source refuses preparation without changing any source', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-browser-source-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'sources.list.d'));
  const original = Buffer.from('# café\r\ndeb https://archive.ubuntu.com/ubuntu noble main\r\n');
  const vendor = Buffer.from([0x23, 0x20, 0xff, 0x0a]);
  await writeFile(join(root, 'sources.list'), original);
  await writeFile(join(root, 'sources.list.d/vendor.sources'), vendor);
  const result = spawnSync('python3', ['scripts/ci-browser-source.py', '--apt-root', root], {encoding: 'utf8'});
  assert.notEqual(result.status, 0, 'unreadable input must refuse preparation');
  assert.deepEqual(await readFile(join(root, 'sources.list')), original);
  assert.deepEqual(await readFile(join(root, 'sources.list.d/vendor.sources')), vendor);
  assert.match(result.stderr, /vendor\.sources/);
});

// Removing either URI's leading boundary would rewrite an unrelated transport.
test('archive and mirror-file URIs must start at a whitespace boundary', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-browser-source-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const original = 'deb tor+http://archive.ubuntu.com/ubuntu noble main\n'
    + 'deb vendor+mirror+file:/etc/apt/apt-mirrors.txt noble main\n'
    + '\tdeb\thttps://archive.ubuntu.com/ubuntu noble main\n'
    + '\tdeb\tmirror+file:/etc/apt/apt-mirrors.txt noble main\n';
  await writeFile(join(root, 'sources.list'), original);
  const result = spawnSync('python3', ['scripts/ci-browser-source.py', '--apt-root', root], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(await readFile(join(root, 'sources.list'), 'utf8'),
    'deb tor+http://archive.ubuntu.com/ubuntu noble main\n'
    + 'deb vendor+mirror+file:/etc/apt/apt-mirrors.txt noble main\n'
    + '\tdeb\tmirror+file:' + root + '/waitron-browser-mirrors.txt noble main\n'
    + '\tdeb\tmirror+file:' + root + '/waitron-browser-mirrors.txt noble main\n');
});

// Dropping the warning would hide changed runner layouts and empty source inventories.
test('source preparation warns without refusing or modifying sources when nothing is rewritten', async t => {
  for (const [name, original] of [
    ['empty inventory', null],
    ['unrecognised archive', 'deb [signed-by=/keys/ubuntu.gpg] https://new-mirror.example/ubuntu noble main\r\n'],
    ['already prepared', 'deb mirror+file:/etc/apt/waitron-browser-mirrors.txt noble main\n'],
  ]) {
    await t.test(name, async t => {
      const root = await mkdtemp(join(tmpdir(), 'cloud-browser-source-'));
      t.after(() => rm(root, {recursive: true, force: true}));
      if (original !== null) await writeFile(join(root, 'sources.list'), original);
      const result = spawnSync('python3', ['scripts/ci-browser-source.py', '--apt-root', root], {encoding: 'utf8'});
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.match(result.stderr, /Warning: no Ubuntu archive URI was rewritten/);
      assert.match(result.stderr, /already.*prepared.*runner layout.*changed/);
      assert.equal(result.stdout, '', 'no source was changed');
      if (original !== null) assert.equal(await readFile(join(root, 'sources.list'), 'utf8'), original);
    });
  }
});

// An unconditional warning would report a layout problem even after a successful rewrite.
test('rewritten sources report the mirror without a no-rewrite warning', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-browser-source-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'sources.list.d'));
  await writeFile(join(root, 'sources.list'), 'deb https://vendor.example/ubuntu noble main\n');
  await writeFile(join(root, 'sources.list.d/ubuntu.sources'), 'URIs: http://archive.ubuntu.com/ubuntu\n');
  const result = spawnSync('python3', ['scripts/ci-browser-source.py', '--apt-root', root], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stderr, '');
  assert.ok(result.stdout.includes('Using mirror+file:' + root + '/waitron-browser-mirrors.txt'));
  assert.equal(await readFile(join(root, 'sources.list'), 'utf8'), 'deb https://vendor.example/ubuntu noble main\n');
  assert.equal(await readFile(join(root, 'sources.list.d/ubuntu.sources'), 'utf8'),
    'URIs: mirror+file:' + root + '/waitron-browser-mirrors.txt\n');
});

// Keeping a single archive would leave both outer attempts dependent on one host.
test('prepared APT sources offer ordered independent mirrors with bounded transport waits', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-browser-source-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await writeFile(join(root, 'sources.list'), 'deb https://archive.ubuntu.com/ubuntu noble main\n');
  const result = spawnSync('python3', ['scripts/ci-browser-source.py', '--apt-root', root], {encoding: 'utf8'});
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(await readFile(join(root, 'waitron-browser-mirrors.txt'), 'utf8').catch(() => null),
    'https://mirror.math.princeton.edu/pub/ubuntu\tpriority:1\nhttps://archive.ubuntu.com/ubuntu\tpriority:2\n');
  assert.equal(await readFile(join(root, 'apt.conf.d/zzzz-waitron-browser-mirrors'), 'utf8').catch(() => null),
    'Acquire::https::Timeout "10";\nAcquire::By-Hash "false";\n');
});
