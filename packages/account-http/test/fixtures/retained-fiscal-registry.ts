import {randomUUID} from 'node:crypto';
import {database} from '../fixtures.ts';
import {payload, binding} from '../../../registration/test/fixtures/fiscal-registry-schema.ts';

export async function retainedRegistry(seedEvent = true) {
  const db = await database();
  try {
    const account = randomUUID(), organisation = randomUUID(), business = randomUUID(), venue = randomUUID();
    await db.pool.query('INSERT INTO cloud_accounts(id) VALUES($1)', [account]);
    await db.pool.query('INSERT INTO organisations(id) VALUES($1)', [organisation]);
    await db.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner) VALUES($1,$2,true)', [account, organisation]);
    await db.pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)', [business, organisation]);
    await db.pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$4,'test')", [venue, organisation, business, randomUUID()]);
    const allocation = payload().allocation;
    await db.pool.query("INSERT INTO fiscal_registry_scopes VALUES('89890001K','WT','preproduction',42,42,$1,2)", ['a'.repeat(64)]);
    await db.pool.query(`INSERT INTO fiscal_registry_allocations(allocation_id,taxpayer_nif,software_id,environment,installation_identity,venue_id,account_id,allocation,binding,custody_version,entitlement_version,initial_receipt)
      VALUES($1,'89890001K','WT','preproduction','C000042',$2,$3,$4,$5,'custody-1','entitlement-1',$6)`,
      [allocation.allocationId, venue, account, allocation, binding, {fixture: 'retained-receipt'}]);
    if (seedEvent) await db.pool.query(`INSERT INTO fiscal_registry_events VALUES($1,'89890001K','WT','preproduction',42,$2,'reserve',$3,$4,$5,$6)`,
      [randomUUID(), randomUUID(), 'a'.repeat(64), allocation.allocationId, {fixture: 'retained-event'}, {fixture: 'retained-result'}]);
    await db.pool.query(`INSERT INTO fiscal_registry_paper_events VALUES($1,'89890001K','WT','preproduction','custodian',1,$2,$3,$4)`,
      [randomUUID(), 'b'.repeat(64), 'c'.repeat(64), {fixture: 'retained-paper'}]);
    await db.pool.query(`INSERT INTO fiscal_registry_operation_routes VALUES($1,$2,$3,$4,'reserve',$5)`,
      [randomUUID(), venue, account, {taxpayerNif: '89890001K', softwareId: 'WT', environment: 'preproduction'}, 'a'.repeat(64)]);
    return {...db, organisation, async snapshot() {
      const rows: Record<string, unknown> = {};
      for (const table of ['fiscal_registry_scopes', 'fiscal_registry_allocations', 'fiscal_registry_events', 'fiscal_registry_paper_events', 'fiscal_registry_operation_routes', 'schema_migrations'])
        rows[table] = (await db.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
      return rows;
    }};
  } catch (error) {await db.close(); throw error;}
}
