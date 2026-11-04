import assert from 'node:assert/strict';
import {test} from 'node:test';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, rm, symlink, chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';

const reader = resolve('deploy/test-cloud/test-fixtures/integration-waitron-source.mjs');
const sha = value => createHash('sha256').update(value).digest('hex');
const load = () => import('./test-fixtures/integration-waitron-source.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url?.endsWith('/integration-waitron-source.mjs')) return {};
  throw error;
});
async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'cloud-waitron-source-'));
  const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  try {
    await mkdir(join(root, 'apps/server'), {recursive: true});
    await mkdir(join(root, 'apps/server.v2'), {recursive: true});
    await writeFile(join(root, 'apps/server/main.ts'), 'server bytes\n');
    await writeFile(join(root, 'apps/server.v2/main.ts'), 'next server\n');
    await writeFile(join(root, 'apps/server.c'), 'sibling file\n');
    await writeFile(join(root, 'binary.bin'), Buffer.from([0, 255, 128, 10]));
    await writeFile(join(root, 'package.json'), '{"name":"pinned-venue"}\n');
    await writeFile(join(root, 'run.sh'), '#!/bin/sh\nexit 0\n'); await chmod(join(root, 'run.sh'), 0o755);
    git('init', '-q'); git('add', '.');
    git('-c', 'user.name=source-test', '-c', 'user.email=source@example.test', 'commit', '-q', '-s', '-m', 'Pinned source fixture');
    await run({root, git, head: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}')});
  } finally {await rm(root, {recursive: true, force: true});}
}

// Omitting a tracked file, using a label, or sorting directories like files breaks Git tree binding.
test('captures every pinned tracked byte and validates its Git tree without Git in the measured image', async () => {
  const {captureWaitronSource, measureWaitronSource} = await load();
  assert.equal(typeof captureWaitronSource, 'function', 'Pinned Waitron source capture is missing');
  await fixture(async ({root, head, tree}) => {
    const source = await captureWaitronSource(root, head);
    assert.deepEqual(source, {head, tree, dirty: false, files: [
      {path: 'apps/server.c', mode: '100644', sha256: sha('sibling file\n')},
      {path: 'apps/server.v2/main.ts', mode: '100644', sha256: sha('next server\n')},
      {path: 'apps/server/main.ts', mode: '100644', sha256: sha('server bytes\n')},
      {path: 'binary.bin', mode: '100644', sha256: sha(Buffer.from([0, 255, 128, 10]))},
      {path: 'package.json', mode: '100644', sha256: sha('{"name":"pinned-venue"}\n')},
      {path: 'run.sh', mode: '100755', sha256: sha('#!/bin/sh\nexit 0\n')},
    ]});
    await rm(join(root, '.git'), {recursive: true});
    await writeFile(join(root, 'generated-output.js'), 'untracked build output');
    assert.deepEqual(await measureWaitronSource(root, source, head), {
      head, tree, dirty: false, files: 6, sourceSha256: sha(JSON.stringify(source.files)),
    });
  });
});

for (const [name, change] of [
  ['tracked edit', root => writeFile(join(root, 'package.json'), 'changed')],
  ['untracked file', root => writeFile(join(root, 'untracked.ts'), 'uncommitted')],
  ['tracked symlink', async (root, git) => {await symlink('package.json', join(root, 'linked')); git('add', 'linked'); git('-c', 'user.name=source-test', '-c', 'user.email=source@example.test', 'commit', '-q', '-s', '-m', 'Link fixture');}],
]) test('source capture refuses ' + name, async () => {
  const {captureWaitronSource} = await load();
  assert.equal(typeof captureWaitronSource, 'function', 'Pinned Waitron source capture is missing');
  await fixture(async ({root, git}) => {await change(root, git); await assert.rejects(captureWaitronSource(root, git('rev-parse', 'HEAD')));});
});

test('source capture refuses a clean checkout at the wrong pin', async () => {
  const {captureWaitronSource} = await load();
  assert.equal(typeof captureWaitronSource, 'function', 'Pinned Waitron source capture is missing');
  await fixture(async ({root}) => {await assert.rejects(captureWaitronSource(root, '0'.repeat(40)), /waitron_source.pin/);});
});

