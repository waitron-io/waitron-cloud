import {loadRuntime} from '../../local-stack/runtime.mjs';
import {testRuntimeEnvironment} from '../runtime.mjs';
import {openTestBackupVerifier, runTestBackupWorker} from '../backup-worker.mjs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {runUntilSelectedVerification} from './integration-verifier-drain.mjs';

// The trusted worker owns the socket; its bounded verifier child receives no host mounts or network.
const stop = new AbortController(), shutdown = () => stop.abort();
let pool;
process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
try {
  const pointId = process.env.CLOUD_INTEGRATION_POINT_ID;
  assert.match(pointId ?? '', /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  const environment = testRuntimeEnvironment('backup', await loadRuntime('/run/local-stack'), process.env);
  const {Pool} = createRequire(new URL('../../../packages/registration/package.json', import.meta.url))('pg');
  pool = new Pool({connectionString: environment.DATABASE_URL, max: 1, connectionTimeoutMillis: 5000, statement_timeout: 10000});
  const opened = await openTestBackupVerifier({directory: environment.CLOUD_VERIFIER_STATE_DIR, image: environment.CLOUD_VERIFIER_IMAGE});
  console.log(JSON.stringify({controllerScope: opened.controllerScope}));
  await runUntilSelectedVerification({signal: stop.signal,
    runOnce: () => runTestBackupWorker(environment, ['--once']),
    admitted: async () => (await pool.query("SELECT current_verification='verified' AS admitted FROM backup_point_qualification WHERE point_id=$1", [pointId])).rows[0]?.admitted === true});
} catch {
  console.error('integration.verifier_worker_failed');
  process.exitCode = 1;
} finally {
  await pool?.end();
  process.removeListener('SIGTERM', shutdown); process.removeListener('SIGINT', shutdown);
}
