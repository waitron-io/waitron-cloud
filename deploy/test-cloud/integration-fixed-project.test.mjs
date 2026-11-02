import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, mkdir, rm, access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'fixed-project-control-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const module = await import('./test-fixtures/integration-fixed-project.mjs').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  });
  assert.equal(typeof module.withFixedIntegrationProject, 'function', 'Fixed project admission is missing');
  return {lock: join(root, 'lock'), run: module.withFixedIntegrationProject};
}

test('fixed project admission holds its exclusive lock through the entire proof and releases it', async t => {
  const f = await setup(t); const calls = [];
  const result = await f.run({lock: f.lock, docker: async args => {calls.push(args); return '';}, run: async project => {
    assert.equal(project, 'waitron-cloud-test');
    await access(f.lock);
    await assert.rejects(f.run({lock: f.lock, docker: async () => {throw Error('Must not inspect a locked project');}, run: () => assert.fail()}), /EEXIST/);
    return 42;
  }});
  assert.equal(result, 42); await assert.rejects(access(f.lock), {code: 'ENOENT'});
  for (const resource of ['ps', 'network', 'volume', 'image']) assert.ok(calls.some(args => args[0] === resource), resource);
});

for (const resource of ['container-label', 'container-name', 'network-label', 'network-name', 'volume-label', 'volume-name', 'venue-image', 'recovery-image']) {
  test('fixed project admission refuses existing ' + resource + ' before running or cleaning it', async t => {
    const f = await setup(t); const calls = [];
    await assert.rejects(f.run({lock: f.lock, docker: async args => {
      calls.push(args);
      const kind = args[0] === 'ps' ? 'container' : args[0];
      const matches = resource === kind + '-label' && args.includes('label=com.docker.compose.project=waitron-cloud-test') ||
        resource === kind + '-name' && args.includes('name=^waitron-cloud-test[-_]') ||
        resource.endsWith('-image') && kind === 'image' && args.includes('reference=waitron-cloud-test-' + resource.split('-')[0] + ':*');
      return matches ? 'existing-resource' : '';
    }, run: () => assert.fail('An existing resource was admitted')}), /integration.fixed_project_in_use/);
    assert.ok(calls.every(args => args[0] === 'ps' || args[1] === 'ls'), 'Only read operations are allowed on refusal');
    await assert.rejects(access(f.lock), {code: 'ENOENT'});
  });
}

test('fixed project admission preserves another invocation lock', async t => {
  const f = await setup(t); await mkdir(f.lock);
  await assert.rejects(f.run({lock: f.lock, docker: () => assert.fail(), run: () => assert.fail()}), /EEXIST/);
  await access(f.lock);
});

test('fixed project admission releases only its lock after inspection or proof failure', async t => {
  const f = await setup(t);
  await assert.rejects(f.run({lock: f.lock, docker: async () => {throw Error('inventory failed');}, run: () => assert.fail()}), /inventory failed/);
  await assert.rejects(access(f.lock), {code: 'ENOENT'});
  await assert.rejects(f.run({lock: f.lock, docker: async () => '', run: async () => {throw Error('proof failed');}}), /proof failed/);
  await assert.rejects(access(f.lock), {code: 'ENOENT'});
});

test('cold rollback accepts the specified fixed project and still rejects foreign, live or wrong-image containers', async () => {
  const {checkColdRollbackProject} = await import('./test-fixtures/integration-schema-rollback.mjs');
  const account = 'a'.repeat(64), image = 'sha256:' + 'b'.repeat(64), project = 'waitron-cloud-test';
  const row = {Id: account, Image: image, Config: {Labels: {'com.docker.compose.project': project}}, State: {Running: false}};
  const options = {project, image, account, expectedIds: [account]};
  assert.equal(checkColdRollbackProject([row], options), true);
  for (const changed of [{...row, Image: 'sha256:' + 'c'.repeat(64)}, {...row, State: {Running: true}},
    {...row, Config: {Labels: {'com.docker.compose.project': 'waitron'}}}]) assert.throws(() => checkColdRollbackProject([changed], options));
  const foreign = {...row, Config: {Labels: {'com.docker.compose.project': 'waitron'}}};
  assert.throws(() => checkColdRollbackProject([foreign], {...options, project: 'waitron'}));
});