// Matching per-file SHA-256 alone cannot detect an omitted file or a fabricated source tree.
for (const [name, change] of [
  ['omitted file', source => source.files.pop()],
  ['wrong tree', source => {source.tree = '0'.repeat(40);}],
  ['wrong pin', source => {source.head = '0'.repeat(40);}],
  ['dirty claim', source => {source.dirty = true;}],
  ['duplicate file', source => source.files.push(source.files[0])],
  ['unsorted files', source => source.files.reverse()],
  ['unsafe path', source => {source.files[0].path = '../PRIVATE_SOURCE_CANARY';}],
  ['unsafe mode', source => {source.files[0].mode = '120000';}],
  ['extra field', source => {source.secret = 'PRIVATE_SOURCE_CANARY';}],
  ['altered hash', source => {source.files[0].sha256 = '0'.repeat(64);}],
  ['empty manifest', source => {source.files = [];}],
  ['excessive manifest', source => {source.files = Array(20001).fill(source.files[0]);}],
]) test('image measurement refuses ' + name, async () => {
  const {captureWaitronSource, measureWaitronSource} = await load();
  assert.equal(typeof measureWaitronSource, 'function', 'Pinned Waitron source measurement is missing');
  await fixture(async ({root, head}) => {
    const source = await captureWaitronSource(root, head); change(source);
    await assert.rejects(measureWaitronSource(root, source, head));
  });
});

for (const [name, change] of [
  ['changed bytes with matching SHA-256', async (root, source) => {await writeFile(join(root, 'package.json'), 'fabricated bytes'); source.files.find(v => v.path === 'package.json').sha256 = sha('fabricated bytes');}],
  ['missing file', root => rm(join(root, 'binary.bin'))],
  ['executable bit change', root => chmod(join(root, 'run.sh'), 0o644)],
  ['ancestor link', async root => {await mkdir(join(root, 'outside')); await writeFile(join(root, 'outside/main.ts'), 'server bytes\n'); await rm(join(root, 'apps/server'), {recursive: true}); await symlink(join(root, 'outside'), join(root, 'apps/server'));}],
]) test('image measurement refuses ' + name, async () => {
  const {captureWaitronSource, measureWaitronSource} = await load();
  assert.equal(typeof measureWaitronSource, 'function', 'Pinned Waitron source measurement is missing');
  await fixture(async ({root, head}) => {
    const source = await captureWaitronSource(root, head); await change(root, source);
    await assert.rejects(measureWaitronSource(root, source, head));
  });
});

test('source command reports the pinned tree and redacts invalid input and file contents', async () => {
  await fixture(async ({root, head}) => {
    const run = (args, input = '') => spawnSync(process.execPath, [reader, ...args], {cwd: root, input, encoding: 'utf8'});
    const captured = run(['capture', root, head]); assert.equal(captured.status, 0, 'Pinned source command is missing');
    const measured = run(['measure', head], captured.stdout);
    assert.equal(measured.status, 0, measured.stderr); assert.equal(JSON.parse(measured.stdout).files, 6);
    assert.equal(measured.stderr, '');
    for (const [args, input] of [[[], ''], [['capture', root, head, 'extra'], ''], [['measure', head], 'PRIVATE_SOURCE_CANARY'],
      [['measure', head], ' '.repeat(4 * 1024 * 1024 + 1) + captured.stdout], [['measure', head, 'extra'], captured.stdout], [['measure', 'invalid'], captured.stdout]]) {
      const refused = run(args, input); assert.equal(refused.status, 1); assert.equal(refused.stdout, '');
      assert.equal(refused.stderr, 'Waitron source refused\n');
    }
    await writeFile(join(root, 'package.json'), 'PRIVATE_SOURCE_CANARY');
    const refused = run(['measure', head], captured.stdout); assert.equal(refused.status, 1);
    assert.equal(refused.stdout + refused.stderr, 'Waitron source refused\n');
  });
});

