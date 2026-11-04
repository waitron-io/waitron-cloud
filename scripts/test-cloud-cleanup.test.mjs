import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, mkdir, writeFile, readFile, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const project = 'waitron-cloud-test', runId = '00000000-0000-4000-8000-000000000001';
const worker = 'a'.repeat(64), own = 'b'.repeat(64), foreign = 'f'.repeat(64);

test('Compose ownership binds every created service, network and volume to this run', async () => {
  const api = await import('./test-cloud-cleanup.mjs');
  assert.equal(typeof api.integrationOwnershipOverride, 'function', 'Compose resources have no run ownership');
  const rendered = {services: {account: {}, postgres: {}}, networks: {default: {}}, volumes: {config: {}, data: {}}};
  const result = api.integrationOwnershipOverride(rendered, runId);
  for (const [kind, names] of Object.entries({services: ['account', 'postgres'], networks: ['default'], volumes: ['config', 'data']})) {
    assert.deepEqual(Object.keys(result[kind]), names);
    for (const name of names) assert.equal(result[kind][name].labels['cloud.integration.owner'], runId);
  }
  for (const kind of ['networks', 'volumes']) {
    const external = structuredClone(rendered); external[kind].shared = {external: true};
    assert.throws(() => api.integrationOwnershipOverride(external, runId), /integration.external_resource/);
  }
});

async function fixture(fault, check) {
  const root = await mkdtemp(join(tmpdir(), 'cloud-cleanup-'));
  try {
    const names = [worker, own, foreign, project + '-verifier-state', project + '-foreign'];
    for (const name of names) {await mkdir(join(root, name)); await writeFile(join(root, name, 'state'), name);}
    const created = [worker, own].map(id => ({kind: 'container', id, owner: runId}));
    created.push({kind: 'volume', id: project + '-verifier-state', owner: runId});
    const removed = [], events = [];
    const labels = id => ({'com.docker.compose.project': project,
      ...(id === foreign || id === project + '-foreign' ? {} : {'cloud.integration.owner': runId})});
    const docker = async args => {
      events.push(args);
      if (args[0] === 'stop') {if (fault === 'stop') throw Error('daemon refused'); return '';}
      if (args[0] === 'ps') return [worker, own, ...(fault === 'owned-only' ? [] : [foreign])].join('\n');
      if (args[0] === 'inspect') return JSON.stringify(args.slice(1).map(id => ({Id: id, Config: {Labels: labels(id)}})));
      if (args[0] === 'volume' && args[1] === 'ls') {
        const ownerOnly = args.includes('label=cloud.integration.owner=' + runId);
        const present = [];
        try {await stat(join(root, project + '-verifier-state')); present.push(project + '-verifier-state');} catch {}
        if (!ownerOnly && fault !== 'owned-only') present.push(project + '-foreign');
        return present.join('\n');
      }
      if (args[0] === 'volume' && args[1] === 'inspect') return JSON.stringify([{Name: args[2], Labels: labels(args[2])}]);
      if (args[0] === 'network' && args[1] === 'ls') return '';
      if (args[0] === 'rm' || args[0] === 'volume' && args[1] === 'rm') {await rm(join(root, args.at(-1)), {recursive: true}); return '';}
      throw Error('unexpected Docker boundary: ' + args[0]);
    };
    const api = await import('./test-cloud-cleanup.mjs').catch(error => {
      if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url?.endsWith('/test-cloud-cleanup.mjs')) return {};
      throw error;
    });
    assert.equal(typeof api.cleanupTestCloudResources, 'function', 'The ownership-preserving cleanup boundary is missing');
    let scopeRead = false;
    const run = () => api.cleanupTestCloudResources({docker, project, runId, created, removed, owned: [worker, own], started: true,
      verifier: {worker, started: true, readScope: async () => {scopeRead = true; if (fault === 'scope') throw Error('unreadable scope');}, children: async () => []},
      protectedUnchanged: async () => {}, inventory: async () => [foreign + ' true']});
    await check({run, root, events, created, removed, scopeRead: () => scopeRead});
  } finally {await rm(root, {recursive: true, force: true});}
}

