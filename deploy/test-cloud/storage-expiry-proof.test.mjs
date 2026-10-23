import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {Agent} from 'node:https';
import {setTimeout as delay} from 'node:timers/promises';
import {startBackupStorage} from '../../scripts/backup-storage-fixture.mjs';
const require=createRequire(new URL('../../packages/backups/package.json',import.meta.url));
const {S3Client,PutObjectCommand}=require('@aws-sdk/client-s3');
// The default operator proof waits for a real 900-second credential. A short
// diagnostic is labelled separately and cannot count as the fifteen-minute proof.
test('snapshot STS expires at the storage boundary after its actual provider lifetime', {skip:process.env.TEST_CLOUD_REAL_STS_EXPIRY!=='1',timeout:930000},async t=>{
 const seconds=process.env.TEST_CLOUD_STS_EXPIRY_SECONDS??'900';assert.ok(['900','12'].includes(seconds),'expiry proof permits only 900-second or 12-second credentials');
 const storage=await startBackupStorage({tokenDuration:seconds+'s'});t.after(()=>storage.stop());
 const location=await storage.bucket('real-expiry-proof'),issuedAt=Date.now();
 const grant=await storage.authority.grant(location,{kind:'capture',bucket:location.bucket,scope:'incoming/expiry-proof'},storage.ca);
 const expires=Date.parse(grant.expiresAt);assert.ok(expires>=issuedAt+(Number(seconds)-1)*1000&&expires<=issuedAt+(Number(seconds)+1)*1000);
 const client=new S3Client({endpoint:storage.endpoint,region:'local',credentials:grant.credentials,forcePathStyle:true,maxAttempts:1,requestHandler:{httpsAgent:new Agent({ca:storage.ca})}});t.after(()=>client.destroy());
 const put=()=>client.send(new PutObjectCommand({Bucket:location.bucket,Key:'incoming/expiry-proof',Body:'synthetic expiry body'}),{abortSignal:AbortSignal.timeout(5000)});
 await put();console.log(JSON.stringify({proof:seconds==='900'?'snapshot-sts-expiry':'snapshot-sts-short-diagnostic',issuedAt:new Date(issuedAt).toISOString(),expiresAt:grant.expiresAt,beforeExpiry:'write accepted'}));
 while(Date.now()<=expires+1000){await delay(Math.min(30000,Math.max(1,expires+1001-Date.now())));console.log(JSON.stringify({proof:seconds==='900'?'snapshot-sts-expiry':'snapshot-sts-short-diagnostic',waitingAt:new Date().toISOString()}));}
 let refusal;
 await assert.rejects(put(),error=>{
  refusal={status:error?.$metadata?.httpStatusCode,error:error?.name};
  console.log(JSON.stringify({proof:seconds==='900'?'snapshot-sts-expiry':'snapshot-sts-short-diagnostic',refusedAt:new Date().toISOString(),afterExpiry:refusal}));
  return refusal.status===403&&refusal.error==='InvalidAccessKeyId';
 });
});
