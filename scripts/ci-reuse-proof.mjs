import assert from 'node:assert/strict';

export const workflowPaths = Object.freeze([
  '.github/workflows/ci.yml',
  '.github/workflows/aws-infrastructure.yml',
  '.github/workflows/cloud-cost.yml',
  '.github/workflows/venue-services-proof.yml',
  '.github/workflows/download-supervision-diagnostic.yml',
]);

export function assertReuseProof(proof, workflowPath) {
  assert.ok(proof && typeof proof === 'object', 'Missing reuse proof');
  assert.deepEqual(Object.keys(proof).sort(), ['version', 'repository', 'repositoryId', 'pr', 'mergeSha', 'sha', 'tree',
    'workflowId', 'workflowPath', 'runId', 'attempt', 'planDigest', 'jobsDigest'].sort(), 'Incomplete reuse proof');
  assert.equal(proof.version, 1, 'Unsupported reuse proof');
  assert.equal(proof.repository, 'waitron-io/waitron-cloud', 'Wrong reuse repository');
  for (const key of ['repositoryId', 'pr', 'workflowId', 'runId', 'attempt']) {
    assert.ok(Number.isSafeInteger(proof[key]) && proof[key] > 0, `Invalid reuse ${key}`);
  }
  for (const key of ['mergeSha', 'sha', 'tree']) assert.match(proof[key], /^(?!0{40}$)[a-f0-9]{40}$/, `Invalid reuse ${key}`);
  for (const key of ['planDigest', 'jobsDigest']) assert.match(proof[key], /^[a-f0-9]{64}$/, `Invalid reuse ${key}`);
  assert.ok(workflowPaths.includes(proof.workflowPath), 'Unknown reuse workflow');
  assert.equal(proof.workflowPath, workflowPath, 'Wrong reuse workflow');
}
