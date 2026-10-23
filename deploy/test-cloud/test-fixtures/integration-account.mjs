import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {loadRuntime} from '../../local-stack/runtime.mjs';
const {Pool} = createRequire(new URL('../../../packages/registration/package.json', import.meta.url))('pg');
let input = '';
for await (const part of process.stdin) {input += part; assert.ok(input.length < 16384);}
const {organisationId, plan, installationId} = JSON.parse(input);
const config = await loadRuntime('/run/local-stack');
const pool = new Pool({connectionString: `postgres://${config.database.user}:${config.database.password}@postgres:5432/${config.database.name}`, connectionTimeoutMillis: 5000, statement_timeout: 10000});
try {
  if (!installationId) {
    assert.ok(plan === 'free' || plan === 'paid');
    const args = plan === 'paid' ? ['set', '--organisation', organisationId, '--plan', 'paid'] : ['show', '--organisation', organisationId];
    const {stdout} = await promisify(execFile)(process.execPath, ['packages/registration/src/organisation-plan-cli.ts', ...args], {
      env: {...process.env, CLOUD_TEST_SERVICE_PLANS: '1', DATABASE_URL: `postgres://${config.database.user}:${config.database.password}@postgres:5432/${config.database.name}`}, timeout: 15000, maxBuffer: 16384,
    });
    const result = JSON.parse(stdout);
    assert.equal(result.plan, plan);
    console.log(JSON.stringify(result));
  } else {
    const {rows} = await pool.query('SELECT v.organisation_id,v.local_venue_id,i.venue_id FROM installations i JOIN venues v ON v.id=i.venue_id WHERE i.id=$1', [installationId]);
    assert.equal(rows.length, 1); assert.equal(rows[0].organisation_id, organisationId);
    const operations = await pool.query('SELECT result FROM installation_operations WHERE installation_id=$1', [installationId]);
    assert.ok(operations.rows.some(row => row.result.lease), 'integration.persisted_renewal_missing');
    console.log(JSON.stringify({organisationId, venueId: rows[0].venue_id, localVenueId: rows[0].local_venue_id, persistedRenewal: true}));
  }
} finally {await pool.end();}
