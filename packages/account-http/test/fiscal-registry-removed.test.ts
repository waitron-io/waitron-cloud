import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {HttpBindings} from '@hono/node-server';
import {createAccountApp} from '../src/app.ts';
import {securityHeaders} from '../src/portal.ts';
import {retainedRegistry} from './fixtures/retained-fiscal-registry.ts';

// Reinstating a retired dispatch must fail, and refusing old callers must preserve dormant history.
test('retired_routes_use_generic_not_found without changing retained rows or shared request guards', async () => {
  const db = await retainedRegistry();
  try {
    const origin = 'https://cloud.example.test';
    const app = createAccountApp({pool: db.pool, outbox: db.outbox,
      config: {portalOrigin: origin, production: true, rateKey: db.rateKey, trustedProxyIps: []}});
    const before = await db.snapshot();
    for (const path of ['reserve', 'consume', 'abandon', 'status', 'list', 'import-paper'].map(suffix => `/api/account/fiscal-allocations/${suffix}`)
      .concat('/api/installations/fiscal-allocations/report')) for (const method of ['GET', 'POST']) {
      const unknown = path.startsWith('/api/account/') ? '/api/account/missing' : '/api/installations/missing';
      for (const [host, query, status, code] of [
        [origin, '', 404, 'not_found'], [origin, '?old=1', 400, 'invalid_input'], ['https://wrong.example.test', '', 403, 'forbidden'],
      ] as const) {
        const send = (target: string) => app.request(host + target + query, {method,
          headers: {origin, 'content-type': 'application/json'}, ...(method === 'POST' ? {body: '{}'} : {})},
          {incoming: {socket: {remoteAddress: '192.0.2.4'}}} as HttpBindings);
        const ordinary = await send(unknown), retired = await send(path);
        assert.equal(ordinary.status, status);
        assert.equal(retired.status, status, `${method} ${path}${query} ${host}`);
        assert.deepEqual(await retired.json(), {error: code});
        assert.deepEqual(retired.headers.getSetCookie(), []);
        for (const [name, value] of Object.entries(securityHeaders)) {
          assert.equal(retired.headers.get(name), value, name);
          assert.equal(retired.headers.get(name), ordinary.headers.get(name), name);
        }
      }
    }
    assert.deepEqual(await db.snapshot(), before);
  } finally {await db.close();}
});
