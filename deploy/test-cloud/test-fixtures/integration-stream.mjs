import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID,createPrivateKey,sign} from 'node:crypto';
import {createRequire} from 'node:module';
import {request} from 'node:https';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as delay} from 'node:timers/promises';
import {seedTermZeroMembership} from '/waitron/apps/server/src/membership-seed.ts';
import {loadBoxEnv} from '/waitron/apps/server/src/box-env.ts';
const require=createRequire('/waitron/apps/server/package.json');
const {openVenueDatabase}=require('@waitron/db'),{loadKeyRing}=require('@waitron/credentials');
const {createS3ObjectStore,readPointer,verifyPointer}=require('@waitron/stream');

// The fixture drives the normal management API and native stream host for this paired source.
export async function startIntegrationStream(root) {
  assert.equal(process.env.CLOUD_TEST_STREAM,'1');
  const phase=async value=>writeFile(root+'/stream-phase.json',JSON.stringify({phase:value}),{mode:0o600});
  await phase('source-membership');
  const saved=JSON.parse(await readFile(root+'/fixture-env.json','utf8'));
  const ready=JSON.parse(await readFile(root+'/ready.json','utf8'));
  const store=await openVenueDatabase(root+'/venue',{exclusive:false});
  try {await seedTermZeroMembership({db:store.venue,ring:loadKeyRing(await loadBoxEnv({},root))},saved.WAITRON_TILL_NODE_ID,saved.WAITRON_MANAGEMENT_ORIGIN);}
  finally {await store.close();}
  const db=new DatabaseSync(root+'/venue/venue.db',{readOnly:true});
  let signer;
  try {signer=db.prepare('SELECT public_key FROM nodes WHERE id=?').get(saved.WAITRON_TILL_NODE_ID)?.public_key;}
  finally {db.close();}
  assert.ok(signer);
  const machine=async(action,body)=>{
    const state=JSON.parse(await readFile(root+'/cloud-connection.json','utf8'));
    const payload=Buffer.from(JSON.stringify(['waitron-cloud-machine-v1',state.origin,action,state.view.registration.installationId,
      randomUUID(),Date.now(),JSON.stringify(state.lifecycle.lease),JSON.stringify(body)]));
    const key=createPrivateKey({key:Buffer.from(state.privateKey,'base64url'),format:'der',type:'pkcs8'});
    const response=await fetch(state.origin+'/api/installations/'+action,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({payload:payload.toString('base64url'),signature:sign(null,payload,key).toString('base64url')}),signal:AbortSignal.timeout(10000)});
    assert.equal(response.status,200,'integration.stream_machine_'+action+':'+response.status);
    return response.json();
  };
  const state=JSON.parse(await readFile(root+'/cloud-connection.json','utf8'));
  await phase('cloud-configuration');
  const configured=await machine('backup-stream-configure',{revision:state.lifecycle.view.revision,localVenueId:ready.localVenueId,
    sourceNodeId:saved.WAITRON_TILL_NODE_ID,pointerSignerPublicKey:signer});
  await writeFile(root+'/backup.env','WAITRON_BACKUP_RECOVERY_KEY='+configured.recoveryKey+'\n',{mode:0o600});
  const ca=await readFile(root+'/tls/ca.crt');
  const local=(method,path,body,cookie='')=>new Promise((resolve,reject)=>{
    const req=request(new URL(path,ready.origin),{method,ca,headers:{origin:ready.origin,cookie,'content-type':'application/json'}},res=>{
      let text='';res.on('data',part=>{text+=part;if(text.length>65536)req.destroy(Error('integration.stream_reply_large'));});
      res.once('error',reject);res.once('end',()=>{try{resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(text)});}catch(error){reject(error);}});
    });
    req.setTimeout(15000,()=>req.destroy(Error('integration.stream_local_timeout')));req.once('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
  const login=await local('POST','/management-api/session',{email:'owner@example.test',password:'Local integration password'});
  assert.equal(login.status,200);
  const cookie=login.headers['set-cookie'].map(value=>value.split(';')[0]).join('; ');
  await phase('native-stream-attach');
  const attached=await local('PUT','/api/backup/stream',configured.bucket,cookie);
  assert.equal(attached.status,200,'integration.stream_attach:'+attached.body.error);
  await phase('native-stream-upload');
  let status;
  const deadline=Date.now()+60000;
  while(Date.now()<deadline) {
    const response=await local('GET','/api/backup/stream',undefined,cookie);assert.equal(response.status,200);
    status=response.body.status;
    if(status?.state==='streaming'&&status.lastConfirmedUploadAt)break;
    await delay(500);
  }
  assert.equal(status?.state,'streaming','integration.stream_not_streaming');assert.ok(status.lastConfirmedUploadAt,'integration.stream_not_uploaded');
  await phase('cloud-observation');
  const observed=await machine('backup-stream-observe',{});
  const pointer=await readPointer(createS3ObjectStore(configured.bucket),ready.localVenueId);
  assert.ok(pointer);assert.equal(verifyPointer(pointer.pointer,signer),true);
  assert.equal(pointer.pointer.body.nodeId,saved.WAITRON_TILL_NODE_ID);
  assert.equal(observed.recoverableAt,pointer.pointer.body.writtenAt);
  await phase('signed-pointer-confirmed');
  return {venueId:configured.venueId,installationId:configured.installationId,sourceNodeId:saved.WAITRON_TILL_NODE_ID,
    localVenueId:ready.localVenueId,generation:pointer.pointer.body.generation,recoverableAt:observed.recoverableAt,nativeStreaming:true};
}
