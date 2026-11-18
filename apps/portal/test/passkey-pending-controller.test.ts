import assert from 'node:assert/strict';
import {test} from 'node:test';
import {setImmediate as nextTurn} from 'node:timers/promises';
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
        enroll: [{path: '/passkeys/registration/options', body: {}}],
        remove: [{path: '/passkeys/remove', body: {id: existing.id}}, {path: '/passkeys', body: undefined}],
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

function holdList() {
  let finish!: (result: ApiResult<{passkeys: PasskeySummary[]}>) => void;
  const reply = new Promise<ApiResult<{passkeys: PasskeySummary[]}>>(resolve => {finish = resolve;});
  return {reply, finish};
}

function listController(...lists: ReturnType<typeof holdList>[]) {
  const calls: string[] = [];
  const request = async <T>(path: string): Promise<ApiResult<T>> => {
    const list = lists[calls.length];
    calls.push(path);
    if (path === '/passkeys' && list) return await list.reply as ApiResult<T>;
    if (path === '/passkeys') return {ok: true, value: {passkeys: [added]} as T};
    return {ok: false, status: 503, code: 'unavailable', retryAfterMs: 0};
  };
  const controller = new PasskeyController(() => {}, request);
  controller.account('owner');
  return {controller, calls};
}

test('an accepted enrolment waiting on the list cannot follow a switch to another account', async () => {
  const oldList = holdList();
  const {controller, calls} = listController(oldList);
  const readingOldAccount = controller.load();
  const enrolling = controller.enrollAfterList();
  assert.deepEqual(calls, ['/passkeys']);
  controller.account('second');
  await controller.load();
  oldList.finish({ok: true, value: {passkeys: [existing]}});
  await Promise.all([readingOldAccount, enrolling]);
  assert.deepEqual(calls, ['/passkeys', '/passkeys']);
  assert.deepEqual(controller.passkeys, [added]);
});

test('a click after navigation does not wait for the previous page’s list', async () => {
  const list = holdList();
  const {controller, calls} = listController(list);
  const loading = controller.load();
  controller.fence();
  const enrolling = controller.enrollAfterList();
  try {
    await nextTurn();
    assert.deepEqual([...calls], ['/passkeys', '/passkeys/registration/options']);
  } finally {
    list.finish({ok: true, value: {passkeys: [existing]}});
    await Promise.all([loading, enrolling]);
  }
});

test('the previous page’s list cannot cancel the wait for its replacement', async () => {
  const oldList = holdList(), newList = holdList();
  const {controller, calls} = listController(oldList, newList);
  const previous = controller.load();
  controller.fence();
  const current = controller.load();
  oldList.finish({ok: true, value: {passkeys: [existing]}});
  await previous;
  const enrolling = controller.enrollAfterList();
  newList.finish({ok: true, value: {passkeys: [added]}});
  await Promise.all([current, enrolling]);
  assert.deepEqual(calls, ['/passkeys', '/passkeys', '/passkeys/registration/options']);
});
