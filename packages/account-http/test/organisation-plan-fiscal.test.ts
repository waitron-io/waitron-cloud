import assert from 'node:assert/strict';
import {test} from 'node:test';
import {OrganisationPlanStore} from '@waitron-cloud/registration';
import type {HttpBindings} from '@hono/node-server';
import {createAccountApp} from '../src/app.ts';
import {retainedRegistry} from './fixtures/retained-fiscal-registry.ts';

test('plan_updates_do_not_enable_fiscal_runtime', async () => {
  const s = await retainedRegistry(false);
  try {
    const app = createAccountApp({pool: s.pool, outbox: s.outbox,
      config: {portalOrigin: 'https://cloud.example.test', production: true, rateKey: s.rateKey, trustedProxyIps: []}});
    const plans = new OrganisationPlanStore(s.pool);
    const before = await s.snapshot();
    for (const plan of ['free', 'paid', 'free'] as const) {
      await plans.set(s.organisation, plan);
      const response = await app.request('https://cloud.example.test/api/account/fiscal-allocations/reserve',
        {method: 'POST', headers: {origin: 'https://cloud.example.test', 'content-type': 'application/json'}, body: '{}'},
        {incoming: {socket: {remoteAddress: '192.0.2.4'}}} as HttpBindings);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), {error: 'not_found'});
      assert.equal((await s.pool.query('SELECT count(*)::int AS n FROM fiscal_registry_events')).rows[0].n, 0);
      assert.deepEqual(await s.snapshot(), before);
    }
  } finally {await s.close();}
});
