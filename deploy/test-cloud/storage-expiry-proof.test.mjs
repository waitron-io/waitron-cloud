import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {Agent} from 'node:https';
import {setTimeout as delay} from 'node:timers/promises';
import {startBackupStorage} from '../../scripts/backup-storage-fixture.mjs';
const require=createRequire(new URL('../../packages/backups/package.json',import.meta.url));
const {S3Client,PutObjectCommand}=require('@aws-sdk/client-s3');
// This operator proof waits for the real 900-second credential. CI never accelerates the clock.
test('snapshot STS expires at the storage boundary after its real fifteen-minute lifetime', {skip:process.env.TEST_CLOUD_REAL_STS_EXPIRY!=='1',timeout:930000},async t=>{
 const storage=await startBackupStorage();t.after(()=>storage.stop());
 const location=await storage.bucket('real-expiry-proof'),issuedAt=Date.now();
 const grant=await storage.authority.grant(location,{kind:'capture',bucket:location.bucket,scope:'incoming/expiry-proof'},storage.ca);
 const expires=Date.parse(grant.expiresAt);assert.ok(expires>issuedAt&&expires<=issuedAt+901000);
 const client=new S3Client({endpoint:storage.endpoint,region:'local',credentials:grant.credentials,forcePathStyle:true,maxAttempts:1,requestHandler:{httpsAgent:new Agent({ca:storage.ca})}});t.after(()=>client.destroy());
 const put=()=>client.send(new PutObjectCommand({Bucket:location.bucket,Key:'incoming/expiry-proof',Body:'synthetic expiry body'}),{abortSignal:AbortSignal.timeout(5000)});
 await put();console.log(JSON.stringify({proof:'snapshot-sts-expiry',issuedAt:new Date(issuedAt).toISOString(),expiresAt:grant.expiresAt,beforeExpiry:'write accepted'}));
 while(Date.now()<=expires+1000){await delay(Math.min(30000,Math.max(1,expires+1001-Date.now())));console.log(JSON.stringify({proof:'snapshot-sts-expiry',waitingAt:new Date().toISOString()}));}
 await assert.rejects(put(),error=>error?.name==='ExpiredTokenException'&&error?.$metadata?.httpStatusCode===400);
 console.log(JSON.stringify({proof:'snapshot-sts-expiry',refusedAt:new Date().toISOString(),afterExpiry:'400 ExpiredTokenException'}));
});
