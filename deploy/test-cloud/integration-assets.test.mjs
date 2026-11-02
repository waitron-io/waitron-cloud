import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, mkdir, writeFile, rm, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const reader = resolve('deploy/test-cloud/test-fixtures/integration-assets.mjs');
const sha = value => createHash('sha256').update(value).digest('hex');
const load = () => import('./test-fixtures/integration-assets.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url?.endsWith('/integration-assets.mjs')) return {};
  throw error;
});
const paths = {
  cloud: ['apps/portal/dist/app.css', 'apps/portal/dist/app.js', 'apps/portal/dist/index.html'],
  waitron: ['apps/dashboard/dist/assets/app.js', 'apps/dashboard/dist/index.html', 'apps/server/dist/index.js'],
};
async function fixture(kind, run) {
  const root = await mkdtemp(join(tmpdir(), 'cloud-assets-'));
  try {
    for (const path of paths[kind]) {
      await mkdir(join(root, path, '..'), {recursive: true});
      await writeFile(join(root, path), path.endsWith('.html') ? '<html>café</html>\n' : 'built bytes\n');
    }
    await run(root);
  } finally {await rm(root, {recursive: true, force: true});}
}

// Omitting a file, trusting its name, or counting characters instead of bytes breaks the manifest.
for (const kind of ['cloud', 'waitron']) test(kind + ' measures every generated file in deterministic path order', async () => {
  const {measureIntegrationAssets} = await load();
  assert.equal(typeof measureIntegrationAssets, 'function', 'Generated asset measurement is missing');
  await fixture(kind, async root => {
    const expected = paths[kind].map(path => ({path, bytes: path.endsWith('.html') ? 19 : 12,
      sha256: sha(path.endsWith('.html') ? '<html>café</html>\n' : 'built bytes\n')}));
    const result = await measureIntegrationAssets(root, kind);
    assert.deepEqual(result, {kind, files: 3, bytes: 43,
      manifestSha256: sha(JSON.stringify(expected)), entries: expected});
    await writeFile(join(root, paths[kind][0]), 'changed built bytes');
    assert.notEqual((await measureIntegrationAssets(root, kind)).manifestSha256, result.manifestSha256);
  });
});

// A partial build must never look like a measured complete set of generated assets.
for (const [name, change] of [
  ['missing build', root => rm(join(root, 'apps/portal/dist'), {recursive: true})],
  ['empty build', async root => {await rm(join(root, 'apps/portal/dist'), {recursive: true}); await mkdir(join(root, 'apps/portal/dist'));}],
  ['empty file', root => writeFile(join(root, 'apps/portal/dist/app.js'), '')],
  ['file symlink', async root => {await rm(join(root, 'apps/portal/dist/app.js')); await symlink('/etc/hosts', join(root, 'apps/portal/dist/app.js'));}],
  ['directory symlink', async root => {await rm(join(root, 'apps/portal/dist'), {recursive: true}); await symlink('/tmp', join(root, 'apps/portal/dist'));}],
  ['ancestor symlink', async root => {
    await rm(join(root, 'apps/portal'), {recursive: true});
    await mkdir(join(root, 'other-portal/dist'), {recursive: true});
    await writeFile(join(root, 'other-portal/dist/app.js'), 'plausible built bytes');
    await symlink(join(root, 'other-portal'), join(root, 'apps/portal'));
  }],
  ['hidden credential', root => writeFile(join(root, 'apps/portal/dist/.env'), 'DO_NOT_PRINT_ASSET_SECRET')],
  ['unsupported file name', root => writeFile(join(root, 'apps/portal/dist/secret\nline'), 'DO_NOT_PRINT_ASSET_SECRET')],
]) test('asset reader refuses ' + name, async () => {
  const {measureIntegrationAssets} = await load();
  assert.equal(typeof measureIntegrationAssets, 'function', 'Generated asset measurement is missing');
  await fixture('cloud', async root => {
    await change(root);
    await assert.rejects(measureIntegrationAssets(root, 'cloud'));
  });
});

test('Waitron measurement refuses a missing server build even when its dashboard is present', async () => {
  const {measureIntegrationAssets} = await load();
  assert.equal(typeof measureIntegrationAssets, 'function', 'Generated asset measurement is missing');
  await fixture('waitron', async root => {
    await rm(join(root, 'apps/server/dist'), {recursive: true});
    await assert.rejects(measureIntegrationAssets(root, 'waitron'));
  });
});

test('asset reader bounds file size before reading the body', async () => {
  const {measureIntegrationAssets} = await load();
  assert.equal(typeof measureIntegrationAssets, 'function', 'Generated asset measurement is missing');
  const {open} = await import('node:fs/promises');
  await fixture('cloud', async root => {
    const file = await open(join(root, 'apps/portal/dist/app.js'), 'r+');
    try {await file.truncate(64 * 1024 * 1024 + 1);} finally {await file.close();}
    await assert.rejects(measureIntegrationAssets(root, 'cloud'), /integration.assets_size/);
  });
});

