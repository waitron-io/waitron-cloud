import { test } from 'node:test';
import assert from 'node:assert/strict';
const diagnostic = await import('./worker-diagnostic.mjs').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === new URL('./worker-diagnostic.mjs', import.meta.url).href) return {};
  throw error;
});

for (const stage of ['configuration', 'storage-open', 'replay', 'storage-cleanup', 'result']) {
  test('workerDiagnosticAdmitsOnlyTheFixedStage_' + stage, () => {
    assert.equal(typeof diagnostic.workerFailureStage, 'function', 'validate the closed worker diagnostic before recording it');
    assert.equal(diagnostic.workerFailureStage({ schemaVersion: 1, stage }), stage);
  });
}

for (const [name, value] of Object.entries({
  null: null, array: [], missingVersion: { stage: 'replay' }, missingStage: { schemaVersion: 1 },
  futureVersion: { schemaVersion: 2, stage: 'replay' }, stringVersion: { schemaVersion: '1', stage: 'replay' },
  privateStage: { schemaVersion: 1, stage: 'PRIVATE_STAGE_CANARY' },
  rawError: { schemaVersion: 1, stage: 'replay', error: 'PRIVATE_ERROR_CANARY' },
  numericExtra: { schemaVersion: 1, stage: 'replay', extra: 1 },
  prototype: Object.assign(Object.create({ inherited: true }), { schemaVersion: 1, stage: 'replay' }),
  symbol: { schemaVersion: 1, stage: 'replay', [Symbol('PRIVATE_SYMBOL_CANARY')]: 1 },
})) test('workerDiagnosticRefusesUnrecognisedEvidence_' + name, () => {
  assert.equal(typeof diagnostic.workerFailureStage, 'function', 'validate the closed worker diagnostic before recording it');
  assert.throws(() => diagnostic.workerFailureStage(value), { message: 'Invalid cloud cost worker diagnostic' });
});

test('workerDiagnosticRefusesAccessorsWithoutInvokingThem', () => {
  assert.equal(typeof diagnostic.workerFailureStage, 'function', 'validate the closed worker diagnostic before recording it');
  let reads = 0;
  const value = { schemaVersion: 1, get stage() { reads++; return 'replay'; } };
  assert.throws(() => diagnostic.workerFailureStage(value), { message: 'Invalid cloud cost worker diagnostic' });
  assert.equal(reads, 0);
});