for (const fault of ['stop', 'scope']) test('failed verifier ' + fault + ' retains its durable ownership state and foreign resources', async () => {
  await fixture(fault, async f => {
    await assert.rejects(f.run(), /integration.cleanup_failed/);
    assert.equal(await readFile(join(f.root, project + '-verifier-state', 'state'), 'utf8'), project + '-verifier-state');
    assert.equal(await readFile(join(f.root, project + '-foreign', 'state'), 'utf8'), project + '-foreign');
    assert.equal(await readFile(join(f.root, foreign, 'state'), 'utf8'), foreign);
    assert.equal(f.scopeRead(), fault !== 'stop');
    for (const id of [worker, own]) await assert.rejects(stat(join(f.root, id)), {code: 'ENOENT'});
    assert.deepEqual(f.created.filter(v => v.id === foreign || v.id === project + '-foreign'), []);
  });
});

test('cleanup removes its recorded state only after scope is known and refuses to adopt a foreign project resource', async () => {
  await fixture(undefined, async f => {
    await assert.rejects(f.run(), /integration.cleanup_failed/);
    await assert.rejects(stat(join(f.root, project + '-verifier-state')), {code: 'ENOENT'});
    assert.equal(await readFile(join(f.root, foreign, 'state'), 'utf8'), foreign);
    assert.equal(await readFile(join(f.root, project + '-foreign', 'state'), 'utf8'), project + '-foreign');
    assert.deepEqual(f.removed.map(v => v.id).sort(), [worker, own, project + '-verifier-state'].sort());
  });
});

test('confirmed verifier cleanup removes the complete owned resource set', async () => {
  await fixture('owned-only', async f => {
    await f.run();
    assert.deepEqual(f.removed.map(v => v.id).sort(), f.created.map(v => v.id).sort());
    for (const id of [worker, own, project + '-verifier-state']) await assert.rejects(stat(join(f.root, id)), {code: 'ENOENT'});
  });
});

test('network cleanup uses the full engine identity rather than a shortened listing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-network-cleanup-')), id = 'e'.repeat(64);
  try {
    await writeFile(join(root, id), 'owned network'); const created = [], removed = [];
    const {cleanupTestCloudResources} = await import('./test-cloud-cleanup.mjs');
    const docker = async args => {
      if (args[0] === 'ps' || args[0] === 'volume') return '';
      if (args[0] === 'network' && args[1] === 'ls') {
        try {await stat(join(root, id)); return args.includes('--no-trunc') ? id : id.slice(0, 12);} catch {return '';}
      }
      if (args[0] === 'network' && args[1] === 'inspect') return JSON.stringify([{Id: id,
        Labels: {'com.docker.compose.project': project, 'cloud.integration.owner': runId}}]);
      if (args[0] === 'network' && args[1] === 'rm') {assert.equal(args[2], id); await rm(join(root, id)); return '';}
      throw Error('unexpected Docker boundary');
    };
    await cleanupTestCloudResources({docker, project, runId, created, removed, owned: [], started: true,
      inventory: async () => [], protectedUnchanged: async () => {}});
    assert.deepEqual(removed, [{kind: 'network', id, owner: runId}]);
    await assert.rejects(stat(join(root, id)), {code: 'ENOENT'});
  } finally {await rm(root, {recursive: true, force: true});}
});

test('a retagged image cannot be removed using another recorded image identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-image-cleanup-'));
  try {
    const path = join(root, 'foreign-image'); await writeFile(path, 'keep this image');
    const {cleanupTestCloudResources} = await import('./test-cloud-cleanup.mjs');
    const removed = [], created = [{kind: 'image', id: 'sha256:' + 'a'.repeat(64), owner: runId}];
    const docker = async args => {
      if (args[0] === 'image' && args[1] === 'inspect') return JSON.stringify([{Id: 'sha256:' + 'f'.repeat(64), Config: {Labels: {'cloud.integration.owner': runId}}}]);
      if (args[0] === 'image' && args[1] === 'rm') {await rm(path); return '';}
      throw Error('unexpected Docker boundary');
    };
    await assert.rejects(cleanupTestCloudResources({docker, project, runId, created, removed, owned: [], started: false,
      built: true, clientTag: project + '-venue:local', inventory: async () => [], protectedUnchanged: async () => {}}), /integration.cleanup_failed:image/);
    assert.equal(await readFile(path, 'utf8'), 'keep this image');
    assert.deepEqual(removed, []);
  } finally {await rm(root, {recursive: true, force: true});}
});

