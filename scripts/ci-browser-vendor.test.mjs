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

// An existing per-source override must not conflict with the fallback's stable-path policy.
test('Ubuntu index policy replaces existing overrides and retains source endings', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-browser-policy-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'sources.list.d'));
  await writeFile(join(root, 'sources.list'), 'deb https://archive.ubuntu.com/ubuntu noble main\r\ndeb-src [by-hash=force signed-by=/keys/u.gpg] https://archive.ubuntu.com/ubuntu noble main');
  await writeFile(join(root, 'sources.list.d/ubuntu.sources'), 'Types: deb\r\nURIs: https://archive.ubuntu.com/ubuntu\r\nSuites: noble\r\nBy-Hash: yes\r\nComponents: main');
  const expected = `deb [by-hash=no] mirror+file:${root}/waitron-browser-mirrors.txt noble main\r\ndeb-src [by-hash=no signed-by=/keys/u.gpg] mirror+file:${root}/waitron-browser-mirrors.txt noble main`;
  for (let attempt = 0; attempt < 2; attempt++) {
    execFileSync('python3', ['scripts/ci-browser-source.py', '--apt-root', root], {stdio: 'pipe'});
    assert.equal(await readFile(join(root, 'sources.list'), 'utf8'), expected);
    assert.equal(await readFile(join(root, 'sources.list.d/ubuntu.sources'), 'utf8'),
      `Types: deb\r\nURIs: mirror+file:${root}/waitron-browser-mirrors.txt\r\nSuites: noble\r\nBy-Hash: no\r\nComponents: main`);
  }
});

// A shared Deb822 policy must never disable hash addressing for a vendor in the same stanza.
test('mixed Ubuntu and vendor URI stanzas refuse before rewriting any source', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-browser-mixed-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  await mkdir(join(root, 'sources.list.d'));
  const first = 'deb https://archive.ubuntu.com/ubuntu noble main\n';
  const mixed = 'Types: deb\nURIs: https://archive.ubuntu.com/ubuntu\n https://vendor.example/prod\nSuites: noble\nComponents: main\n';
  await writeFile(join(root, 'sources.list'), first);
  await writeFile(join(root, 'sources.list.d/mixed.sources'), mixed);
  assert.throws(() => execFileSync('python3', ['scripts/ci-browser-source.py', '--apt-root', root], {stdio: 'pipe'}),
    error => error.status !== 0 && /mixed.*URI.*mixed\.sources/i.test(String(error.stderr)));
  assert.equal(await readFile(join(root, 'sources.list'), 'utf8'), first);
  assert.equal(await readFile(join(root, 'sources.list.d/mixed.sources'), 'utf8'), mixed);
});

// Detection and rewriting must agree, without changing unsupported compact URI fields.
test('Deb822 field boundaries and appended policy preserve the source format', async t => {
  for (const [name, before, expected] of [
    ['lowercase field', 'Types: deb\nuris: https://archive.ubuntu.com/ubuntu\nSuites: noble\n',
      root => `Types: deb\nuris: mirror+file:${root}/waitron-browser-mirrors.txt\nSuites: noble\nBy-Hash: no\n`],
    ['compact field', 'Types: deb\nURIs:https://archive.ubuntu.com/ubuntu\nSuites: noble\n',
      () => 'Types: deb\nURIs:https://archive.ubuntu.com/ubuntu\nSuites: noble\n'],
    ['CRLF appended policy', 'Types: deb\r\nURIs: https://archive.ubuntu.com/ubuntu\r\nSuites: noble\r\n',
      root => `Types: deb\r\nURIs: mirror+file:${root}/waitron-browser-mirrors.txt\r\nSuites: noble\r\nBy-Hash: no\r\n`],
  ]) {
    await t.test(name, async t => {
      const root = await mkdtemp(join(tmpdir(), 'cloud-browser-field-'));
      t.after(() => rm(root, {recursive: true, force: true}));
      await mkdir(join(root, 'sources.list.d'));
      await writeFile(join(root, 'sources.list.d/ubuntu.sources'), before);
      execFileSync('python3', ['scripts/ci-browser-source.py', '--apt-root', root], {stdio: 'pipe'});
      assert.equal(await readFile(join(root, 'sources.list.d/ubuntu.sources'), 'utf8'), expected(root));
    });
  }
});

// Real signed metadata must select the immutable vendor index and still reject changed bytes.
for (const [format, flags] of [['legacy', []], ['Deb822', ['--deb822']]]) {
test(`Linux APT keeps vendor by-hash acquisition through a stable-index publication mismatch (${format})`, {
  skip: process.platform !== 'linux', timeout: 60000,
}, () => {
  const stdout = execFileSync('python3', ['scripts/fixtures/ci-browser-vendor.py', ...flags], {
    encoding: 'utf8', timeout: 55000, maxBuffer: 2 ** 20,
  });
  assert.deepEqual(JSON.parse(stdout), {
    stableMismatchRefused: true, vendorByHashSucceeded: true,
    alteredHashRefused: true, alteredSignatureRefused: true,
  });
});
}
