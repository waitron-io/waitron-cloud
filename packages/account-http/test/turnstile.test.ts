import assert from 'node:assert/strict';
import {test} from 'node:test';
import {verifyTurnstile} from '../src/turnstile.ts';

async function verifyWith(fetcher: typeof fetch, action: 'signup' | 'password_reset' = 'signup') {
  return verifyTurnstile('test-secret', 'cloud.example.test', action, 'test-proof', fetcher);
}

test('Siteverify sends only the secret and proof to the fixed HTTPS endpoint', async () => {
  assert.equal(await verifyWith(async (target, options) => {
    assert.equal(target, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
    assert.equal(options?.method, 'POST');
    assert.equal(options?.redirect, 'error');
    assert.deepEqual([...options?.body as URLSearchParams], [['secret', 'test-secret'], ['response', 'test-proof']]);
    return Response.json({success: true, hostname: 'cloud.example.test', action: 'password_reset'});
  }, 'password_reset'), true);
});

for (const [name, response] of [
  ['redirect', () => new Response(null, {status: 302, headers: {location: 'https://other.example.test/'}})],
  ['upstream error', () => new Response(null, {status: 503})],
  ['oversize', () => new Response(' '.repeat(16_384) + '{"success":true,"hostname":"cloud.example.test","action":"signup"}')],
  ['bad JSON', () => new Response('{')],
  ['wrong hostname', () => Response.json({success: true, hostname: 'other.example.test', action: 'signup'})],
  ['wrong action', () => Response.json({success: true, hostname: 'cloud.example.test', action: 'password_reset'})],
  ['provider refusal', () => Response.json({success: false, hostname: 'cloud.example.test', action: 'signup'})],
] as const) {
  test(`Siteverify refuses ${name}`, async () => {
    assert.equal(await verifyWith(async () => response()), false);
  });
}

test('the Siteverify deadline covers an unfinished response body', async () => {
  let cancelled = false;
  const response = new Response(new ReadableStream({cancel() {cancelled = true;}}));
  assert.equal(await verifyWith(async () => response), false);
  assert.equal(cancelled, true);
});

test('Siteverify reports a rejected configured secret without logging credentials or proof', async t => {
  const error = t.mock.method(console, 'error', () => {});
  for (const status of [200, 400]) {
    const response = Response.json({success: false, 'error-codes': ['invalid-input-secret']}, {status});
    assert.equal(await verifyWith(async () => response), false);
  }
  assert.deepEqual(error.mock.calls.map(call => call.arguments), [
    ['Turnstile rejected the configured secret'], ['Turnstile rejected the configured secret'],
  ]);
});
