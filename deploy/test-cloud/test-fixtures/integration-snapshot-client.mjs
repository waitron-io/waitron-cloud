import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {Agent,request} from 'node:https';
import {lookup} from 'node:dns';
import {observeSnapshotExposure} from './integration-snapshot-exposure.mjs';

export async function observeBackupReservation(request, record) {
  let response;
  try {response = await request();}
  catch (error) {
    await record({status: 0});
    throw error;
  }
  const observed = {status: response.status};
  if (response.status === 200) {
    const body = await response.clone().json().catch(() => null);
    // The address and credentials are private. Record only the reply shape.
    if (typeof body?.uploadUrl === 'string' && body.uploadUrl && body.credentials === undefined) observed.uploadMethod = 'signed-put';
    if (body?.credentials && body.uploadUrl === undefined) observed.uploadMethod = 'storage-session';
  }
  if (response.status === 403) {
    const body = await response.clone().json().catch(() => null);
    if (body && typeof body === 'object') {
      observed.error = body.error === 'permission_denied' ? 'permission_denied' : 'unexpected';
      observed.grantIssued = Object.keys(body).some(key => key !== 'error');
    }
  }
  await record(observed);
  return response;
}

export async function reserveLegacyIntegrationSnapshot(root,id) {
  const {machinePayload}=await import('/waitron/apps/server/src/cloud-installation.ts');
  const {signCloudPayload}=await import('/waitron/apps/server/src/cloud-signed-request.ts');
  const state=JSON.parse(await readFile(root+'/cloud/connection.json','utf8'));
  assert.equal(state.environment,'test');
  const lease=state.lifecycle?.lease;
  assert.ok(lease&&!state.lifecycle.revoked);
  const payload=machinePayload(state,{action:'backup-reserve',operationId:id,lease:JSON.stringify(lease),body:'{}'});
  const response=await fetch(state.origin+'/api/installations/backup-reserve',{method:'POST',redirect:'error',
    headers:{'content-type':'application/json'},signal:AbortSignal.timeout(15000),
    body:JSON.stringify({payload:payload.toString('base64url'),signature:signCloudPayload(payload,state.privateKey)})});
  assert.equal(response.status,200);
  const grant=await response.json();
  assert.ok(grant.id===id&&grant.credentials&&grant.uploadUrl===undefined);
  return grant;
}

export async function putIntegrationSnapshot(grant,bytes,storeCa) {
  const ca=await readFile(storeCa??'/proof/ca.pem'),signal=AbortSignal.timeout(10000);
  // Storage keeps the TLS hostname while the local fixture has a separate service address.
  const storageLookup=(hostname,options,done)=>lookup(hostname==='waitron.local'?'storage':hostname,options,done);
  if(grant.uploadUrl!==undefined){
    const url=new URL(grant.uploadUrl),destination=new URL(grant.location.endpoint);
    assert.ok(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash&&url.origin===destination.origin&&
      url.pathname==='/'+grant.location.bucket+'/'+grant.incomingKey);
    return new Promise((resolve,reject)=>{
      const req=request(url,{method:'PUT',ca,signal,lookup:storeCa?undefined:storageLookup,
        headers:{'if-none-match':'*','content-length':bytes.length}},response=>{
        response.resume();
        response.once('error',reject);
        response.once('end',()=>resolve(response.statusCode));
      });
      req.once('error',reject);req.end(bytes);
    });
  }
  const {S3Client,PutObjectCommand}=createRequire('/waitron/apps/server/package.json')('@aws-sdk/client-s3');
  const storage=new S3Client({endpoint:grant.location.endpoint,region:grant.location.region,
    credentials:grant.credentials,forcePathStyle:true,maxAttempts:1,
    requestHandler:{httpsAgent:new Agent({ca,...(storeCa?{}:{lookup:storageLookup})})}});
  try{
    const result=await storage.send(new PutObjectCommand({Bucket:grant.location.bucket,Key:grant.incomingKey,Body:bytes}),{abortSignal:signal});
    return result.$metadata.httpStatusCode;
  }finally{storage.destroy();}
}

export async function probeIntegrationSnapshotExposure(root, {downgradedAt}) {
  const saved = JSON.parse(await readFile(root + '/snapshot-access.json', 'utf8'));
  const state = JSON.parse(await readFile(root + '/cloud/connection.json', 'utf8'));
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
