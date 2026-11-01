import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';

const providerDenied = error => error?.$metadata?.httpStatusCode === 403;

// A connection failure cannot demonstrate that the provider removed an old key.
export async function waitForStorageWithdrawal({put, get, startedAt, now = Date.now, pause = delay}) {
  assert.ok(Number.isSafeInteger(startedAt) && startedAt >= 0 && startedAt <= now(), 'integration.storage_commit_time');
  while (now() - startedAt < 30000) {
    let refused = false;
    try {await put();} catch (error) {if (!providerDenied(error)) throw error; refused = true;}
    if (refused) {
      let readRefused = false;
      try {await get();} catch (error) {if (!providerDenied(error)) throw error; readRefused = true;}
      assert.equal(readRefused, true, 'integration.storage_read_still_allowed');
      assert.ok(now() - startedAt < 30000, 'integration.storage_withdrawal_required');
      return {writeStatus: 403, readStatus: 403, durationMs: now() - startedAt};
    }
    await pause(Math.min(100, 30000 - (now() - startedAt)));
  }
  throw Error('integration.storage_withdrawal_required');
}
