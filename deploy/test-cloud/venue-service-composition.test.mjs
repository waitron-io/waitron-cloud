import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {venueServiceFixture,set} from '../../packages/registration/test/fixtures/venue-service.ts';
import {bootstrapStorageIssuer} from './storage-issuer.mjs';
import {openTestCaptureRuntime} from './service-runtime.mjs';

test('capture composition gives its managed streams venue authority while the organisation stays free',{timeout:30000},async()=>{
 const f=await venueServiceFixture(),directory=await mkdtemp(join(tmpdir(),'venue-capture-runtime-'));
 let server,runtime;
 try{
  await bootstrapStorageIssuer(directory);
  // The provider reload boundary is local; this test covers composition and durable policy, not S3 enforcement.
  server=createServer((request,response)=>{request.resume();response.writeHead(204);response.end();});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(join(directory,'storage-authority/reload.sock'),resolve);});
  runtime=await openTestCaptureRuntime({pool:f.pool,directory,mode:'test-venue-levels'});
  assert.equal(runtime.options.planMode,'test-venue-levels');
  assert.equal((await f.pool.query('SELECT service_plan FROM organisations WHERE id=$1',[f.scope.organisationId])).rows[0].service_plan,'free');
  const authority=runtime.options.managedStreams,input={venueId:f.venues[0],location:{endpoint:'https://waitron.local:8333',region:'local',bucket:'venue-fixture'},prefix:`streams/${f.venues[0]}/`};
  await assert.rejects(authority.provision(input),/permission_denied/);
  await set(f,'connected');const grant=await authority.provision(input);
  assert.match(grant.writerCredentials.accessKeyId,/^\S+$/);
  const state=()=>readFile(join(directory,'storage-authority/managed/state.json'),'utf8').then(JSON.parse);
  const connected=await state();assert.equal(connected.version,2);assert.equal(connected.venues[f.venues[0]].policyMode,'test-venue-levels');assert.equal(connected.venues[f.venues[0]].policyRevision,1);
  await set(f,'registered');await authority.reconcile();
  const withdrawn=await state();assert.equal(withdrawn.venues[f.venues[0]].writer,null);
  assert.equal(withdrawn.venues[f.venues[0]].readerId,connected.venues[f.venues[0]].readerId);
  await assert.rejects(authority.provision(input),/permission_denied/);
 }finally{
  runtime?.close();if(server)await new Promise(resolve=>server.close(resolve));
  await rm(directory,{recursive:true,force:true});await f.close();
 }
});
