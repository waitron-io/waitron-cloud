import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validReserve, validAllocationReceipt, validPaperHistory, manualPacket, readManualPacket } from '../src/fiscal-allocation-types.ts';
import { reserve, payload, date } from '../../../packages/fiscal-allocation/test/fixtures.ts';
const operator = { kind: 'recovery-key' as const, nodeId: 'replacement-node', eventId: 'restore-event' };
const binding = { ...reserve().binding, eventId: 'restore-event', targetNodeId: 'replacement-node', operatorId: operator };
const receipt = { payload: { ...payload(), state: 'consumed' as const, binding, approval: {
  version: 1 as const, ...structuredClone(binding), oldMachineOffline: true, oldMachineAbsent: false,
  noParallelRecovery: true, confirmedAt: date,
} }, keyId: 'a'.repeat(64), signature: Buffer.alloc(64, 1).toString('base64url') };
test('browser accepts an exact key-event reserve and consumed manual packet', () => {
  assert(validReserve({ ...reserve(), binding }));
  assert(validAllocationReceipt(receipt));
  assert.deepEqual(readManualPacket(manualPacket(receipt)), receipt);
});
for (const [name, bad] of Object.entries({ tag: { ...operator, kind: 'person' }, missing: { kind: 'recovery-key', nodeId: operator.nodeId }, extra: { ...operator, secret: 'no' }, node: { ...operator, nodeId: 'other' }, event: { ...operator, eventId: 'other' } })) test(`browser refuses recovery-key ${name} in reservation and receipt`, () => {
  assert.equal(validReserve({ ...reserve(), binding: { ...binding, operatorId: bad } }), false);
  assert.equal(validAllocationReceipt({ ...receipt, payload: { ...receipt.payload, binding: { ...binding, operatorId: bad } } }), false);
});
test('browser refuses a consumed approval that replaces the key event with a person', () => {
  assert.equal(validAllocationReceipt({ ...receipt, payload: { ...receipt.payload, approval: { ...receipt.payload.approval, operatorId: 'local-administrator' } } }), false);
});

test('browser accepts a paper consumption bound to the recovery-key event', () => {
  const { reservationEvidence, ...allocation } = payload().allocation;
  const history = { version: 1, operationId: reserve().operationId, venueId: reserve().venueId,
    scope: reserve().scope, custodyVersion: 'custody-1', registerRevision: '1', previousDigest: '0'.repeat(64),
    block: { payload: { version: 1, custodianId: 'custodian-1', generationId: 'generation-1', blockId: 'block-1', packVersion: 1,
      recipientVenueId: reserve().venueId, allocations: [{ ...allocation, source: 'paper', installationIdentity: 'P000042',
        series: allocation.series.map(s => ({ ...s, code: s.code.replace('C000042', 'P000042') })) }] }, signature: receipt.signature },
    consumptions: [{ payload: { version: 1, custodianId: 'custodian-1', blockDigest: 'a'.repeat(64), allocationId: allocation.allocationId,
      ...binding, consumedAt: date }, signature: receipt.signature }], transfers: [],
  };
  assert(validPaperHistory(history));
  assert.equal(validPaperHistory({ ...history, consumptions: [{ ...history.consumptions[0], payload: { ...history.consumptions[0]!.payload,
    operatorId: { ...operator, eventId: 'other-event' } } }] }), false);
});
