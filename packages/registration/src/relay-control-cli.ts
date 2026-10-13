import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {migrationNames} from './migrate.ts';
import {RelayControl, type RelayControlStatus} from './relay-control.ts';

let pool: Pool | undefined, result: RelayControlStatus | undefined, failed = false;
try {
  const args = process.argv.slice(2), mode = args[0];
  if (args.length !== 1 || !['--stop', '--resume', '--status'].includes(mode!) || !process.env.DATABASE_URL) throw new Error();
  const connection = new URL(process.env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(connection.protocol) || !connection.hostname) throw new Error();
  // Bound cumulative transaction waits as well as each individual statement.
  connection.searchParams.set('options', `${connection.searchParams.get('options') ?? ''} -c statement_timeout=10000 -c transaction_timeout=10000`);
  pool = new Pool({connectionString: connection.href, max: 1, connectionTimeoutMillis: 5000, statement_timeout: 10000});
  pool.on('error', () => {failed = true;});
  const rows = (await pool.query<{name: string; digest: string}>('SELECT name,digest FROM schema_migrations')).rows;
  if (rows.length !== migrationNames.length) throw new Error();
  for (const name of migrationNames) {
    const digest = createHash('sha256').update(await readFile(new URL(`../migrations/${name}`, import.meta.url))).digest('hex');
    if (!rows.some(row => row.name === name && row.digest === digest)) throw new Error();
  }
  const control = new RelayControl(pool);
  result = await (mode === '--stop' ? control.stop() : mode === '--resume' ? control.resume() : control.status());
} catch {failed = true;}
finally {try {await pool?.end();} catch {failed = true;}}
if (failed || !result) {
  console.error('Relay control failed; check configuration, database and migrations');
  process.exitCode = 1;
} else console.log(JSON.stringify({stopped: result.stopped}));
