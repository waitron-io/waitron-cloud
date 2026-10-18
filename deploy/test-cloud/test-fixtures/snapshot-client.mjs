// All capture/recovery secrets remain in the proof volume or pipe; the outer test prints flags only.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {Agent,request} from 'node:https';
import {randomUUID,sign} from 'node:crypto';
import {loadRuntime} from '../../local-stack/runtime.mjs';
import {atomicPrivateFile} from '../storage-authority.mjs';
import {createLeaseIssuer,encodeMachine} from '../../../packages/registration/src/index.ts';
import {receipt} from '../../../packages/backups/src/storage.ts';
const {Pool}=createRequire(new URL('../../../packages/registration/package.json',import.meta.url))('pg');
const {S3Client,PutObjectCommand}=createRequire(new URL('../../../packages/backups/package.json',import.meta.url))('@aws-sdk/client-s3');
export async function snapshotClientProof(phase,input={}){
 const directory='/run/local-stack',config=await loadRuntime(directory),saved=directory+'/snapshot-proof-state.json',state=JSON.parse(await readFile(directory+'/storage-proof-state.json','utf8')),item=state.a;
 const pool=new Pool({connectionString:`postgres://${config.database.user}:${config.database.password}@postgres:5432/${config.database.name}`,connectionTimeoutMillis:5000,statement_timeout:10000}),ca=await readFile(directory+'/lan/ca.pem'),issuer=createLeaseIssuer(config.installation.issuerKey);
 async function machine(action,operationId,body={}){
  const now=Date.now(),lease=issuer.issue({origin:'https://waitron.local:3000',leaseId:randomUUID(),installationId:item.installationId,venueId:item.venueId,environment:'test',publicKey:item.publicKey,issuedAt:now,expiresAt:now+3600000});
  const bytes=encodeMachine({origin:'https://waitron.local:3000',action,installationId:item.installationId,operationId,issuedAt:now,lease:JSON.stringify(lease),body:JSON.stringify(body)}),encoded=JSON.stringify({payload:bytes.toString('base64url'),signature:sign(null,bytes,item.privateKey).toString('base64url')});
  return new Promise((resolve,reject)=>{const req=request({hostname:'proxy',port:3000,servername:'waitron.local',ca,path:'/api/installations/'+action,method:'POST',headers:{host:'waitron.local:3000','content-type':'application/json','content-length':Buffer.byteLength(encoded)}},res=>{let text='';res.on('data',part=>text+=part);res.once('end',()=>{try{assert.equal(res.statusCode,200);resolve(JSON.parse(text));}catch{reject(Error('fixture.machine_refused'));}});});req.setTimeout(10000,()=>req.destroy(Error('fixture.machine_timeout')));req.once('error',reject);req.end(encoded);});
 }
 try{
  if(phase==='reserve'){
   const capture=await machine('backup-reserve',randomUUID());await atomicPrivateFile(saved,JSON.stringify({capture}));return{recoveryKey:capture.recoveryKey};
  }
  const data=JSON.parse(await readFile(saved,'utf8'));
  if(phase==='publish'){
   const archive=Buffer.from(input.archive,'base64'),client=new S3Client({endpoint:data.capture.location.endpoint,region:'local',credentials:data.capture.credentials,forcePathStyle:true,maxAttempts:1,requestHandler:{httpsAgent:new Agent({ca})}});
   try{await client.send(new PutObjectCommand({Bucket:data.capture.location.bucket,Key:data.capture.incomingKey,Body:archive}));}finally{client.destroy();}
   const metadata={...receipt(archive),capturedAt:input.metadata.manifest.createdAt,retention:'daily',sourceNodeId:input.metadata.sourceNodeId,modules:input.metadata.manifest.modules};
   const point=await machine('backup-publish',data.capture.id,metadata);assert.equal(point.verification,'pending');await atomicPrivateFile(saved,JSON.stringify({...data,point}));
   await pool.query("UPDATE backup_jobs SET available_at=clock_timestamp()+interval '1 day'");return{published:true};
  }
  if(phase==='assert'){
   const row=(await pool.query('SELECT verification FROM backup_points WHERE id=$1',[data.point.id])).rows[0];assert.equal(row.verification,'verified');
   const job=(await pool.query("SELECT status,last_success_at,attempts FROM backup_jobs WHERE target_id=$1 AND kind='verify'",[data.point.id])).rows[0];assert.equal(job.status,'pending');assert.ok(job.last_success_at);assert.equal(job.attempts,0);
   return{realWaitronSnapshotVerified:true,scopedSignedCapture:true};
  }
  throw Error('fixture.phase');
 }finally{await pool.end();}
}
