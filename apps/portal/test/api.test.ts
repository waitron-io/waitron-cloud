import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountRequest } from '../src/api.ts';
test('account requests never retry writes and distinguish transport failures', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('private network detail'); });
  assert.deepEqual(await accountRequest('/signup/request', {email: 'owner@example.test',locale:'es'}),
    {ok:false,status:0,code:'network_error',retryAfterMs:0});
  assert.equal(calls, 1);
});
test('account requests validate success bodies and honor both Retry-After forms', async t => {
  const replies = [new Response('{}'), new Response('{"error":"rate_limited"}', {status:429,headers:{'retry-after':'90'}}),
    new Response('{"error":"temporarily_unavailable"}', {status:503,headers:{'retry-after':new Date(Date.now()+60_000).toUTCString()}})];
  t.mock.method(globalThis, 'fetch', async () => replies.shift()!);
  assert.equal((await accountRequest('/session')).ok, false);
  const limited = await accountRequest('/signup/request', {email:'owner@example.test'});
  assert.deepEqual(limited, {ok:false,status:429,code:'rate_limited',retryAfterMs:90_000});
  const unavailable = await accountRequest('/session');
  assert.ok(!unavailable.ok && unavailable.retryAfterMs > 58_000);
});
