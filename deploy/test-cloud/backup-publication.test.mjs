import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {once} from 'node:events';
import {mkdtemp,readFile,readdir,rm,statfs} from 'node:fs/promises';
import {createServer,request} from 'node:https';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import test from 'node:test';
import {createAccountApp} from '../../packages/account-http/src/app.ts';
import {BackupCatalogue} from '../../packages/backups/src/catalogue.ts';
import {BackupKeyVault} from '../../packages/backups/src/keys.ts';
import {MAX_LEGACY_BACKUP_BYTES,MAX_OBJECT_BYTES} from '../../packages/backups/src/object-transfer.ts';
import {BackupObjects} from '../../packages/backups/src/storage.ts';
import {EmailOutbox,createLeaseIssuer,encodeMachine} from '../../packages/registration/src/index.ts';
import {venueServiceFixture,set} from '../../packages/registration/test/fixtures/venue-service.ts';
import {diskUsage} from '../../scripts/backup-capacity-fixture.mjs';
import {startBackupStorage} from '../../scripts/backup-storage-fixture.mjs';
import {putIntegrationSnapshot} from './test-fixtures/integration-snapshot-client.mjs';

const {getRequestListener}=createRequire(new URL('../../packages/account-http/package.json',import.meta.url))('@hono/node-server');
const MiB=1024*1024, bytes=Number(process.env.TEST_CLOUD_PUBLISH_BYTES??4*MiB);
const mode='test-venue-levels', downloadMs=14*60_000;

