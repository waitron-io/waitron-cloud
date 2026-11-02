import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {Agent} from 'node:https';
import {lookup} from 'node:dns';
import {observeSnapshotExposure} from './integration-snapshot-exposure.mjs';

export async function probeIntegrationSnapshotExposure(root, {downgradedAt}) {
  const saved = JSON.parse(await readFile(root + '/snapshot-access.json', 'utf8'));
  const state = JSON.parse(await readFile(root + '/cloud-connection.json', 'utf8'));
  const bytes = await readFile(root + '/captured.backup.enc');
  const selected = {venueId: state.view.registration.venueId, installationId: state.view.registration.installationId,
    identitySha256: createHash('sha256').update(state.publicKey).digest('hex'), archiveSha256: createHash('sha256').update(bytes).digest('hex')};
  const {S3Client, PutObjectCommand} = createRequire('/waitron/apps/server/package.json')('@aws-sdk/client-s3');
  const storage = new S3Client({endpoint: saved.location.endpoint, region: saved.location.region,
    credentials: saved.credentials, forcePathStyle: true, maxAttempts: 1,
    requestHandler: {httpsAgent: new Agent({ca: await readFile('/proof/ca.pem'),
      lookup: (hostname, options, done) => lookup(hostname === 'waitron.local' ? 'storage' : hostname, options, done)})}});
  try {
    const evidence = await observeSnapshotExposure({saved, selected, downgradedAt,
      put: () => storage.send(new PutObjectCommand({Bucket: saved.location.bucket, Key: saved.incomingKey, Body: bytes}),
        {abortSignal: AbortSignal.timeout(5000)})});
    return {pointId: saved.id, ...evidence};
  } finally {storage.destroy();}
}
