import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PasskeyController, type PasskeyBrowser} from '../src/passkey-controller.ts';
import type {ApiResult} from '../src/api.ts';
import type {PasskeySummary} from '../src/passkey-types.ts';

const existing: PasskeySummary = {
  id: '12345678-1234-4234-8234-123456789abc', createdAt: '2026-10-24T12:00:00Z', lastUsedAt: null,
};
const added: PasskeySummary = {
  id: '22345678-1234-4234-8234-123456789abc', createdAt: '2026-10-25T12:00:00Z', lastUsedAt: null,
};
const password = '  Current account password  ';

for (const action of ['load', 'refresh', 'signIn', 'enroll', 'remove'] as const) {
  test(`pending passkey list blocks direct ${action} until the read finishes`, async () => {
    const calls: Array<{path: string; body: unknown}> = [];
    let reads = 0, prompts = 0, changes = 0;
    let finish!: (result: ApiResult<{passkeys: PasskeySummary[]}>) => void;
    const reply = new Promise<ApiResult<{passkeys: PasskeySummary[]}>>(resolve => {finish = resolve;});
    const browser: PasskeyBrowser = {
      supported: async () => true,
      register: async () => {prompts++; throw new Error('Unexpected registration prompt');},
      authenticate: async () => {prompts++; throw new Error('Unexpected authentication prompt');},
    };
    const request = async <T>(path: string, body?: Record<string, unknown>): Promise<ApiResult<T>> => {
      calls.push({path, body: structuredClone(body)});
      if (path === '/passkeys') {
        reads++;
        if (reads === 2) return await reply as ApiResult<T>;
        return {ok: true, value: {passkeys: reads === 1 ? [existing] : [existing, added]} as T};
      }
      return {ok: false, status: 503, code: 'unavailable', retryAfterMs: 0};
    };
    const controller = new PasskeyController(() => {changes++;}, request, browser);
    controller.account('owner');
    await controller.checkSupport();
    await controller.load();
    controller.password = password;
    const loading = controller.load();
    try {
      assert.equal(controller.pending, true);
      assert.deepEqual(controller.passkeys, [existing]);
      const beforeChanges = changes;
      const invoke = () => action === 'enroll' ? controller.enroll(password)
        : action === 'remove' ? controller.remove(existing.id, password) : controller[action]();

      await invoke();
      assert.deepEqual(calls, [
        {path: '/passkeys', body: undefined}, {path: '/passkeys', body: undefined},
      ], 'a pending read rejects direct actions before any extra request');
      assert.equal(controller.password, password, 'a suppressed refresh must not clear the password');
      assert.equal(controller.pending, true, 'the original read still owns pending state');
      assert.deepEqual(controller.passkeys, [existing], 'a suppressed action retains the last-read rows');
      assert.equal(changes, beforeChanges, 'a suppressed action does not redraw or clear feedback');
      assert.equal(prompts, 0);

      finish({ok: true, value: {passkeys: [existing, added]}});
      await loading;
      assert.equal(controller.pending, false);
      assert.deepEqual(controller.passkeys, [existing, added]);
      assert.equal(controller.listLoaded, true);

      await invoke();
      const resumed = {
        load: [{path: '/passkeys', body: undefined}],
        refresh: [{path: '/passkeys', body: undefined}],
        signIn: [{path: '/passkeys/authentication/options', body: {}}],
        enroll: [{path: '/passkeys/registration/options', body: {password}}],
        remove: [{path: '/passkeys/remove', body: {id: existing.id, password}}, {path: '/passkeys', body: undefined}],
      };
      assert.deepEqual(calls.slice(2), resumed[action], 'completion permits the next explicit action');
      assert.equal(controller.pending, false);
      assert.equal(prompts, 0, 'refused options never open a browser prompt');
      assert.deepEqual(controller.passkeys, [existing, added]);
    } finally {
      finish({ok: true, value: {passkeys: [existing, added]}});
      await loading;
    }
  });
}
