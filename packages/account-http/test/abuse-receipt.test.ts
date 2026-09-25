import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyCloudAbuseReceipt} from './abuse-receipt.ts';

const valid = () => ({
  schemaVersion: 1,
  cloudHead: 'a'.repeat(40),
  cloudDirty: false,
  measuredAt: '2026-09-25T18:00:00.000Z',
  environment: {node: 'v24.0.0', cpuModel: 'test cpu', cpuCount: 8},
  account: {
    sharedIp: {attempts: 12, admitted: 10, refused: 2},
    sharedAddress: {attempts: 31, admitted: 30, refused: 1, legitimateRefused: true},
    cooldown: {attempts: 8, accepted: 8, messagesQueued: 1},
    passwordHashMs: {samples: 8, min: 20, median: 24, max: 40},
    responseFloorMs: {
      known: {samples: 8, min: 300, median: 302, max: 350},
      unknown: {samples: 8, min: 300, median: 303, max: 351},
    },
  },
  operations: {
    pairingSharedIp: {attempts: 12, admitted: 10, refused: 2},
    recoverySharedIp: {attempts: 12, admitted: 10, refused: 2},
    pairingCodes: {guessedIds: 5, targetFailuresAfterGuesses: 0, knownIdFailures: 5, correctCodeRefused: true},
    recoveryCodes: {guessedIds: 5, targetFailuresAfterGuesses: 0, knownIdFailures: 5, correctCodeRefused: true},
  },
});

test('accepts a complete bounded abuse receipt', () => {
  assert.deepEqual(verifyCloudAbuseReceipt(valid()), valid());
});

test('rejects missing evidence and impossible relationships', () => {
  for (const mutate of [
    (receipt: ReturnType<typeof valid>) => {receipt.account.sharedIp.admitted = 11;},
    (receipt: ReturnType<typeof valid>) => {receipt.account.cooldown.messagesQueued = 2;},
    (receipt: ReturnType<typeof valid>) => {receipt.account.responseFloorMs.known.min = 284;},
    (receipt: ReturnType<typeof valid>) => {receipt.operations.pairingCodes.targetFailuresAfterGuesses = 1;},
    (receipt: ReturnType<typeof valid>) => {receipt.operations.recoveryCodes.correctCodeRefused = false;},
    (receipt: ReturnType<typeof valid>) => {delete (receipt.environment as Partial<typeof receipt.environment>).cpuModel;},
  ]) {
    const receipt = valid(); mutate(receipt);
    assert.throws(() => verifyCloudAbuseReceipt(receipt), /Invalid cloud abuse receipt/);
  }
});
