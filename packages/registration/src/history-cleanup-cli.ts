import {readFile} from 'node:fs/promises';
import {Pool} from 'pg';
import {HistoryCleanup, parseHistoryCleanupPolicy} from './history-cleanup.ts';
import {migrationNames} from './migrate.ts';

let pool: Pool | undefined;
try {
  const args = process.argv.slice(2);
  let policyPath: string | undefined;
  let apply = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--policy' && policyPath === undefined && args[index + 1] && !args[index + 1]!.startsWith('--')) {
      policyPath = args[++index];
    } else if (arg === '--apply' && !apply) {
      apply = true;
    } else throw new Error();
  }
  if (!process.env.DATABASE_URL || !policyPath) throw new Error();
  const policy = parseHistoryCleanupPolicy(JSON.parse(await readFile(policyPath, 'utf8')));
  pool = new Pool({connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 10000});
  const installed = await pool.query<{count: number}>(
    'SELECT count(*)::integer AS count FROM schema_migrations WHERE name=ANY($1::text[])', [migrationNames]);
  if (installed.rows[0]?.count !== migrationNames.length) throw new Error();
  console.log(JSON.stringify(await new HistoryCleanup(pool).run(policy, {apply})));
} catch {
  console.error('History cleanup failed; check database, migrations and policy');
  process.exitCode = 1;
} finally {
  try { await pool?.end(); } catch { process.exitCode = 1; }
}
