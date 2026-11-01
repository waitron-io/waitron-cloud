import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {loadRuntime} from '../../local-stack/runtime.mjs';

const {Pool} = createRequire(new URL('../../../packages/registration/package.json', import.meta.url))('pg');
const config = await loadRuntime('/run/local-stack');
const pool = new Pool({connectionString: `postgres://${config.database.user}:${config.database.password}@postgres:5432/${config.database.name}`, connectionTimeoutMillis: 5000, statement_timeout: 10000});
const hash = value => createHash('sha256').update(value).digest('hex');
try {
  const rows = (await pool.query('SELECT name,digest FROM schema_migrations ORDER BY name')).rows;
  if (!rows.length) throw Error('integration.schema_missing');
  console.log(JSON.stringify({runtimeSha256: hash(await readFile('/run/local-stack/runtime.json')),
    caSha256: hash(await readFile('/run/local-stack/lan/ca.pem')), schemaSha256: hash(JSON.stringify(rows))}));
} finally {await pool.end();}