test('asset reader bounds total bytes across individually permitted files', async () => {
  const {measureIntegrationAssets} = await load();
  assert.equal(typeof measureIntegrationAssets, 'function', 'Generated asset measurement is missing');
  const {open} = await import('node:fs/promises');
  await fixture('cloud', async root => {
    for (let i = 0; i < 5; i++) {
      const file = await open(join(root, 'apps/portal/dist/large-' + i + '.js'), 'w');
      try {await file.truncate(64 * 1024 * 1024);} finally {await file.close();}
    }
    await assert.rejects(measureIntegrationAssets(root, 'cloud'), /integration.assets_size/);
  });
});

test('asset reader bounds directory depth and file count', async () => {
  const {measureIntegrationAssets} = await load();
  assert.equal(typeof measureIntegrationAssets, 'function', 'Generated asset measurement is missing');
  await fixture('cloud', async root => {
    const deep = join(root, 'apps/portal/dist', ...Array(33).fill('nested'));
    await mkdir(deep, {recursive: true}); await writeFile(join(deep, 'app.js'), 'built bytes');
    await assert.rejects(measureIntegrationAssets(root, 'cloud'), /integration.assets_count/);
  });
  await fixture('cloud', async root => {
    for (let i = 0; i < 10000; i++) await mkdir(join(root, 'apps/portal/dist/d' + i));
    await assert.rejects(measureIntegrationAssets(root, 'cloud'), /integration.assets_count/);
  });
});

test('asset CLI emits measured hashes and fixed refusal text without paths or contents', async () => {
  await fixture('cloud', async root => {
    const run = args => spawnSync(process.execPath, [reader, ...args], {cwd: root, encoding: 'utf8'});
    const result = run(['cloud']);
    assert.equal(result.status, 0, 'Generated asset command is missing');
    assert.equal(JSON.parse(result.stdout).files, 3);
    assert.equal(result.stderr, '');
    for (const args of [[], ['cloud', 'extra'], ['../../private'], ['waitron']]) {
      const refusal = run(args);
      assert.equal(refusal.status, 1); assert.equal(refusal.stdout, '');
      assert.equal(refusal.stderr, 'Integration assets refused\n');
    }
    await writeFile(join(root, 'apps/portal/dist/.env'), 'DO_NOT_PRINT_ASSET_SECRET');
    const refusal = run(['cloud']);
    assert.equal(refusal.status, 1); assert.equal(refusal.stdout, '');
    assert.equal(refusal.stderr, 'Integration assets refused\n');
  });
});

test('asset probe measures the selected image without network or writable host mounts and registers cleanup before starting', async () => {
  const {probeIntegrationAssets} = await import('./test-fixtures/integration-asset-probe.mjs').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url?.endsWith('/integration-asset-probe.mjs')) return {};
    throw error;
  });
  assert.equal(typeof probeIntegrationAssets, 'function', 'Image asset probe is missing');
  const image = 'sha256:' + 'a'.repeat(64), id = 'b'.repeat(64), owner = '8ba3c218-1aca-46dc-a4cd-d581f5ec2031';
  for (const kind of ['cloud', 'waitron']) {
    await fixture(kind, async root => {
    const events = [];
    const result = await probeIntegrationAssets({image, kind, runId: owner, own: value => events.push(['own', value]),
      docker: async (args, input) => {
        events.push([args[0], args, input]);
        if (args[0] === 'create') return id;
        assert.deepEqual(events[1], ['own', id]);
        assert.deepEqual(args, ['start', '-ai', id]);
        const run = spawnSync(process.execPath, ['--input-type=module', '-', kind], {cwd: root, input, encoding: 'utf8'});
        assert.equal(run.status, 0, run.stderr);
        return run.stdout;
      }});
    assert.equal(result.image, image); assert.equal(result.files, 3); assert.equal(result.bytes, 43);
    assert.equal(result.kind, kind);
    assert.deepEqual(result.entries.map(value => value.path), paths[kind]);
    assert.deepEqual(events[0][1], ['create', '-i', '--pull=never', '--label', 'cloud.integration.owner=' + owner,
      '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
      '--memory', '128m', '--memory-swap', '128m', '--pids-limit', '32', '--workdir', kind === 'cloud' ? '/app' : '/waitron',
      '--entrypoint', 'node', image, '--input-type=module', '-', kind]);
    });
  }
  let commands = 0;
  for (const options of [{image: 'mutable:tag', kind: 'cloud', runId: owner}, {image, kind: 'private', runId: owner}, {image, kind: 'cloud', runId: 'invalid'}]) {
    await assert.rejects(probeIntegrationAssets({...options, own() {}, docker: async () => {commands++;}}));
  }
  assert.equal(commands, 0);
  const owned = [];
  await assert.rejects(probeIntegrationAssets({image, kind: 'cloud', runId: owner, own: id => owned.push(id),
    docker: async args => {if (args[0] === 'create') return id; throw Error('reading failed');}}), /reading failed/);
  assert.deepEqual(owned, [id]);
});
