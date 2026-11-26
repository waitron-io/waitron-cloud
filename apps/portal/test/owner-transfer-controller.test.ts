import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {ApiResult} from '../src/api.ts';
import {OwnerTransferController} from '../src/owner-transfer-controller.ts';
import type {OwnerTransferList} from '../src/owner-transfer-types.ts';

test('the refresh after a rename wins over a delayed ownership transfer list', async () => {
  const organisationId = '00000000-0000-4000-8000-000000000001';
  const list = (name: string): OwnerTransferList => ({organisations: [{id: organisationId, name}], offers: []});
  let releaseOld!: (value: OwnerTransferList) => void;
  const oldReply = new Promise<OwnerTransferList>(resolve => { releaseOld = resolve; });
  let renamed = false;
  const controller = new OwnerTransferController(() => {}, async <T>(path: string): Promise<ApiResult<T>> => {
    assert.equal(path, '/owner-transfers');
    return {ok: true, value: (renamed ? list('Renamed Group') : await oldReply) as T};
  });
  controller.account('owner');

  const outdatedLoad = controller.load();
  renamed = true;
  await controller.load();
  const nameWhileOldReplyWasPending = controller.data.organisations[0]?.name;
  releaseOld(list('Original Group'));
  await outdatedLoad;

  assert.equal(controller.data.organisations[0]?.name, 'Renamed Group');
  assert.equal(nameWhileOldReplyWasPending, 'Renamed Group');
});
