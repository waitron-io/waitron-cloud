import assert from 'node:assert/strict';
import {test} from 'node:test';
import {accountRequest} from '../src/api.ts';

const flows = [
  {path: '/signup/request', status: 202,
    body: {email: 'owner@example.test', locale: 'es'}, value: {status: 'accepted'}},
  {path: '/password-reset/request', status: 202,
    body: {email: 'owner@example.test', locale: 'en'}, value: {status: 'accepted'}},
  {path: '/signup/complete', status: 201,
    body: {token: 'signup-link', password: ' exact password ', legalBusinessName: 'Café SL',
      organisationName: 'Café', countryCode: 'ES'},
    value: {accountId: 'owner', organisationId: 'organisation', legalBusinessId: 'business'}},
  {path: '/password-reset/complete', status: 200,
    body: {token: 'reset-link', password: ' exact password ', locale: 'es'}, value: {status: 'completed'}},
] as const;

for (const flow of flows) {
  const invalid: {name: string; value: unknown}[] = [
    {name: 'null', value: null},
    {name: 'array', value: []},
    {name: 'string', value: 'accepted'},
    {name: 'empty object', value: {}},
  ];
  if (flow.path === '/signup/complete') {
    for (const field of ['accountId', 'organisationId', 'legalBusinessId']) {
      for (const [name, value] of [['missing', undefined], ['null', null], ['numeric', 42]] as const) {
        invalid.push({name: `${name} ${field}`, value: {...flow.value, [field]: value}});
      }
    }
    invalid.push({name: 'empty account ID', value: {...flow.value, accountId: ''}});
  } else {
    for (const status of ['pending', 'changed', true, 202, null]) {
      invalid.push({name: `wrong status ${String(status)}`, value: {status}});
    }
    invalid.push({name: 'another operation acknowledgement', value: {
      status: flow.path.endsWith('/request') ? 'completed' : 'accepted',
    }});
  }

  for (const entry of invalid) {
    test(`${flow.path} refuses ${entry.name} before reporting success`, async t => {
      let response: unknown = entry.value;
      let calls = 0;
      t.mock.method(globalThis, 'fetch', async () => {
        calls++;
        return Response.json(response, {status: flow.status});
      });
      assert.deepEqual(await accountRequest(flow.path, flow.body), {
        ok: false, status: 503, code: 'unexpected_response', retryAfterMs: 0,
      });
      assert.equal(calls, 1, 'an uncertain result must not repeat an account operation');
      response = flow.value;
      assert.deepEqual(await accountRequest(flow.path, flow.body), {ok: true, value: flow.value});
      assert.equal(calls, 2, 'only an explicit second call retries');
    });
  }

  for (const mode of ['broken JSON', 'empty acknowledgement', 'network loss', 'refused success body', 'known refusal', 'unknown refusal']) {
    test(`${flow.path} keeps ${mode} unsuccessful without an automatic retry`, async t => {
      let calls = 0;
      t.mock.method(globalThis, 'fetch', async () => {
        calls++;
        if (mode === 'network loss') throw new TypeError('connection lost');
        if (mode === 'broken JSON') return new Response('{', {status: flow.status});
        if (mode === 'empty acknowledgement') return new Response(null, {status: 204});
        if (mode === 'refused success body') return Response.json(flow.value, {status: 503});
        return Response.json({error: mode === 'known refusal' ? 'rate_limited' : 'internal_details',
          token: 'must-not-escape', password: 'must-not-escape'}, {status: 429, headers: {'Retry-After': '7'}});
      });
      const status = mode === 'network loss' ? 0 : mode.endsWith('refusal') ? 429 : 503;
      const code = mode === 'network loss' ? 'network_error'
        : mode === 'known refusal' ? 'rate_limited' : 'unexpected_response';
      assert.deepEqual(await accountRequest(flow.path, flow.body), {
        ok: false, status, code, retryAfterMs: mode.endsWith('refusal') ? 7000 : 0,
      });
      assert.equal(calls, 1);
    });
  }

  test(`${flow.path} sends the exact account payload once with same-origin credentials`, async t => {
    const calls: {url: unknown; init?: RequestInit}[] = [];
    t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
      calls.push({url, init});
      return Response.json(flow.value, {status: flow.status});
    });
    assert.deepEqual(await accountRequest(flow.path, flow.body), {ok: true, value: flow.value});
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, `/api/account${flow.path}`);
    const init = calls[0]!.init!;
    assert.equal(init.method, 'POST');
    assert.equal(init.credentials, 'same-origin');
    assert.deepEqual(init.headers, {'Content-Type': 'application/json'});
    assert.deepEqual(JSON.parse(String(init.body)), flow.body);
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(init.signal.aborted, false);
  });
}
