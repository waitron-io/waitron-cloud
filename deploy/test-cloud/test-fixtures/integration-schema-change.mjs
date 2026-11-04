import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile, appendFile, writeFile} from 'node:fs/promises';
import {loadRuntime, checkConsumerSchema} from '../../local-stack/runtime.mjs';

const {Pool} = createRequire(new URL('../../../packages/registration/package.json', import.meta.url))('pg');
const config = await loadRuntime('/volumes/config');
const pool = new Pool({connectionString: `postgres://${config.database.user}:${config.database.password}@postgres:5432/${config.database.name}`,
  connectionTimeoutMillis: 5000, statement_timeout: 10000});
const hash = value => createHash('sha256').update(value).digest('hex');
async function schema() {
  const rows = (await pool.query('SELECT name,digest FROM schema_migrations ORDER BY name')).rows;
  const probe = (await pool.query("SELECT to_regclass('public.test_cloud_rollback_probe') IS NOT NULL AS present")).rows[0].present;
  return {ledgerSha256: hash(JSON.stringify(rows)), migrations: rows.length, probe};
}
try {
  assert.ok(['inspect', 'change'].includes(process.argv[2]));
  const before = await schema();
  if (process.argv[2] === 'inspect') console.log(JSON.stringify(before));
  else {
    assert.equal(before.probe, false);
    await pool.query("BEGIN; CREATE TABLE test_cloud_rollback_probe (value text NOT NULL); INSERT INTO test_cloud_rollback_probe VALUES ('disposable'); INSERT INTO schema_migrations(name,digest) VALUES ('999_test_cloud_rollback_probe.sql',repeat('0',64)); COMMIT;");
    const changed = await schema();
    assert.equal(changed.probe, true); assert.equal(changed.migrations, before.migrations + 1);
    await assert.rejects(checkConsumerSchema(pool, process.cwd()), /schema_incompatible/);
    const path = '/volumes/config/runtime.json', previous = hash(await readFile(path));
    await appendFile(path, '\n');
    await writeFile('/volumes/storage/test-cloud-rollback-probe', 'disposable storage change', {flag: 'wx', mode: 0o600});
    assert.notEqual(hash(await readFile(path)), previous);
    assert.equal(await readFile('/volumes/storage/test-cloud-rollback-probe', 'utf8'), 'disposable storage change');
    console.log(JSON.stringify({before, changed, consumerRefused: true, privateFilesChanged: true}));
  }
} catch {console.error('integration.controlled_schema_change_failed'); process.exitCode = 1;}
finally {await pool.end();}
