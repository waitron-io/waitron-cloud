// All capture/recovery secrets remain in the proof volume or pipe; the outer test prints flags only.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {Agent,request} from 'node:https';
import {randomUUID,sign} from 'node:crypto';
import {loadRuntime} from '../../local-stack/runtime.mjs';
import {atomicPrivateFile} from '../storage-authority.mjs';
import {createLeaseIssuer,encodeMachine} from '../../../packages/registration/src/index.ts';
import {setVerificationPolicy} from '../../../packages/backups/src/verification-admission.ts';
import {readVerificationTarget} from '../../../packages/backups/src/verification-target.ts';
import {transaction} from '../../../packages/registration/src/transaction.ts';
import {receipt} from '../../../packages/backups/src/storage.ts';
import {createSession} from '../../../packages/identity/src/index.ts';
const {Pool}=createRequire(new URL('../../../packages/registration/package.json',import.meta.url))('pg');
const {S3Client,PutObjectCommand,ListObjectsV2Command}=createRequire(new URL('../../../packages/backups/package.json',import.meta.url))('@aws-sdk/client-s3');
export async function snapshotClientProof(phase,input={}){
 const directory='/run/local-stack',config=await loadRuntime(directory),saved=directory+'/snapshot-proof-state.json',state=JSON.parse(await readFile(directory+'/storage-proof-state.json','utf8')),item=state.a;
 const pool=new Pool({connectionString:`postgres://${config.database.user}:${config.database.password}@postgres:5432/${config.database.name}`,connectionTimeoutMillis:5000,statement_timeout:10000}),ca=await readFile(directory+'/lan/ca.pem'),issuer=createLeaseIssuer(config.installation.issuerKey);
 async function machine(action,operationId,body={}){
  const now=Date.now(),lease=issuer.issue({origin:'https://waitron.local:3000',leaseId:randomUUID(),installationId:item.installationId,venueId:item.venueId,environment:'test',publicKey:item.publicKey,issuedAt:now,expiresAt:now+3600000});
  const bytes=encodeMachine({origin:'https://waitron.local:3000',action,installationId:item.installationId,operationId,issuedAt:now,lease:JSON.stringify(lease),body:JSON.stringify(body)}),encoded=JSON.stringify({payload:bytes.toString('base64url'),signature:sign(null,bytes,item.privateKey).toString('base64url')});
  return new Promise((resolve,reject)=>{const req=request({hostname:'proxy',port:3000,servername:'waitron.local',ca,path:'/api/installations/'+action,method:'POST',headers:{host:'waitron.local:3000','content-type':'application/json','content-length':Buffer.byteLength(encoded)}},res=>{let text='';res.on('data',part=>text+=part);res.once('end',()=>{try{assert.equal(res.statusCode,200);resolve(JSON.parse(text));}catch{reject(Error('fixture.machine_refused'));}});});req.setTimeout(10000,()=>req.destroy(Error('fixture.machine_timeout')));req.once('error',reject);req.end(encoded);});
 }
 try{
  if(phase==='continuous'){
   const pointerRows=Number((await pool.query('SELECT count(*) FROM backup_managed_streams')).rows[0].count);
   const s3=new S3Client({endpoint:'https://waitron.local:8333',region:'local',credentials:{accessKeyId:config.storage.accessKeyId,secretAccessKey:config.storage.secretAccessKey},forcePathStyle:true,maxAttempts:1,requestHandler:{httpsAgent:new Agent({ca})}});let streamObjects=0;
   try{for(const venue of [state.a,state.b]){const list=await s3.send(new ListObjectsV2Command({Bucket:venue.location.bucket,Prefix:'streams/',MaxKeys:1000}));assert(!list.IsTruncated);streamObjects+=(list.Contents??[]).length;}}finally{s3.destroy();}
   assert.equal(pointerRows,0);assert.equal(streamObjects,0);return{streamObjects,pointerRows};
  }
  if(phase==='configure'){
   assert.match(input.image,/^sha256:[a-f0-9]{64}$/);
   const target=readVerificationTarget(await readFile(new URL('../../backup-verifier/target.json',import.meta.url),'utf8'));
   // This disposable proof database alone opts into recovery qualification; deployment stays disabled.
   await transaction(pool,c=>setVerificationPolicy(c,target,'local.waitron-verifier@'+input.image,true));return{configured:true};
  }
  if(phase==='reserve'){
   const capture=await machine('backup-reserve',randomUUID());await atomicPrivateFile(saved,JSON.stringify({capture}));return{recoveryKey:capture.recoveryKey};
  }
  const data=JSON.parse(await readFile(saved,'utf8'));
  async function owner(path,body){
   const encoded=JSON.stringify(body);
   return new Promise((resolve,reject)=>{const req=request({hostname:'proxy',port:3000,servername:'waitron.local',ca,path:'/api/account/'+path,method:'POST',headers:{host:'waitron.local:3000',origin:'https://waitron.local:3000',cookie:'__Host-cloud_session='+data.session.token,'x-csrf-token':data.session.csrfToken,'content-type':'application/json','content-length':Buffer.byteLength(encoded)}},res=>{let text='';res.on('data',part=>text+=part);res.once('end',()=>{try{assert.equal(res.statusCode,200,'fixture.owner_refused_'+res.statusCode);resolve(JSON.parse(text));}catch(error){reject(error);}});});req.setTimeout(10000,()=>req.destroy(Error('fixture.owner_timeout')));req.once('error',reject);req.end(encoded);});
  }
  if(phase==='catalogue'){
   if(!data.session){
    data.session=await transaction(pool,async c=>{const id=randomUUID();await c.query('INSERT INTO cloud_accounts(id) VALUES($1)',[id]);await c.query('INSERT INTO organisation_memberships(account_id,organisation_id,can_register_venues,is_owner) VALUES($1,$2,true,true)',[id,item.organisationId]);return createSession(c,id);});
    await atomicPrivateFile(saved,JSON.stringify(data));
   }
   const listed=await owner('backups/list',{venueId:item.venueId});
   assert.equal(listed.defaultPointId,data.point.id);assert.equal(listed.continuousRecovery,null);
   assert.equal(listed.points.find(p=>p.id===data.point.id)?.verification,'verified');
   assert(!JSON.stringify(listed).includes('recoveryKey'));
   return{currentPointIsDefault:true,continuousRecovery:null};
  }
  if(phase==='approve'){
   const proof={requestId:input.requestId,code:input.code};
   const inspected=await owner('recovery/inspect',proof);assert.equal(inspected.state,'awaiting_owner');
   assert.equal((await pool.query('SELECT verification_target FROM backup_recovery_requests WHERE id=$1',[input.requestId])).rows[0].verification_target.digest,input.targetDigest);
   const approved=await owner('recovery/approve',{...proof,source:'snapshot',pointId:data.point.id,oldServerUnavailable:'true',acceptDataLoss:'true'});assert.equal(approved.state,'approved');
   const selected=(await pool.query('SELECT r.verification_attempt_id,p.current_evidence_id FROM backup_recoveries r JOIN backup_points p ON p.id=r.point_id WHERE r.id=$1',[input.requestId])).rows[0];assert.equal(selected.verification_attempt_id,selected.current_evidence_id);assert.ok(selected.verification_attempt_id);
   assert(!JSON.stringify(approved).includes('recoveryKey'));
   data.recoveryRequestId=input.requestId;await atomicPrivateFile(saved,JSON.stringify(data));
   return{state:approved.state,pointId:data.point.id,digest:data.point.digest,bytes:data.point.size};
  }
  if(phase==='recovery-pending'){
   const recovery=(await pool.query('SELECT status FROM backup_recoveries WHERE id=$1',[input.requestId])).rows[0];assert.equal(recovery.status,'pending');
   assert.equal((await pool.query('SELECT superseded_by FROM installations WHERE id=$1',[item.installationId])).rows[0].superseded_by,null);
   return{restored:false};
  }
  if(phase==='evidence'){
   const attempt=(await pool.query('SELECT a.* FROM backup_verification_attempts a JOIN backup_points p ON p.current_evidence_id=a.id WHERE p.id=$1',[data.point.id])).rows[0];
   const selected=(await pool.query('SELECT verification_attempt_id,verification_target,status FROM backup_recoveries WHERE id=$1',[data.recoveryRequestId])).rows[0];
   assert.equal(attempt.status,'passed');assert.equal(attempt.cleanup_confirmed,true);assert.equal(selected.verification_attempt_id,attempt.id);assert.equal(selected.verification_target.digest,attempt.target_digest);assert.equal(selected.status,'pending');
   return{
    archive:{kind:'genuine-waitron',captureId:attempt.request.captureId,pointId:data.point.id,sourceNodeId:attempt.request.sourceNodeId,sha256:data.point.digest,bytes:data.point.size,modules:data.point.modules},
    verification:{attemptId:attempt.id,request:attempt.request,result:attempt.result,childId:attempt.child_id,cleanupConfirmed:attempt.cleanup_confirmed},
    admission:{attemptId:attempt.id,requestDigest:attempt.request_digest,pointId:data.point.id,targetDigest:attempt.target_digest,verification:'verified'},
    recovery:{protocolVersion:2,pointId:data.point.id,attemptId:selected.verification_attempt_id,targetDigest:selected.verification_target.digest},
   };
  }
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
   const attempt=(await pool.query('SELECT a.*,q.current_verification FROM backup_verification_attempts a JOIN backup_point_qualification q ON q.verification_id=a.id WHERE a.point_id=$1 AND a.id=(SELECT current_evidence_id FROM backup_points WHERE id=$1)',[data.point.id])).rows[0];
   assert.equal(attempt.state,'finished');assert.equal(attempt.status,'passed');assert.equal(attempt.current_verification,'verified');assert.equal(attempt.cleanup_confirmed,true);assert.equal(attempt.result.activation,'not_attempted');assert.equal(attempt.result.modules.length,15);
   return{realWaitronSnapshotVerified:true,scopedSignedCapture:true,controllerScope:attempt.controller_scope,attemptId:attempt.id,targetDigest:attempt.target_digest};
  }
  throw Error('fixture.phase');
 }finally{await pool.end();}
}
