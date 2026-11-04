import assert from 'node:assert/strict';

export async function completeCleanup(steps) {
  const failed = [];
  for (const step of steps) {try {await step.run();} catch {failed.push(step.phase);}}
  if (failed.length) throw Error('integration.cleanup_failed:' + failed.join(','));
}

function json(text) {
  try {return JSON.parse(text);} catch {throw Error('integration.invalid_json');}
}
const lines = text => text.split(/\s+/).filter(Boolean);

export function integrationOwnershipOverride(rendered, runId) {
  assert.match(runId, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  return Object.fromEntries(['services', 'networks', 'volumes'].map(kind => [kind,
    Object.fromEntries(Object.entries(rendered[kind] ?? {}).map(([name, value]) => {
      assert.ok(!value.external, 'integration.external_resource');
      return [name, {labels: {'cloud.integration.owner': runId}}];
    })),
  ]));
}

// A project name locates resources; only this run's creation record or owner label authorises removal.
export async function cleanupTestCloudResources({docker, project, runId, created, removed, owned, started,
  verifier, built, recoveryBuilt, clientTag, recoveryTag, inventory, protectedUnchanged}) {
  let verifierUncertain = Boolean(verifier?.worker && verifier.started);
  const known = (kind, id) => created.some(value => value.kind === kind && value.id === id && value.owner === runId);
  const record = (kind, id) => {if (!known(kind, id)) created.push({kind, id, owner: runId});};
  const markRemoved = (kind, id) => {
    const value = created.find(value => value.kind === kind && value.id === id && value.owner === runId);
    assert.ok(value, 'integration.cleanup_unowned');
    if (!removed.some(row => row.kind === kind && row.id === id)) removed.push(value);
  };
  await completeCleanup([
    {phase: 'verifier', run: async () => {
      if (!verifier?.worker) return;
      if (verifier.started) {
        await docker(['stop', '--time', '15', verifier.worker], '', 'verifier-cleanup-stop');
        await verifier.readScope();
        verifierUncertain = false;
      }
      for (const id of await verifier.children()) {owned.push(id); record('container', id);}
    }},
    {phase: 'discover-containers', run: async () => {
      if (!started) return;
      const ids = lines(await docker(['ps', '-aq', '--no-trunc', '--filter', 'label=com.docker.compose.project=' + project]));
      let foreign = false;
      for (const id of ids) {
        assert.match(id, /^[a-f0-9]{64}$/);
        const [row] = json(await docker(['inspect', id]));
        assert.equal(row.Id, id);
        const labels = row.Config.Labels;
        if (labels['com.docker.compose.project'] !== project || !known('container', id) && labels['cloud.integration.owner'] !== runId) {
          foreign = true; continue;
        }
        owned.push(id); record('container', id);
      }
      assert.equal(foreign, false, 'integration.foreign_project_resource');
    }},
    {phase: 'containers', run: () => completeCleanup([...new Set(owned)].map(id => ({phase: 'container', run: async () => {
      assert.ok(known('container', id), 'integration.cleanup_unowned');
      await docker(['rm', '-f', '-v', id], '', 'owned-container-cleanup'); markRemoved('container', id);
    }})))},
    ...['network', 'volume'].map(kind => ({phase: kind, run: async () => {
      if (!started) return;
      // The named state volume is the only way to recover children after an uncertain stop or scope read.
      if (kind === 'volume' && verifierUncertain) throw Error('integration.verifier_state_retained');
      const listing = [kind, 'ls', '-q', ...(kind === 'network' ? ['--no-trunc'] : [])];
      const ids = lines(await docker([...listing, '--filter', 'label=com.docker.compose.project=' + project]));
      let foreign = false;
      const removable = [];
      for (const id of ids) {
        const [row] = json(await docker([kind, 'inspect', id]));
        assert.equal(kind === 'volume' ? row.Name : row.Id, id);
        if (row.Labels['com.docker.compose.project'] !== project || !known(kind, id) && row.Labels['cloud.integration.owner'] !== runId) {
          foreign = true; continue;
        }
        record(kind, id); removable.push(id);
      }
      await completeCleanup(removable.map(id => ({phase: kind, run: async () => {
        await docker([kind, 'rm', id], '', 'owned-' + kind + '-cleanup'); markRemoved(kind, id);
      }})));
      assert.equal(foreign, false, 'integration.foreign_project_resource');
      assert.equal(await docker([...listing, '--filter', 'label=cloud.integration.owner=' + runId]), '', 'integration.cleanup_' + kind);
    }})),
    ...[[built, clientTag, 'image'], [recoveryBuilt, recoveryTag, 'recovery-image']].map(([ready, tag, phase]) => ({phase, run: async () => {
      if (!ready) return;
      const [info] = json(await docker(['image', 'inspect', tag]));
      assert.equal(info.Config.Labels['cloud.integration.owner'], runId);
      assert.ok(known('image', info.Id), 'integration.cleanup_unowned');
      await docker(['image', 'rm', tag], '', 'owned-' + phase + '-cleanup'); markRemoved('image', info.Id);
    }})),
    {phase: 'inventory', run: async () => {
      const after = await inventory(); await protectedUnchanged(after);
      for (const id of owned) assert.ok(!after.some(row => row.startsWith(id + ' ')), 'integration.owned_container_remains');
    }},
  ]);
}
