import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {test} from 'node:test';
import {database} from './fixtures.ts';
import {createVenueServiceTemplate} from '../../registration/test/fixtures/venue-service-template.ts';
import {migrationNames} from '../../registration/src/migrate.ts';

test('template-backed HTTP databases isolate rows, verify migrations and remove their own clones', async () => {
  const template = await createVenueServiceTemplate();
  const admin = new Pool({connectionString: process.env.TEST_DATABASE_URL});
  let first: Awaited<ReturnType<typeof database>> | undefined;
  let second: typeof first;
  const names: string[] = [];
  try {
    first = await database(template.name);
    second = await database(template.name);
    for (const db of [first, second]) {
      const name = (await db.pool.query('SELECT current_database() AS name')).rows[0].name;
      names.push(name);
      assert.match(name, new RegExp('^venue_service_clone_' + template.name.slice(-32) + '_[a-f0-9]{10}$'));
      assert.equal((await db.pool.query('SELECT current_schema() AS name')).rows[0].name, db.schema);
      assert.deepEqual((await db.pool.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map(row => row.name), [...migrationNames].sort());
      assert.equal((await db.pool.query("SELECT backup_verification_target_shape('{}'::jsonb) AS valid")).rows[0].valid, false);
    }
    assert.notEqual(names[0], names[1]);
    const marker = randomUUID();
    await first.pool.query('INSERT INTO organisations(id) VALUES($1)', [marker]);
    assert.equal((await second.pool.query('SELECT id FROM organisations WHERE id=$1', [marker])).rowCount, 0);
    await first.close(); first = undefined;
    assert.equal((await second.pool.query('SELECT count(*) AS n FROM organisations')).rows[0].n, '0');
    await second.close(); second = undefined;
    assert.equal((await admin.query('SELECT datname FROM pg_database WHERE datname=ANY($1::text[])', [names])).rowCount, 0);
    const poison = new Pool({connectionString: template.connectionString});
    try { await poison.query("UPDATE venue_service_seed.schema_migrations SET digest='changed' WHERE name='001_registration.sql'"); }
    finally { await poison.end(); }
    await assert.rejects(database(template.name), /Applied migration has changed: 001_registration.sql/);
    const prefix = 'venue_service_clone_' + template.name.slice(-32) + '_';
    assert.equal((await admin.query('SELECT datname FROM pg_database WHERE left(datname,length($1))=$1', [prefix])).rowCount, 0);
  } finally {
    await first?.close(); await second?.close(); await template.close(); await admin.end();
  }
});
