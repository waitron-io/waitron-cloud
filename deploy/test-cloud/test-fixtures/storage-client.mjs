// Run only inside a disposable proof project's account container. Secrets remain in its private volume.
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync,sign} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {Agent,request} from 'node:https';
import {setTimeout as delay} from 'node:timers/promises';
import {loadRuntime} from '../../local-stack/runtime.mjs';
import {openTestCaptureRuntime} from '../service-runtime.mjs';
import {atomicPrivateFile} from '../storage-authority.mjs';
import {BackupCatalogue} from '../../../packages/backups/src/catalogue.ts';
import {OrganisationPlanStore} from '../../../packages/registration/src/organisation-plans.ts';
import {createLeaseIssuer,encodeMachine} from '../../../packages/registration/src/index.ts';
const {Pool}=createRequire(new URL('../../../packages/registration/package.json',import.meta.url))('pg');
const {S3Client,CreateBucketCommand,PutObjectCommand,GetObjectCommand}=createRequire(new URL('../../../packages/backups/package.json',import.meta.url))('@aws-sdk/client-s3');
const directory='/run/local-stack',saved=directory+'/storage-proof-state.json',origin='https://waitron.local:3000',endpoint='https://waitron.local:8333';
export async function storageClientProof(phase){
 const config=await loadRuntime(directory),pool=new Pool({connectionString:`postgres://${config.database.user}:${config.database.password}@postgres:5432/${config.database.name}`,connectionTimeoutMillis:5000,statement_timeout:10000});
 const clients=[],ca=await readFile(directory+'/lan/ca.pem'),plans=new OrganisationPlanStore(pool),issuer=createLeaseIssuer(config.installation.issuerKey);
 const client=credentials=>{const s3=new S3Client({endpoint,region:'local',credentials,forcePathStyle:true,maxAttempts:1,requestHandler:{httpsAgent:new Agent({ca})}});clients.push(s3);return s3;};
 const admin=client({accessKeyId:config.storage.accessKeyId,secretAccessKey:config.storage.secretAccessKey});
 let runtime;
 const denied=e=>e?.$metadata?.httpStatusCode===403;
 const put=(s3,bucket,key)=>s3.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:'isolated test Cloud data'}),{abortSignal:AbortSignal.timeout(5000)});
 async function machine(item,action,body={}){
  const lease=issuer.issue({origin,leaseId:randomUUID(),installationId:item.installationId,venueId:item.venueId,environment:'test',publicKey:item.publicKey,issuedAt:Date.now(),expiresAt:Date.now()+3600000});
  const bytes=encodeMachine({origin,action,installationId:item.installationId,operationId:randomUUID(),issuedAt:Date.now(),lease:JSON.stringify(lease),body:JSON.stringify(body)});
  const encoded=JSON.stringify({payload:bytes.toString('base64url'),signature:sign(null,bytes,item.privateKey).toString('base64url')});
  return new Promise((resolve,reject)=>{const req=request({hostname:'proxy',port:3000,servername:'waitron.local',ca,path:'/api/installations/'+action,method:'POST',headers:{host:'waitron.local:3000','content-type':'application/json','content-length':Buffer.byteLength(encoded)}},res=>{let text='';res.on('data',value=>text+=value);res.once('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(text)});}catch(error){reject(error);}});});req.setTimeout(10000,()=>req.destroy(Error('proof account timeout')));req.once('error',reject);req.end(encoded);});
 }
 async function stream(item){
  const revision=Number((await pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[item.installationId])).rows[0].configuration_revision);
  const response=await machine(item,'backup-stream-configure',{revision,localVenueId:item.localVenueId,sourceNodeId:item.sourceNodeId,pointerSignerPublicKey:item.pointerSignerPublicKey});assert.equal(response.status,200,JSON.stringify(response.body));return response.body;
 }
 try{
  if(phase==='seed'||phase==='seed-snapshot'){
   runtime=await openTestCaptureRuntime({pool,directory,mode:'test-free-paid'});
   const catalogue=new BackupCatalogue(pool,runtime.options.vault,runtime.options.objects,'test-free-paid');
   async function venue(paid){
    const item={organisationId:randomUUID(),business:randomUUID(),venueId:randomUUID(),installationId:randomUUID(),localVenueId:randomUUID(),sourceNodeId:randomUUID()};
    const key=generateKeyPairSync('ed25519');item.privateKey=key.privateKey.export({type:'pkcs8',format:'pem'});item.publicKey=key.publicKey.export({type:'spki',format:'der'}).toString('base64url');item.pointerSignerPublicKey=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64');
    await pool.query('INSERT INTO organisations(id) VALUES($1)',[item.organisationId]);await pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[item.business,item.organisationId]);await pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$4,'test')",[item.venueId,item.organisationId,item.business,item.localVenueId]);await pool.query('INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,$3)',[item.installationId,item.venueId,item.publicKey]);await pool.query("INSERT INTO installation_services(installation_id,service) SELECT $1,unnest(ARRAY['retained_snapshots','continuous_backup','remote_access'])",[item.installationId]);
    item.location={endpoint,region:'local',bucket:'venue-'+item.venueId};
    if(paid){await plans.set(item.organisationId,'paid');await admin.send(new CreateBucketCommand({Bucket:item.location.bucket}));await catalogue.provision(item.installationId,item.location);}
    return item;
   }
   const free=await venue(false),a=await venue(true),b=await venue(true);
   for(const action of ['backup-reserve','backup-stream-configure']){const refusal=await machine(free,action,action==='backup-stream-configure'?{revision:0,localVenueId:free.localVenueId,sourceNodeId:free.sourceNodeId,pointerSignerPublicKey:free.pointerSignerPublicKey}:{});assert.equal(refusal.status,403);assert.equal(refusal.body.error,'permission_denied');}
   const capture=await machine(a,'backup-reserve');assert.equal(capture.status,200,JSON.stringify(capture.body));assert.equal(capture.body.location.endpoint,endpoint);assert.ok(Date.parse(capture.body.expiresAt)<=Date.now()+901000);
   const snapshot=client(capture.body.credentials);await put(snapshot,a.location.bucket,capture.body.incomingKey);await assert.rejects(put(snapshot,a.location.bucket,'incoming/foreign'),denied);await assert.rejects(put(snapshot,b.location.bucket,capture.body.incomingKey),denied);
   if(phase==='seed-snapshot'){
    await atomicPrivateFile(saved,JSON.stringify({a,b}));
    console.log(JSON.stringify({phase,freeCapture:403,paidCapture:200,continuousConfigured:false}));return;
   }
   a.stream=await stream(a);b.stream=await stream(b);assert.equal(a.stream.bucket.endpoint,endpoint);assert.notEqual(a.stream.bucket.accessKeyId,capture.body.credentials.accessKeyId);
   const writer=client(a.stream.bucket);await put(writer,a.location.bucket,a.stream.bucket.prefix+'before');await assert.rejects(put(writer,a.location.bucket,capture.body.incomingKey),denied);await assert.rejects(put(writer,b.location.bucket,b.stream.bucket.prefix+'cross-venue'),denied);
   await assert.rejects(put(snapshot,a.location.bucket,a.stream.bucket.prefix+'snapshot-escape'),denied);
   const row=(await pool.query('SELECT reader_reference FROM backup_managed_streams WHERE venue_id=$1',[a.venueId])).rows[0];a.readerReference=row.reader_reference;
   assert.equal((await runtime.options.managedStreams.read(a.readerReference,a.location,a.stream.bucket.prefix+'before')).toString(),'isolated test Cloud data');
   const reader=await runtime.options.managedStreams.reader({venueId:a.venueId,location:a.location,prefix:a.stream.bucket.prefix,reference:a.readerReference});await assert.rejects(put(client(reader),a.location.bucket,a.stream.bucket.prefix+'reader-write'),denied);
   await atomicPrivateFile(saved,JSON.stringify({a,b}));
   console.log(JSON.stringify({phase,freeCapture:403,freeStream:403,paidCapture:200,paidStream:200,canonicalEndpoint:true,distinctScopedCredentials:true,readerCannotWrite:true}));
  }else{
   const state=JSON.parse(await readFile(saved,'utf8')),a=state.a,b=state.b;
   if(phase==='downgrade-pending'){await plans.set(a.organisationId,'free');console.log(JSON.stringify({phase,committed:true}));return;}
   if(phase==='withdraw')await plans.set(a.organisationId,'free');
   const writer=client(a.stream.bucket);let refused=false;
   for(let n=0;n<80;n++){try{await put(writer,a.location.bucket,a.stream.bucket.prefix+'after');await delay(100);}catch(error){if(!denied(error))throw error;refused=true;break;}}assert.equal(refused,true,'old direct writer must fail at storage after reconciliation');
   await put(client(b.stream.bucket),b.location.bucket,b.stream.bucket.prefix+'neighbour');
   runtime=await openTestCaptureRuntime({pool,directory,mode:'test-free-paid'});
   assert.equal((await runtime.options.managedStreams.read(a.readerReference,a.location,a.stream.bucket.prefix+'before')).toString(),'isolated test Cloud data');
   const refusedCapture=await machine(a,'backup-reserve');assert.equal(refusedCapture.status,403);assert.equal(refusedCapture.body.error,'permission_denied');
   await plans.set(a.organisationId,'paid');const catalogue=new BackupCatalogue(pool,runtime.options.vault,runtime.options.objects,'test-free-paid');await catalogue.provision(a.installationId,a.location);
   const fresh=await stream(a);assert.notEqual(fresh.bucket.accessKeyId,a.stream.bucket.accessKeyId);assert.equal(fresh.recoveryKey,a.stream.recoveryKey);await put(client(fresh.bucket),a.location.bucket,fresh.bucket.prefix+'fresh');await assert.rejects(put(writer,a.location.bucket,a.stream.bucket.prefix+'revival'),denied);
   const nextReader=(await pool.query('SELECT reader_reference FROM backup_managed_streams WHERE venue_id=$1',[a.venueId])).rows[0].reader_reference;assert.equal(nextReader,a.readerReference);
   a.stream=fresh;await atomicPrivateFile(saved,JSON.stringify(state));
   console.log(JSON.stringify({phase,oldWriterRefused:403,neighbourPreserved:true,retainedData:true,freshWriter:true,sameRecoveryKey:true,sameReader:true}));
  }
 }finally{runtime?.close();clients.forEach(value=>value.destroy());await pool.end();}
}
