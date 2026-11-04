import assert from 'node:assert/strict';
import {test} from 'node:test';
import * as renewal from './test-fixtures/integration-renewal.mjs';

test('rollback transport forwards only fixed stage and error codes', () => {
  assert.equal(typeof renewal.rollbackRefusalDiagnostic, 'function', 'Rollback refusal detail is lost in transport');
  for (const [input, expected] of [
    ['private-key integration.rollback_refused:drain:cloud.busy private-password', ':integration.rollback_refused:drain:cloud.busy'],
    ['{"diagnostic":"integration.rollback_refused:prepare:ERR_ASSERTION"}', ':integration.rollback_refused:prepare:ERR_ASSERTION'],
    ['integration.rollback_refused:renew:cloud.unavailable', ':integration.rollback_refused:renew:cloud.unavailable'],
    ['integration.rollback_refused:drain:unknown', ':integration.rollback_refused:drain:unknown'],
    ['integration.rollback_refused:drain:private-key', ''],
    ['integration.rollback_refused:private-password:cloud.busy', ''],
    ['integration.rollback_refused:drain:cloud.busy-private-key', ''],
    ['private-password', ''],
  ]) assert.equal(renewal.rollbackRefusalDiagnostic(input), expected);
});