test('signed publication retries an interrupted retained copy through real TLS and preserves one point',{timeout:bytes>MAX_LEGACY_BACKUP_BYTES?downloadMs+180_000:180_000},async t=>{
 assert(Number.isSafeInteger(bytes)&&bytes>0&&bytes<=MAX_OBJECT_BYTES,'set a supported publication fixture size');
 if(bytes>MAX_LEGACY_BACKUP_BYTES)assert(process.env.TEST_CLOUD_PUBLISH_STAGE,'mount a private quota-limited disk stage for the large run');
 const stage=await mkdtemp(join(process.env.TEST_CLOUD_PUBLISH_STAGE??tmpdir(),'backup-publish-'));
 t.after(()=>rm(stage,{recursive:true,force:true}));
 const fs=await statfs(stage);
 assert(fs.bavail*fs.bsize>=2*bytes,'disk stage has room for the incoming file and conflict check');
 const storage=await startBackupStorage();t.after(()=>storage.stop());
 const db=await venueServiceFixture();t.after(()=>db.close());
 const [venueId]=db.venues, key=generateKeyPairSync('ed25519');
 const publicKey=key.publicKey.export({type:'spki',format:'der'}).toString('base64url');
 const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
 const vault=new BackupKeyVault(randomBytes(32)), location=await storage.bucket('signed-publication');
 const objects=new BackupObjects(location,storage.admin,storage.ca,stage);t.after(()=>objects.close());
 await set(db);const installationId=(await db.pool.query('UPDATE installations SET public_key=$2 WHERE venue_id=$1 AND revoked_at IS NULL RETURNING id',[venueId,publicKey])).rows[0].id;
 await new BackupCatalogue(db.pool,vault,()=>objects,mode).provision(installationId,location);

 let loseCopyReply=true, copied=false;
 const captures={vault,objects:()=>({
  stage:objects.stage.bind(objects),remove:objects.remove.bind(objects),
  async putStaged(...args){
   const result=await objects.putStaged(...args);
   if(loseCopyReply){loseCopyReply=false;copied=true;throw Error('fixture_lost_copy_reply');}
   return result;
  },
 }),grant:(target,scope)=>storage.authority.grant(target,scope,storage.ca),
 signUpload:(_target,key)=>objects.signCaptureUpload(key)};
 const server=createServer({key:await readFile(join(storage.root,'key.pem')),cert:storage.ca});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin='https://127.0.0.1:'+server.address().port, now=Date.now(), id=randomUUID();
 const lease=issuer.issue({origin,leaseId:randomUUID(),installationId,venueId,environment:'test',publicKey,issuedAt:now,expiresAt:now+3600000});
 const app=createAccountApp({pool:db.pool,outbox:new EmailOutbox({activeKeyId:'test',keys:{test:randomBytes(32).toString('hex')}}),
  config:{portalOrigin:origin,production:true,rateKey:randomBytes(32).toString('hex'),trustedProxyIps:[]},leaseIssuer:issuer,planMode:mode,captures});
 server.on('request',getRequestListener(app.fetch,{overrideGlobalObjects:false}));
 function proof(action,body,operationId){
  const payload=encodeMachine({origin,action,installationId,operationId,issuedAt:Date.now(),lease:JSON.stringify(lease),body:JSON.stringify(body)});
  return {payload:payload.toString('base64url'),signature:sign(null,payload,key.privateKey).toString('base64url')};
 }
 function submit(action,body,operationId=id){
  return new Promise((resolve,reject)=>{
   const req=request(origin+'/api/installations/'+action,{method:'POST',headers:{'content-type':'application/json'},ca:storage.ca,signal:AbortSignal.timeout(50_000)},async response=>{
    try{resolve({status:response.statusCode,body:JSON.parse(Buffer.concat(await response.toArray()).toString())});}
    catch(error){reject(error);}
   });
   req.on('error',reject);req.end(JSON.stringify(proof(action,body,operationId)));
  });
 }
 const reserved=await submit('backup-reserve',{});assert.equal(reserved.status,200);
 const upload=new BackupObjects(location,reserved.body.credentials,storage.ca);t.after(()=>upload.close());
 t.diagnostic('scoped upload starting at '+bytes+' bytes');
 const chunk=Buffer.alloc(MiB,0x61);
 function* chunks(){for(let left=bytes;left>0;left-=chunk.length)yield chunk.subarray(0,Math.min(left,chunk.length));}
 const hash=createHash('sha256');for(const part of chunks())hash.update(part);
 const receipt={size:bytes,digest:hash.digest('hex')},
  metadata={...receipt,capturedAt:new Date().toISOString(),retention:'daily',sourceNodeId:randomUUID(),modules:{core:1}};
 await upload.putStaged(reserved.body.incomingKey,{receipt,open:()=>Readable.from(chunks()),async dispose(){}},undefined,{timeoutMs:90_000});

 const baseline=process.memoryUsage();let peakRss=baseline.rss,peakBuffers=baseline.arrayBuffers,peakStageBytes=0;
 async function sample(){
  const memory=process.memoryUsage();peakRss=Math.max(peakRss,memory.rss);peakBuffers=Math.max(peakBuffers,memory.arrayBuffers);
  peakStageBytes=Math.max(peakStageBytes,(await diskUsage(stage)).bytes);
 }
 let firstMs=null,retryMs=null;
 t.after(()=>t.diagnostic(JSON.stringify({bytes,digest:receipt.digest,firstMs,retryMs,
  peakRssGrowth:peakRss-baseline.rss,peakArrayBufferGrowth:peakBuffers-baseline.arrayBuffers,peakStageBytes})));
 const sampling=setInterval(()=>void sample().catch(()=>{}),50);sampling.unref();t.after(()=>clearInterval(sampling));
 const started=performance.now(), interrupted=await submit('backup-publish',metadata);firstMs=Math.round(performance.now()-started);
 assert.equal(interrupted.status,503);assert.equal(copied,true,'the first request must complete the retained PUT before its reply is lost');
 assert.deepEqual((await db.pool.query('SELECT id FROM backup_points')).rows,[]);
 const retryStarted=performance.now(), retried=await submit('backup-publish',metadata);retryMs=Math.round(performance.now()-retryStarted);
 assert.equal(retried.status,200,JSON.stringify(retried.body));
 assert.equal(retried.body.id,id);assert.equal(retried.body.digest,receipt.digest);assert.equal(retried.body.size,bytes);
 assert.deepEqual((await db.pool.query('SELECT id FROM backup_points')).rows,[{id}]);
 assert.deepEqual((await submit('backup-publish',metadata)).body,retried.body);
 assert.deepEqual(await readdir(stage),[]);
 const readStarted=performance.now();
 const retained=await objects.stage('snapshots/'+id,undefined,{timeoutMs:downloadMs});
 try{assert.deepEqual(retained.receipt,receipt);}
 finally{await retained.dispose();}
 clearInterval(sampling);
 assert.deepEqual(await readdir(stage),[]);
 t.diagnostic('retained bytes read back in '+Math.round(performance.now()-readStarted)+' ms with zero staging files remaining');
 assert(firstMs<45_000&&retryMs<45_000,'both signed publications fit the Cloud work budget');
 if(bytes>MAX_LEGACY_BACKUP_BYTES){
  assert(peakRss-baseline.rss<384*MiB&&peakBuffers-baseline.arrayBuffers<128*MiB,'large publication must use bounded process memory');
 }
 const legacy=new BackupCatalogue(db.pool,vault,()=>objects,'test-free-paid');
 await assert.rejects(legacy.publish(installationId,id,{...metadata,size:MAX_LEGACY_BACKUP_BYTES+1}),{message:'backup.invalid_metadata'});

 await t.test('a direct reservation accepts one PUT and publishes it',async()=>{
  const captureId=randomUUID();
  const reserved=await submit('backup-reserve',{upload:'presigned-put-v1'},captureId);
  assert.equal(reserved.status,200);
  assert.ok(typeof reserved.body.uploadUrl==='string');
  const archive=Buffer.from('signed capture fixture');
  const put=()=>putIntegrationSnapshot(reserved.body,archive,join(storage.root,'cert.pem'));
  assert.equal(await put(),200);
  assert.equal(await put(),412);
  const published=await submit('backup-publish',{...metadata,size:archive.length,digest:createHash('sha256').update(archive).digest('hex')},captureId);
  assert.equal(published.status,200);
  assert.equal(published.body.id,captureId);
 });
});
