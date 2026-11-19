import {createPublicKey} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runWorkerLoop, parsePlanMode} from '../../packages/registration/src/index.ts';
import {isUuid, verifyManifest} from '../../packages/remote-access/src/manifest.ts';
import {checkConsumerDatabase} from '../local-stack/runtime.mjs';
import {openTestRemoteRuntime} from '../test-cloud/remote-runtime.mjs';
import {kubernetesObject} from './kubernetes-object.mjs';

export function secretArtifacts({secret, cellId, trust}) {
  const generation = 'routes.json';
  const decode = row => row.data?.[generation] ? JSON.parse(Buffer.from(row.data[generation], 'base64')) : {certificates: {}};
  const verified = text => {
    const envelope = JSON.parse(text);
    const {issuedAt} = JSON.parse(Buffer.from(envelope.payload, 'base64url'));
    return verifyManifest(envelope, trust, cellId, issuedAt);
  };
  async function update(change) {
    const current = await secret.get();
    const previous = decode(current);
    const next = change(previous);
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    await secret.replace({...current, data: {...current.data, [generation]: Buffer.from(JSON.stringify(next)).toString('base64')}});
  }
  return {
    cellId,
    async readManifest() {return decode(await secret.get()).manifest;},
    async publishManifest(id, manifest) {
      if (id !== cellId) throw Error('remote.publication_cell');
      const incoming = verified(manifest);
      await update(previous => {
        if (manifest === previous.manifest) return previous;
        if (previous.manifest && incoming.sequence <= verified(previous.manifest).sequence) throw Error('remote.stale_publication');
        return {...previous, manifest};
      });
    },
    async publishPublicCertificate(venueId, pem) {
      if (!isUuid(venueId)) throw Error('remote.publication_venue');
      await update(previous => ({...previous, certificates: {...previous.certificates, [venueId]: pem}}));
    },
  };
}

async function run() {
  const {DATABASE_URL, LOCAL_STACK_CONFIG_DIR: directory, CLOUD_STOCKHOLM_REMOTE_CELL: cellId} = process.env;
  if (!directory || !DATABASE_URL || !isUuid(cellId) || parsePlanMode(process.env.CLOUD_TEST_SERVICE_PLANS,
    process.env.CLOUD_VENUE_SERVICE_LEVELS) !== 'existing') throw Error('remote.worker_scope');
  await checkConsumerDatabase(DATABASE_URL, '/app');
  const trust = createPublicKey(await readFile(join(directory, 'gateway-issuer.pem')));
  const secret = kubernetesObject('/api/v1/namespaces/d621-data/secrets/remote-routes');
  const publication = secretArtifacts({secret, cellId, trust});
  const {Pool} = createRequire(new URL('../../packages/registration/package.json', import.meta.url))('pg');
  const pool = new Pool({connectionString: DATABASE_URL, max: 3, connectionTimeoutMillis: 5000, statement_timeout: 10000});
  const stop = new AbortController();
  const shutdown = () => stop.abort();
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
  pool.on('error', () => {process.exitCode = 1; shutdown();});
  try {
    const {worker} = await openTestRemoteRuntime({pool, directory, mode: 'existing', publication});
    await writeFile('/tmp/remote-worker-ready', '', {mode: 0o600});
    await runWorkerLoop({signal: stop.signal, concurrency: 1, scheduleIntervalMs: 1000, pollIntervalMs: 250,
      schedule: () => worker.schedule(), runOnce: signal => worker.runOnce(signal),
      onError: () => console.error('remote.worker_unavailable')});
  } finally {
    await pool.end();
    process.removeListener('SIGTERM', shutdown);
    process.removeListener('SIGINT', shutdown);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {await run();} catch {console.error('remote.worker_failed'); process.exitCode = 1;}
}
