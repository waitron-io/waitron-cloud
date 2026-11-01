import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {migrationNames} from './migrate.ts';
import {OrganisationPlanStore, parsePlanMode, type OrganisationPlanView} from './organisation-plans.ts';

let pool: Pool | undefined, result: OrganisationPlanView | undefined, failed = false;
try {
  const [command, option, organisationId, planOption, plan] = process.argv.slice(2);
  const count = process.argv.length - 2;
  if (parsePlanMode(process.env.CLOUD_TEST_SERVICE_PLANS,process.env.CLOUD_VENUE_SERVICE_LEVELS) !== 'test-free-paid'
    || option !== '--organisation' || !organisationId
    || !(command === 'show' && count === 3 || command === 'set' && count === 5 && planOption === '--plan' && (plan === 'free' || plan === 'paid'))
    || !process.env.DATABASE_URL) throw new Error();
  const connection = new URL(process.env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(connection.protocol) || !connection.hostname) throw new Error();
  // Bound the whole transaction as well as individual lock and ledger waits.
  connection.searchParams.set('options', `${connection.searchParams.get('options') ?? ''} -c statement_timeout=10000 -c transaction_timeout=10000`);
  pool = new Pool({connectionString: connection.href, max: 1, connectionTimeoutMillis: 5000, statement_timeout: 10000});
  pool.on('error', () => {failed = true;});
  const rows = (await pool.query<{name: string; digest: string}>('SELECT name,digest FROM schema_migrations')).rows;
  if (rows.length !== migrationNames.length) throw new Error();
  for (const name of migrationNames) {
    const digest = createHash('sha256').update(await readFile(new URL(`../migrations/${name}`, import.meta.url))).digest('hex');
    if (!rows.some(row => row.name === name && row.digest === digest)) throw new Error();
  }
  const store = new OrganisationPlanStore(pool);
  result = await (command === 'show' ? store.show(organisationId) : store.set(organisationId, plan as 'free' | 'paid'));
} catch {failed = true;}
finally {try {await pool?.end();} catch {failed = true;}}
if (failed || !result) {
  console.error('Organisation plan failed; check test mode, arguments, database and migrations');
  process.exitCode = 1;
} else console.log(JSON.stringify(result));
