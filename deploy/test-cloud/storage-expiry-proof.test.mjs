import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {Agent} from 'node:https';
import {setTimeout as delay} from 'node:timers/promises';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {startBackupStorage} from '../../scripts/backup-storage-fixture.mjs';
import {captureIntegrationSource,checkIntegrationSource,measureIntegrationFiles} from './test-fixtures/integration-source.mjs';
import {createSnapshotLifetimeReceipt} from './test-fixtures/integration-lifetime-receipt.mjs';
const require=createRequire(new URL('../../packages/backups/package.json',import.meta.url));
const {S3Client,PutObjectCommand}=require('@aws-sdk/client-s3');
// The default operator proof waits for a real 900-second credential. A short
// diagnostic is labelled separately and cannot count as the fifteen-minute proof.
test('snapshot STS expires at the storage boundary after its actual provider lifetime', {skip:process.env.TEST_CLOUD_REAL_STS_EXPIRY!=='1',timeout:930000},async t=>{
 const seconds=process.env.TEST_CLOUD_STS_EXPIRY_SECONDS??'900';assert.ok(['900','12'].includes(seconds),'expiry proof permits only 900-second or 12-second credentials');
 const root=fileURLToPath(new URL('../../',import.meta.url)),source=await captureIntegrationSource(root);
 const cloud={head:source.head,tree:source.tree,dirty:false,...await measureIntegrationFiles(root,source.files)};
 const storage=await startBackupStorage({tokenDuration:seconds+'s'});let stopped=false;t.after(async()=>{if(!stopped)await storage.stop();});
 console.log('SNAPSHOT_LIFETIME_RESOURCE='+JSON.stringify({root:storage.root}));
 const storageBinarySha256=createHash('sha256').update(await readFile(join(storage.root,'weed'))).digest('hex');
 const location=await storage.bucket('real-expiry-proof'),issuedAt=Date.now(),started=performance.now();
 const grant=await storage.authority.grant(location,{kind:'capture',bucket:location.bucket,scope:'incoming/expiry-proof'},storage.ca);
 const expires=Date.parse(grant.expiresAt);assert.ok(expires>=issuedAt+(Number(seconds)-1)*1000&&expires<=issuedAt+(Number(seconds)+1)*1000);
 const client=new S3Client({endpoint:storage.endpoint,region:'local',credentials:grant.credentials,forcePathStyle:true,maxAttempts:1,requestHandler:{httpsAgent:new Agent({ca:storage.ca})}});t.after(()=>client.destroy());
 const put=()=>client.send(new PutObjectCommand({Bucket:location.bucket,Key:'incoming/expiry-proof',Body:'synthetic expiry body'}),{abortSignal:AbortSignal.timeout(5000)});
 const accepted=await put(),acceptedAt=Date.now();console.log(JSON.stringify({proof:seconds==='900'?'snapshot-sts-expiry':'snapshot-sts-short-diagnostic',issuedAt:new Date(issuedAt).toISOString(),expiresAt:grant.expiresAt,beforeExpiry:'write accepted'}));
 while(Date.now()<=expires+1000){await delay(Math.min(30000,Math.max(1,expires+1001-Date.now())));console.log(JSON.stringify({proof:seconds==='900'?'snapshot-sts-expiry':'snapshot-sts-short-diagnostic',waitingAt:new Date().toISOString()}));}
 let refusal,refusedAt,elapsedMs;
 await assert.rejects(put(),error=>{
  refusedAt=Date.now();elapsedMs=performance.now()-started;
  refusal={status:error?.$metadata?.httpStatusCode,error:error?.name};
  console.log(JSON.stringify({proof:seconds==='900'?'snapshot-sts-expiry':'snapshot-sts-short-diagnostic',refusedAt:new Date().toISOString(),afterExpiry:refusal}));
  return refusal.status===403&&refusal.error==='InvalidAccessKeyId';
 });
 const receipt=createSnapshotLifetimeReceipt({runId:randomUUID(),cloud,storageBinarySha256,requestedSeconds:Number(seconds),
  requestedAt:issuedAt,acceptedAt,expiresAt:grant.expiresAt,refusedAt,elapsedMs,
  beforeStatus:accepted.$metadata.httpStatusCode,afterStatus:refusal.status,afterError:refusal.error});
 await storage.stop();stopped=true;
 await checkIntegrationSource(root,source);
 console.log('SNAPSHOT_LIFETIME_RECEIPT='+JSON.stringify(receipt));
});
