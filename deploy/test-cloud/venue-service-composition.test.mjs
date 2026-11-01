import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {venueServiceFixture,set} from '../../packages/registration/test/fixtures/venue-service.ts';
import {bootstrapStorageIssuer} from './storage-issuer.mjs';
import {openTestCaptureRuntime} from './service-runtime.mjs';
import {openPlanStorage} from './service-runtime.mjs';
import {startBackupStorage} from '../../scripts/backup-storage-fixture.mjs';

test('capture composition gives its managed streams venue authority while the organisation stays free',{timeout:30000},async()=>{
 const f=await venueServiceFixture(),directory=await mkdtemp(join(tmpdir(),'venue-capture-runtime-'));
 let storage,runtime;
 try{
  await bootstrapStorageIssuer(directory);
  storage=await startBackupStorage();
  const options={directory:join(storage.root,'managed'),iamPath:join(storage.root,'iam.json'),admin:storage.admin,endpoint:storage.endpoint,region:'local',ca:storage.ca,reload:()=>storage.reloadIdentityFile()};
  runtime=await openTestCaptureRuntime({pool:f.pool,directory,mode:'test-venue-levels',openStorage:authority=>openPlanStorage({...authority,...options})});
  assert.equal(runtime.options.planMode,'test-venue-levels');
  assert.equal((await f.pool.query('SELECT service_plan FROM organisations WHERE id=$1',[f.scope.organisationId])).rows[0].service_plan,'free');
  const authority=runtime.options.managedStreams,input={venueId:f.venues[0],location:await storage.bucket('venue-fixture'),prefix:`streams/${f.venues[0]}/`};
  await assert.rejects(authority.provision(input),/permission_denied/);
  await set(f,'connected');const grant=await authority.provision(input);
  assert.match(grant.writerCredentials.accessKeyId,/^\S+$/);
  const state=()=>readFile(join(options.directory,'state.json'),'utf8').then(JSON.parse);
  const connected=await state();assert.equal(connected.version,2);assert.equal(connected.venues[f.venues[0]].policyMode,'test-venue-levels');assert.equal(connected.venues[f.venues[0]].policyRevision,1);
  await set(f,'registered');await authority.reconcile();
  const withdrawn=await state();assert.equal(withdrawn.venues[f.venues[0]].writer,null);
  assert.equal(withdrawn.venues[f.venues[0]].readerId,connected.venues[f.venues[0]].readerId);
  await assert.rejects(authority.provision(input),/permission_denied/);
 }finally{
  runtime?.close();await storage?.stop();
  await rm(directory,{recursive:true,force:true});await f.close();
 }
});
