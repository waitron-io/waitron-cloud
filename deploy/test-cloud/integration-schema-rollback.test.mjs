import assert from 'node:assert/strict';
import {test} from 'node:test';

test('cold restore refuses a running, replaced or foreign container before touching its private volumes', async () => {
  const {checkColdRollbackProject} = await import('./test-fixtures/integration-schema-rollback.mjs').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  });
  assert.equal(typeof checkColdRollbackProject, 'function', 'Cold restore ownership gate is missing');
  const project = 'waitron-cloud-test-integration-12345678', image = 'sha256:' + 'a'.repeat(64);
  const ids = ['b'.repeat(64), 'c'.repeat(64)];
  const rows = ids.map((id, i) => ({Id: id, Image: image, State: {Running: false},
    Config: {Labels: {'com.docker.compose.project': project, 'com.docker.compose.service': i ? 'postgres' : 'account'}}}));
  const options = {project, image, account: ids[0], expectedIds: ids};
  assert.equal(checkColdRollbackProject(rows, options), true);
  for (const fault of ['running', 'foreign', 'replacement', 'wrong-image', 'missing', 'duplicate']) {
    const changed = structuredClone(rows);
    if (fault === 'running') changed[1].State.Running = true;
    if (fault === 'foreign') changed[1].Config.Labels['com.docker.compose.project'] = 'foreign';
    if (fault === 'replacement') changed[1].Id = 'd'.repeat(64);
    if (fault === 'wrong-image') changed[0].Image = 'sha256:' + 'e'.repeat(64);
    if (fault === 'missing') changed.pop();
    if (fault === 'duplicate') changed.push(changed[0]);
    assert.throws(() => checkColdRollbackProject(changed, options), undefined, fault);
  }
});
