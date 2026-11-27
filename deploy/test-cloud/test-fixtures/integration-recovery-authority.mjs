import {readIntegrationSourceIdentity} from './integration-source-identity.mjs';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {establishNodeIdentity} from '/waitron/apps/server/src/node-identity.ts';
import {loadBoxEnv} from '/waitron/apps/server/src/box-env.ts';
const require = createRequire('/waitron/apps/server/package.json');
const {openVenueDatabase} = require('@waitron/db');
const {loadKeyRing} = require('@waitron/credentials');

// Only the owning proof receives this separate authority over its private socket, before capture.
export async function prepareIntegrationRecoveryAuthority(root) {
  assert.equal(process.env.CLOUD_TEST_BACKUP_STATE, '1');
  const sourceIdentity=await readIntegrationSourceIdentity(root);
  const store = await openVenueDatabase(root + '/venue', {exclusive: false});
  try {
    await establishNodeIdentity({ownerDb: store.venue, node: store.node, ring: loadKeyRing(await loadBoxEnv({}, root))}, sourceIdentity.nodeId);
    const currentRecovery = process.env.CLOUD_INTEGRATION_CURRENT_RECOVERY === '1';
    const masterKeyFixture = '/waitron/apps/server/src/testing/master-key.ts';
    let key;
    if (existsSync(masterKeyFixture)) {
      const {mintMasterKey} = await import(masterKeyFixture);
      key = await mintMasterKey(store.venue);
    } else {
      const {mintBreakGlassKey} = await import('/waitron/apps/server/src/break-glass.ts');
      key = await mintBreakGlassKey(currentRecovery ? store : store.venue, sourceIdentity.nodeId);
    }
    if (process.env.CLOUD_INTEGRATION_LARGE_EXIT === '1') {
      const {sealingPublicKey, masterKeyId} = require('@waitron/credentials');
      const {decodeMasterKeyCode} = require('@waitron/shared');
      const {writeBackupKeyOne} = await import('/waitron/apps/server/src/backup-key-record.ts');
      const bytes = decodeMasterKeyCode(key.secret);
      try {
        const publicKey = sealingPublicKey(bytes);
        await writeBackupKeyOne(root, {made:{masterKey:key.secret,masterKeyName:key.name},publicKey});
        key.masterKeyId = masterKeyId(publicKey).toString('hex');
      } finally { bytes.fill(0); }
    }
    return {...key, sourceNodeId: sourceIdentity.nodeId, streamId: sourceIdentity.streamId};
  } finally {await store.close();}
}

export async function proveIntegrationExitOpen(root, {masterKey, cloudKey, masterKeyId}) {
  assert.equal(process.env.CLOUD_INTEGRATION_LARGE_EXIT, '1');
  assert.equal(process.permission?.has('net'), false, 'integration.exit_opener_network_allowed');
  const {openingKeyFor} = await import('/waitron/apps/server/src/backup-file-key.ts');
  const {decryptBackupFile,readArtifactFileHeader} = await import('/waitron/apps/server/src/artifact-cipher-file.ts');
  const {unpackArchive} = require('@waitron/provisioning');
  const downloaded=join(root,'exit-download.enc'), source=join(root,'captured.backup.enc');
  const scratch=await mkdtemp(join(root,'exit-open-'));
  try {
    const header=await readArtifactFileHeader(downloaded);
    assert.equal(header.version,2);
    assert.equal(header.masterKeyId.toString('hex'),masterKeyId);
    const savedPath=join(scratch,'saved'), sourcePath=join(scratch,'source');
    const savedSha256=await decryptBackupFile(downloaded,savedPath,await openingKeyFor({artifactPath:downloaded},masterKey));
    const sourceSha256=await decryptBackupFile(source,sourcePath,cloudKey);
    const saved=await readFile(savedPath);
    assert.ok(saved.equals(await readFile(sourcePath)),'integration.exit_payload_changed');
    const payload=saved[0]===0x1f && saved[1]===0x8b ? gunzipSync(saved,{maxOutputLength:32*1024**2}) : saved;
    const database=unpackArchive(payload).find(entry=>entry.name==='db.dump');
    assert.ok(database,'integration.exit_offline_database_missing');
    return {savedSha256,sourceSha256,masterKeyId,databaseSha256:createHash('sha256').update(database.bytes).digest('hex')};
  } finally { await rm(scratch,{recursive:true,force:true}); await rm(downloaded,{force:true}); }
}