test('the actual runner preserves a foreign container and volume appearing after Compose admission', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-runner-cleanup-'));
  try {
    const bin = join(root, 'bin'); await mkdir(bin);
    for (const name of [foreign, 'foreign-volume']) await writeFile(join(root, name), 'another session owns this');
    await writeFile(join(bin, 'docker'), `#!${process.execPath}
import {readFileSync,writeFileSync,appendFileSync,rmSync,existsSync} from 'node:fs';
const args=process.argv.slice(2),root=process.env.CLEANUP_TEST_ROOT;
appendFileSync(root+'/commands.jsonl',JSON.stringify(args)+'\\n');
let state=existsSync(root+'/state.json')?JSON.parse(readFileSync(root+'/state.json')):{};
const save=()=>writeFileSync(root+'/state.json',JSON.stringify(state));
const output=value=>process.stdout.write(typeof value==='string'?value:JSON.stringify(value));
if(args[0]==='image'&&args[1]==='inspect')output([{Id:args[2].includes('venue:local')?'sha256:'+'d'.repeat(64):'sha256:'+'c'.repeat(64),RepoTags:['waitron-test:local'],Config:{Labels:{'cloud.waitron-revision':'ec91a9e34d2daba146f4ee61850ea4136ad5cfb7','cloud.integration.owner':state.owner}}}]);
else if(args[0]==='build'){state.owner=args.find(a=>a.startsWith('cloud.integration.owner=')).split('=')[1];state.project=args[args.indexOf('-t')+1].replace('-venue:local','');save();}
else if(args[0]==='compose'){
 if(args.includes('config'))output({services:{account:{},postgres:{}},networks:{default:{}},volumes:{config:{}}});
 else if(args.includes('up')){state.started=true;save();}
 else if(args.includes('ps'))process.exit(33);
 else process.exit(34);
}else if(args[0]==='ps')output(state.started&&existsSync(root+'/${foreign}')?'${foreign}':'');
else if(args[0]==='inspect')output([{Id:args[1],Config:{Labels:{'com.docker.compose.project':state.project}}}]);
else if(args[0]==='volume'&&args[1]==='ls')output(state.started&&existsSync(root+'/foreign-volume')?state.project+'_foreign-data':'');
else if(args[0]==='volume'&&args[1]==='inspect')output([{Name:args[2],Labels:{'com.docker.compose.project':state.project}}]);
else if(args[0]==='network'&&args[1]==='ls')output('');
else if(args[0]==='rm')rmSync(root+'/'+args.at(-1));
else if(args[0]==='volume'&&args[1]==='rm')rmSync(root+'/foreign-volume');
else if(args[0]==='image'&&args[1]==='rm'){}
else process.exit(35);
`, {mode: 0o700});
    const runner = process.env.TEST_CLOUD_CLEANUP_RUNNER ?? new URL('./test-cloud-integration.mjs', import.meta.url).href;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
import assert from 'node:assert/strict';
import {runTestCloudClients} from ${JSON.stringify(runner)};
await assert.rejects(runTestCloudClients({image:'sha256:'+'b'.repeat(64),waitronImage:'sha256:'+'c'.repeat(64)}));
`], {encoding: 'utf8', timeout: 15000, env: {...process.env, CLEANUP_TEST_ROOT: root, PATH: bin + ':' + process.env.PATH}});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(join(root, foreign), 'utf8'), 'another session owns this');
    assert.equal(await readFile(join(root, 'foreign-volume'), 'utf8'), 'another session owns this');
    const commands = (await readFile(join(root, 'commands.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.ok(commands.some(args => args[0] === 'compose' && args.includes('up')), 'The actual runner must reach Compose admission');
    assert.ok(commands.some(args => args[0] === 'image' && args[1] === 'rm'), 'Owned cleanup must still finish');
  } finally {await rm(root, {recursive: true, force: true});}
});
