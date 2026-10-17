import assert from 'node:assert/strict';
import {test} from 'node:test';
import {OrganisationPlanStore} from '@waitron-cloud/registration';
import {fiscalHttpFixture} from './fiscal-http-fixture.ts';

test('plan_updates_do_not_enable_fiscal_runtime', async () => {
  const s = await fiscalHttpFixture(false);
  try {
    const organisationId = (await s.f.pool.query('SELECT organisation_id FROM venues WHERE id=$1', [s.v.input.venueId])).rows[0].organisation_id;
    const plans = new OrganisationPlanStore(s.f.pool);
    for (const plan of ['free', 'paid', 'free'] as const) {
      await plans.set(organisationId, plan);
      const response = await s.request('reserve', s.v.input);
      assert.equal(response.status, 503);
      assert.deepEqual(await response.json(), {error: 'continuity_unavailable'});
      assert.equal((await s.f.pool.query('SELECT count(*)::int AS n FROM fiscal_registry_events')).rows[0].n, 0);
    }
  } finally {await s.close();}
});
