import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateReserve, validatePaperConsumption } from '../src/validation.ts';
import { signReceipt, encodeReceipt, decodeReceipt } from '../src/evidence.ts';
import { reserve, payload, key, date, allocationId } from './fixtures.ts';

const operator = { kind: 'recovery-key' as const, nodeId: 'replacement-node', eventId: 'restore-event' };
const binding = { ...reserve().binding, eventId: 'restore-event', targetNodeId: 'replacement-node', operatorId: operator };
const invalid = { code: 'invalid_input' };

// These controls catch lost attribution, a missing binding check and reference-only approval comparison.
test('reserve retains a person operator without substituting the Cloud account', () => {
  const input = { ...reserve(), binding: { ...binding, operatorId: 'local-administrator' } };
  assert.deepEqual(validateReserve(input).binding, input.binding);
});
test('reserve snapshots the exact recovery-key node and event independently', () => {
  const input = structuredClone({ ...reserve(), binding });
  const result = validateReserve(input);
  input.binding.operatorId.nodeId = 'changed';
  assert.deepEqual(result.binding.operatorId, operator);
  assert(Object.isFrozen(result.binding.operatorId));
});
for (const state of ['reserved', 'consumed', 'abandoned'] as const) test(`${state} signed receipt preserves recovery-key attribution through a manual packet`, () => {
  const signer = key();
  const value = { ...payload(), state, binding, approval: state === 'consumed' ? {
    version: 1 as const, ...structuredClone(binding), oldMachineOffline: true, oldMachineAbsent: false,
    noParallelRecovery: true, confirmedAt: date,
  } : null };
  const receipt = signReceipt(value, signer);
  const decoded = decodeReceipt(encodeReceipt(receipt), { issuer: signer.issuer, keys: new Map([[signer.keyId, signer.publicKey]]) });
  assert.deepEqual(decoded.payload.binding, binding);
  assert.deepEqual(decoded.payload.approval?.operatorId ?? decoded.payload.binding.operatorId, operator);
  const changed = { ...receipt, payload: { ...receipt.payload, binding: { ...receipt.payload.binding, operatorId: 'local-administrator' }, approval: receipt.payload.approval ? { ...receipt.payload.approval, operatorId: 'local-administrator' } : null } };
  assert.throws(() => decodeReceipt(encodeReceipt(changed), { issuer: signer.issuer, keys: new Map([[signer.keyId, signer.publicKey]]) }), { code: 'reservation_untrusted' });
});
for (const [name, bad] of Object.entries({
  tag: { ...operator, kind: 'person' }, extra: { ...operator, secret: 'forbidden' },
  missing: { kind: 'recovery-key', nodeId: operator.nodeId },
  empty: { ...operator, nodeId: '' }, long: { ...operator, eventId: 'x'.repeat(257) },
  control: { ...operator, nodeId: 'replacement\nnode' },
  node: { ...operator, nodeId: 'other-node' }, event: { ...operator, eventId: 'other-event' },
})) test(`reserve refuses malformed or substituted recovery-key ${name}`, () => {
  assert.throws(() => validateReserve({ ...reserve(), binding: { ...binding, operatorId: bad } }), invalid);
});
test('consumed approval cannot substitute a person for a recovery-key event', () => {
  assert.throws(() => signReceipt({ ...payload(), state: 'consumed', binding, approval: {
    version: 1, ...binding, operatorId: 'local-administrator', oldMachineOffline: true,
    oldMachineAbsent: false, noParallelRecovery: true, confirmedAt: date,
  } }, key()), invalid);
});
test('paper consumption retains the same exact recovery-key binding', () => {
  const value = { version: 1, custodianId: 'custodian-1', blockDigest: 'a'.repeat(64), allocationId,
    ...binding, consumedAt: date };
  assert.deepEqual(validatePaperConsumption(value).operatorId, operator);
});
