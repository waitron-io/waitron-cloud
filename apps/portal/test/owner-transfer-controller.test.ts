import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {ApiResult} from '../src/api.ts';
import {OwnerTransferController} from '../src/owner-transfer-controller.ts';
import type {OwnerTransferList} from '../src/owner-transfer-types.ts';

const organisationId = '00000000-0000-4000-8000-000000000001';
const list = (name: string): OwnerTransferList => ({organisations: [{id: organisationId, name}], offers: []});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return {promise, resolve};
}

for (const newerFirst of [true, false]) {
  test(`the rename refresh wins when the ${newerFirst ? 'newer' : 'older'} list replies first`, async () => {
    const oldReply = deferred<OwnerTransferList>();
    const newReply = deferred<OwnerTransferList>();
    let renamed = false;
    const controller = new OwnerTransferController(() => {}, async <T>(path: string): Promise<ApiResult<T>> => {
      assert.equal(path, '/owner-transfers');
      return {ok: true, value: await (renamed ? newReply.promise : oldReply.promise) as T};
    });
    controller.account('owner');

    const outdatedLoad = controller.load();
    renamed = true;
    const refresh = controller.load();
    if (newerFirst) {
      newReply.resolve(list('Renamed Group'));
      await refresh;
      assert.equal(controller.data.organisations[0]?.name, 'Renamed Group');
      oldReply.resolve(list('Original Group'));
      await outdatedLoad;
    } else {
      oldReply.resolve(list('Original Group'));
      await outdatedLoad;
      assert.deepEqual(controller.data.organisations, []);
      assert.equal(controller.pending, true);
      assert.equal(await controller.act('cancel', 'en', 'offer'), false);
      newReply.resolve(list('Renamed Group'));
      await refresh;
    }

    assert.equal(controller.data.organisations[0]?.name, 'Renamed Group');
    assert.equal(controller.pending, false);
  });
}

for (const refreshSucceeds of [true, false]) {
  test(refreshSucceeds ? 'a rename refresh is kept while a transfer is checking its result'
    : 'a failed rename refresh does not turn a confirmed transfer into an uncertain one', async () => {
    const transferRead = deferred<OwnerTransferList>();
    const transferReadStarted = deferred<void>();
    let phase: 'initial' | 'transfer' | 'renamed' = 'initial';
    const controller = new OwnerTransferController(() => {}, async <T>(path: string): Promise<ApiResult<T>> => {
      if (path === '/owner-transfers/create') {
        phase = 'transfer';
        return {ok: true, value: {status: 'accepted'} as T};
      }
      assert.equal(path, '/owner-transfers');
      if (phase === 'transfer') {
        transferReadStarted.resolve();
        return {ok: true, value: await transferRead.promise as T};
      }
      if (phase === 'renamed' && !refreshSucceeds) {
        return {ok: false, status: 500, code: 'unavailable', retryAfterMs: 0};
      }
      return {ok: true, value: list(phase === 'renamed' ? 'Renamed Group' : 'Original Group') as T};
    });
    controller.account('owner');
    await controller.load();
    controller.email = 'recipient@example.test';

    const transfer = controller.act('create', 'en');
    await transferReadStarted.promise;
    phase = 'renamed';
    await controller.load();
    transferRead.resolve(list('Original Group'));

    assert.equal(await transfer, true);
    assert.equal(controller.data.organisations[0]?.name, refreshSucceeds ? 'Renamed Group' : 'Original Group');
    assert.equal(controller.error, undefined);
    assert.equal(controller.pending, false);
  });
}