// A label-only probe, wrong selected image or delayed cleanup registration must fail this command-boundary control.
test('Waitron image probe streams the real reader into the selected isolated image and owns it before start', async () => {
  const {probeWaitronSource} = await import('./test-fixtures/integration-waitron-source-probe.mjs').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url?.endsWith('/integration-waitron-source-probe.mjs')) return {};
    throw error;
  });
  assert.equal(typeof probeWaitronSource, 'function', 'Pinned Waitron image probe is missing');
  const {captureWaitronSource} = await load();
  await fixture(async ({root, head, tree}) => {
    const source = await captureWaitronSource(root, head), image = 'sha256:' + 'a'.repeat(64), id = 'b'.repeat(64);
    const runId = '8ba3c218-1aca-46dc-a4cd-d581f5ec2031', events = [];
    const result = await probeWaitronSource({image, source, expectedHead: head, runId,
      own: value => events.push(['own', value]), docker: async (args, input) => {
        events.push([args[0], args, input]);
        if (args[0] === 'create') return id;
        assert.deepEqual(events[1], ['own', id]); assert.deepEqual(args, ['start', '-ai', id]);
        const create = events[0][1];
        assert.deepEqual(create.slice(0, -1), ['create', '-i', '--pull=never', '--label', 'cloud.integration.owner=' + runId,
          '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
          '--memory', '256m', '--memory-swap', '256m', '--pids-limit', '32', '--workdir', '/waitron',
          '--entrypoint', 'node', image, '--input-type=module', '-e']);
        const measured = spawnSync(process.execPath, ['--input-type=module', '-e', create.at(-1)], {cwd: root, input, encoding: 'utf8'});
        assert.equal(measured.status, 0, measured.stderr); return measured.stdout;
      }});
    assert.deepEqual(result, {image, head, tree, dirty: false, files: 6, sourceSha256: sha(JSON.stringify(source.files))});
    const owned = [];
    await assert.rejects(probeWaitronSource({image, source, expectedHead: head, runId, own: value => owned.push(value),
      docker: async args => {if (args[0] === 'create') return id; throw Error('failed read');}}), /failed read/);
    assert.deepEqual(owned, [id]);
    let commands = 0;
    for (const options of [{image: 'mutable:tag'}, {runId: 'invalid'}, {expectedHead: '0'.repeat(40)}]) {
      await assert.rejects(probeWaitronSource({image, source, expectedHead: head, runId, ...options,
        own() {}, docker: async () => {commands++;}}));
    }
    assert.equal(commands, 0);
  });
});

test('source capture includes committed environment examples while refusing actual environment files', async () => {
  const {captureWaitronSource} = await load();
  await fixture(async ({root, git}) => {
    await writeFile(join(root, 'apps/server/.env.example'), 'EXAMPLE_VALUE=placeholder\n');
    git('add', '.'); git('-c', 'user.name=source-test', '-c', 'user.email=source@example.test', 'commit', '-q', '-s', '-m', 'Example fixture');
    const source = await captureWaitronSource(root, git('rev-parse', 'HEAD'));
    assert.deepEqual(source.files.find(v => v.path.endsWith('.env.example')), {
      path: 'apps/server/.env.example', mode: '100644', sha256: sha('EXAMPLE_VALUE=placeholder\n'),
    });
    for (const name of ['.env', '.env.local']) {
      await writeFile(join(root, name), 'PRIVATE_SOURCE_CANARY'); git('add', '-f', name);
      git('-c', 'user.name=source-test', '-c', 'user.email=source@example.test', 'commit', '-q', '-s', '-m', 'Private fixture');
      await assert.rejects(captureWaitronSource(root, git('rev-parse', 'HEAD')), /waitron_source.path/);
      await rm(join(root, name)); git('add', '-u');
      git('-c', 'user.name=source-test', '-c', 'user.email=source@example.test', 'commit', '-q', '-s', '-m', 'Remove private fixture');
    }
  });
});

// The complete pinned tree is 334,125,255 bytes; a cumulative processing budget must admit it without removing the bound.
test('source reader admits a 320 MiB tree and refuses a tree beyond its 512 MiB processing budget', async () => {
  const {captureWaitronSource} = await load();
  const {open} = await import('node:fs/promises');
  await fixture(async ({root, git}) => {
    for (let i = 0; i < 5; i++) {
      const file = await open(join(root, 'asset-' + i), 'w');
      try {await file.truncate(64 * 1024 * 1024);} finally {await file.close();}
    }
    const save = () => {git('add', '.'); git('-c', 'user.name=source-test', '-c', 'user.email=source@example.test', 'commit', '-q', '-s', '-m', 'Bounded asset fixture');};
    save();
    assert.equal((await captureWaitronSource(root, git('rev-parse', 'HEAD'))).files.length, 11);
    for (let i = 5; i < 9; i++) {
      const file = await open(join(root, 'asset-' + i), 'w');
      try {await file.truncate(64 * 1024 * 1024);} finally {await file.close();}
    }
    save();
    await assert.rejects(captureWaitronSource(root, git('rev-parse', 'HEAD')), /waitron_source.size/);
  });
});
