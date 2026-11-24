import {expect, vi} from 'vitest';
import {createFirstSetupCoordinator} from '@waitron/provisioning';
import {createInteractiveRecoveryPreparation} from './recovery-preparation.js';
import {createFakeTimersHourClock, recoverySelectPastWaits} from './testing/hour-test-clock.js';

export async function integrationRestoreKey(authority) {
  if (!Number.isInteger(authority.number)) {
    return {variable: 'WAITRON_NODE_RECOVERY_KEY', wrongKey: 'wrong node key'};
  }
  const {makeMasterKey} = await import('@waitron/credentials');
  const {encodeMasterKeyCode} = await import('@waitron/shared');
  return {variable: 'WAITRON_MASTER_KEY', wrongKey: encodeMasterKeyCode(makeMasterKey())};
}

// The native minute fixture moves both clocks through each wait and requires fresh comparison after restart.
export async function prepareCurrentIntegrationRecovery({copy, sourceId, binding, secret, roots}) {
  vi.useFakeTimers({toFake: ['Date', 'performance']});
  const clock = createFakeTimersHourClock();
  const coordinator = createFirstSetupCoordinator();
  const options = {...roots, coordinator};
  const first = createInteractiveRecoveryPreparation(options);
  const invoke = (service, proposal, client) => coordinator.run(hold => service.prepare(copy, sourceId, {
    binding, context: {selectedSourceId: sourceId, oldBoxGone: true, soleRecovery: true},
    nodeRecoverySecret: secret, proposal,
  }, hold, client));
  const select = service => recoverySelectPastWaits(clock, {
    prepare: (proposal, client) => invoke(service, proposal, client),
  }, {onBox: false});
  const selected = await select(first);
  expect(selected).toMatchObject({status: 'selected'});
  expect(selected.input).toBeDefined();
  const restarted = createInteractiveRecoveryPreparation(options);
  await expect(invoke(restarted, {action: 'select', comparisonId: 'no-comparison'}, {onBox: false}))
    .rejects.toMatchObject({code: 'sif.allocation_invalid', params: {reason: 'clock_stale'}});
  const reopened = await select(restarted);
  expect(reopened).toEqual(selected);
  return reopened;
}
