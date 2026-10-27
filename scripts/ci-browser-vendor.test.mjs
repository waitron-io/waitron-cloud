import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';

// A global override makes an unrelated vendor fetch mutable index filenames.
test('browser preparation confines stable indexes to Ubuntu and preserves vendor sources', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-browser-vendor-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'sources.list.d'));
  const vendor = '# vendor policy\r\ndeb [signed-by=/keys/vendor.gpg] https://vendor.example/prod noble main\r\n';
  await writeFile(join(root, 'sources.list.d/vendor.list'), vendor);
  await writeFile(join(root, 'sources.list'), 'deb [arch=amd64 signed-by=/keys/ubuntu.gpg] https://archive.ubuntu.com/ubuntu noble main\n');
  await writeFile(join(root, 'sources.list.d/ubuntu.sources'), 'Types: deb\nURIs: http://azure.archive.ubuntu.com/ubuntu\nSuites: noble-updates\nComponents: main\nSigned-By: /keys/ubuntu.gpg\n');
  execFileSync('python3', ['scripts/ci-browser-source.py', '--apt-root', root]);
  assert.equal(await readFile(join(root, 'sources.list.d/vendor.list'), 'utf8'), vendor);
  assert.equal(await readFile(join(root, 'apt.conf.d/zzzz-waitron-browser-mirrors'), 'utf8'),
    'Acquire::https::Timeout "10";\n');
  assert.equal(await readFile(join(root, 'sources.list'), 'utf8'),
    `deb [arch=amd64 signed-by=/keys/ubuntu.gpg by-hash=no] mirror+file:${root}/waitron-browser-mirrors.txt noble main\n`);
  assert.equal(await readFile(join(root, 'sources.list.d/ubuntu.sources'), 'utf8'),
    `Types: deb\nURIs: mirror+file:${root}/waitron-browser-mirrors.txt\nSuites: noble-updates\nComponents: main\nSigned-By: /keys/ubuntu.gpg\nBy-Hash: no\n`);
});

// Real signed metadata must select the immutable vendor index and still reject changed bytes.
test('Linux APT keeps vendor by-hash acquisition through a stable-index publication mismatch', {
  skip: process.platform !== 'linux', timeout: 60000,
}, () => {
  const stdout = execFileSync('python3', ['scripts/fixtures/ci-browser-vendor.py'], {
    encoding: 'utf8', timeout: 55000, maxBuffer: 2 ** 20,
  });
  assert.deepEqual(JSON.parse(stdout), {
    stableMismatchRefused: true, vendorByHashSucceeded: true,
    alteredHashRefused: true, alteredSignatureRefused: true,
  });
});
