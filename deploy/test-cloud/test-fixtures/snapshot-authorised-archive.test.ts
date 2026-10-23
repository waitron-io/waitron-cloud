// Mounted into the unchanged pinned Waitron image; its existing helper owns setup and teardown.
import {archiveHost,archiveCommand,agreeInternet,suite,node,key} from '../test/hour-recovery-host.js';
import {it,expect,vi} from 'vitest';
import {mkdtemp,readFile,writeFile,rm,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {ALL_MODULES} from '@waitron/composition';
import {openVenueDatabase,invoiceSeries} from '@waitron/db';
import {loadKeyRing} from '@waitron/credentials';
import {fiscalAllocations} from '../../../packages/fiscal-verifactu/src/schema/allocations.js';
import {makeAuthority} from '../../../packages/fiscal-verifactu/test/certificate-fixtures.js';
import {sealAeatSecret} from '../../../packages/fiscal-verifactu/src/provisioning-secret.js';
import {ensureBoxSecrets} from './box-secrets.js';
import {establishNodeIdentity} from './node-identity.js';
import {writeTradingEnv} from './trading-config.js';
import {loadBoxEnv} from './box-env.js';
import {runOnce} from './backup-sweep.js';
import {unpackArchive} from './backup-archive.js';
import {decryptArtifact} from './artifact-cipher.js';
import {previewRecoveryArchive} from './recovery-backup-preview.js';
import {createSelectedRecoveryPreparation} from './recovery-preparation.js';
import {runRestore} from './restore-command.js';
import {restoreFromArtifact} from './restore.js';
import {createRecoveryRestoreRunner} from './recovery-module-operation.js';

it('recaptures the authorised source and prepares recovery for its new archive',async()=>{
 const original=await archiveHost(),directory=await mkdtemp('/tmp/cloud-integration-backup-authorised-');
 try{
  const exchange=process.env.CLOUD_AUTHORISED_EXCHANGE;
  const recoveryKey=exchange?JSON.parse(await readFile(join(exchange,'input.json'),'utf8')).recoveryKey:'archive password';
  expect(typeof recoveryKey).toBe('string');expect(recoveryKey.length).toBeGreaterThan(0);
  await ensureBoxSecrets({stateDir:directory,hostnames:['localhost'],now:()=>new Date(),listIpv4:()=>[]});
  await writeTradingEnv(directory,{nodeId:node.nodeId,locationId:node.locationId,environment:'preproduction',developmentMode:true,onboardingIntent:'demo'});
  await writeFile(join(directory,'modules.json'),JSON.stringify({modules:{'fiscal-verifactu':true,'fiscal-none':false}}));
  const ring=loadKeyRing(await loadBoxEnv({},directory));
  await establishNodeIdentity({ownerDb:suite.db,ring},node.nodeId);
  const certificate=makeAuthority().issue({organizationIdentifier:'VATES-89890001K'});
  await sealAeatSecret({db:suite.db,ring,nodeId:node.nodeId},{pfxBase64:certificate.pfx.toString('base64'),passphrase:certificate.passphrase,certKind:'sello'});
  let artifact:Uint8Array|undefined;
  const forbidden=async()=>{throw Error('fixture.capture_only');};
  await runOnce({
   backends:[{id:'authorised-fixture',async put(_name,bytes){artifact=bytes;},async putFile(_name,path){artifact=await readFile(path);},get:forbidden,getFile:forbidden,async list(){return [];},delete:forbidden,deleteMany:forbidden,close(){}}],
   db:suite.db,modules:ALL_MODULES,environment:'preproduction',resolvers:{},stateDir:directory,recoveryKey,stagingDir:join(directory,'staging'),retain:100,retainDays:3650,destinationTimeoutMs:60000,signal:new AbortController().signal,log:()=>{},archive:path=>suite.db.archiveTo(path),
  });
  expect(artifact).toBeDefined();
  const archive=artifact!,manifest=JSON.parse(unpackArchive(decryptArtifact(archive,recoveryKey)).find(entry=>entry.name==='manifest.json')!.bytes.toString());
  await writeFile(join(directory,'selected.enc'),archive,{mode:0o600});
  await writeFile(join(directory,'manifest.json'),JSON.stringify(manifest),{mode:0o600});
  // Native Node loads the compiled verifier; Vite must not transform its release/runtime stamps.
  const checked=spawnSync(process.execPath,['--input-type=module','-e',`
   import {verifyBackupArtifact,currentBackupVerificationTarget,BACKUP_VERIFICATION_MODULES} from '/waitron/apps/server/dist/backup-verification.js';
   import {readFileSync} from 'node:fs';import {join} from 'node:path';import {createHash,randomUUID} from 'node:crypto';
   const [directory,sourceNodeId]=process.argv.slice(1),artifactPath=join(directory,'selected.enc'),artifact=readFileSync(artifactPath),manifest=JSON.parse(readFileSync(join(directory,'manifest.json'),'utf8')),target=currentBackupVerificationTarget();
   const request={protocol:'backup-data-restore/v1',captureId:'fixture-capture',pointId:'fixture-capture',venueId:'fixture-venue',sourceInstallationId:'fixture-installation',sourceNodeId,capturedAt:manifest.createdAt,archive:{sha256:createHash('sha256').update(artifact).digest('hex'),bytes:artifact.length,manifestVersion:1,environment:'preproduction',modules:manifest.modules},backupKey:{version:1,reference:'fixture-key'},target,verifierImage:'local.fixture@sha256:'+'2'.repeat(64),attempt:{jobId:'fixture-job',number:1,claimId:'fixture-claim',controllerScope:'fixture-controller',childToken:randomUUID(),deadline:new Date(Date.now()+30000).toISOString()}};
   const secret=JSON.parse(readFileSync(0,'utf8')).recoveryKey;
   const result=await verifyBackupArtifact(request,{artifactPath,recoveryKey:{version:1,reference:'fixture-key',secret},scratchRoot:directory,modules:BACKUP_VERIFICATION_MODULES,migrationsRoot:'/waitron/apps/server/dist/drizzle',runtime:target.runtime,signal:new AbortController().signal,now:()=>new Date()});
   console.log(JSON.stringify(result));
  `,directory,node.nodeId],{input:JSON.stringify({recoveryKey}),encoding:'utf8',timeout:60000,maxBuffer:100000});
  expect(checked.status).toBe(0);
  const verification=JSON.parse(checked.stdout.trim());expect(verification.status).toBe('passed');
  let deliveredArchive=archive,delivery;
  if(exchange){
   // The capture stays private while Cloud independently verifies and delivers these bytes.
   await writeFile(join(exchange,'capture.pending'),JSON.stringify({metadata:{sourceNodeId:node.nodeId,manifest},archive:Buffer.from(archive).toString('base64')}),{mode:0o600});
   await rename(join(exchange,'capture.pending'),join(exchange,'capture.json'));
   let delivered;const deadline=performance.now()+90000;
   while(performance.now()<deadline){
    try{delivered=JSON.parse(await readFile(join(exchange,'delivered.json'),'utf8'));break;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    await delay(100);
   }
   expect(delivered,'independent delivery is required before ordinary recovery').toBeDefined();
   deliveredArchive=Buffer.from(delivered.archive,'base64');
   const digest=createHash('sha256').update(deliveredArchive).digest('hex');
   expect(digest).toBe(createHash('sha256').update(archive).digest('hex'));
   expect(delivered.digest).toBe(digest);expect(delivered.recoveryKey===recoveryKey).toBe(true);
   delivery={sha256:digest,bytes:deliveredArchive.length,source:'private-delivery',matchedCapture:true};
  }
  const restore={...original.restore,artifact:deliveredArchive,recoveryKey},selected=await previewRecoveryArchive(restore);
  const preparationBoundToRecapture=selected.sourceId!==original.options.selected.sourceId;
  expect(preparationBoundToRecapture).toBe(true);
  const options={...original.options,selected,binding:{...original.options.binding,eventId:'cloud-authorised-recapture',sourceId:selected.activationSourceId??selected.sourceId}};
  // The synthetic archive already reserved its hour. A new capture gets a new operation and a later observed hour.
  vi.setSystemTime(new Date('2026-10-16T13:40:00Z'));
  const service=createSelectedRecoveryPreparation(options),challenge=await service.prepare({action:'clock-challenge'}) as {id:string};
  await service.prepare({action:'compare-clocks',browser:{challengeId:challenge.id,instantMs:Date.now()}});
  const outcome=await service.prepare({action:'select',answer:'no',installationCodes:['06RB']}) as {input:unknown};
  const command=await archiveCommand({...original,restore,options,outcome});agreeInternet();
  command.env.WAITRON_BACKUP_RECOVERY_KEY=recoveryKey;
  const destination=join(original.roots.venueDir,'venue.db'),identity=join(original.roots.stateDir,'trading.env');
  await writeFile(destination,'original destination database');await writeFile(identity,'original destination identity');
  const preserved=async()=>await readFile(destination,'utf8')==='original destination database'&&await readFile(identity,'utf8')==='original destination identity';
  let wrongOutput='';
  const wrongExit=await runRestore({...command,env:{...command.env,WAITRON_NODE_RECOVERY_KEY:'wrong node key'},out:line=>{wrongOutput+=line+'\n';}});
  const wrongNodeKey={exit:wrongExit,code:wrongOutput.match(/restore failed: ([a-z_.]+)/)?.[1],destinationPreserved:await preserved()};
  expect(wrongNodeKey).toEqual({exit:1,code:'promotion.break_glass_invalid',destinationPreserved:true});
  expect(wrongOutput.includes(key.secret)).toBe(false);
  let denied:{code?:string;params?:{reason?:string}}|undefined;
  try{
   await restoreFromArtifact({...restore,withModuleOperations:createRecoveryRestoreRunner(ALL_MODULES,{binding:options.binding,input:outcome.input},key.secret)});
  }catch(error){denied=error as typeof denied;}
  const missingPreparation={code:denied?.code,reason:denied?.params?.reason,destinationPreserved:await preserved()};
  expect(missingPreparation).toEqual({code:'sif.allocation_invalid',reason:'outside_confirmation_missing',destinationPreserved:true});
  await rm(destination);await rm(identity);let output='';
  const exit=await runRestore({...command,out:line=>{output+=line+'\n';}});
  expect(exit).toBe(0);expect(output.includes('restored '+command.artifactPath)).toBe(true);
  expect(output.includes(key.secret)).toBe(false);expect(output.includes('archive password')).toBe(false);expect(output.includes(recoveryKey)).toBe(false);
  const restored=await openVenueDatabase(original.roots.venueDir);
  try{
   const series=await restored.venue.select().from(invoiceSeries),retiredCounters=series.filter(row=>row.retiredAt!==null).map(row=>row.nextNumber),activeCounters=series.filter(row=>row.retiredAt===null).map(row=>row.nextNumber),allocations=(await restored.venue.select().from(fiscalAllocations)).length;
   expect(retiredCounters).toEqual([123,123,123]);expect(activeCounters).toEqual([1,1,1]);expect(allocations).toBe(2);
   console.log('CLOUD_AUTHORISED_ARCHIVE='+JSON.stringify({verification,ordinaryRestore:{exit,preparationBoundToRecapture,retiredCounters,activeCounters,allocations},refusals:{wrongNodeKey,missingPreparation},...(delivery?{delivery}:{})}));
  }finally{await restored.close();}
 }finally{await rm(directory,{recursive:true,force:true});}
},120000);
