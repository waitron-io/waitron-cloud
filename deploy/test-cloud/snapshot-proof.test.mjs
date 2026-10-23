import assert from 'node:assert/strict';
import test from 'node:test';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {verifyBackupVerifierProof} from '../../scripts/verify-backup-verifier-proof.mjs';
import {jointProofLine} from '../../scripts/backup-verifier-proof.mjs';
const execute=promisify(execFile),root=new URL('../../',import.meta.url).pathname,image=process.env.TEST_CLOUD_SNAPSHOT_PROOF_IMAGE,verifierImage=process.env.TEST_CLOUD_SNAPSHOT_VERIFIER_IMAGE;
// A no-op worker or dropped controller wiring leaves the signed, genuinely captured point pending.
test('delivered scoped backup worker verifies a genuine pinned Waitron snapshot',{skip:!image||!verifierImage,timeout:240000},async t=>{
 const project='waitron-cloud-test-snapshot-'+randomUUID().slice(0,8),directory=await mkdtemp(join(tmpdir(),'test-cloud-snapshot-proof-')),override=join(directory,'proof.yaml'),owned=[],recoveryImage=project+'-recovery:local';
 const docker=async args=>(await execute('docker',args,{cwd:root,env:{...process.env,TEST_CLOUD_IMAGE:image},timeout:120000,maxBuffer:8*1024*1024})).stdout.trim();
 const inputDocker=(args,input,phase=args[0])=>new Promise((resolve,reject)=>{
  const child=spawn('docker',args,{cwd:root,stdio:['pipe','pipe','pipe']});let output='',diagnostic='',size=0;const timer=setTimeout(()=>child.kill('SIGKILL'),90000);child.stdout.on('data',part=>{size+=part.length;if(size>8*1024*1024)child.kill('SIGKILL');else output+=part;});child.stderr.on('data',part=>{diagnostic=(diagnostic+part).slice(-2048);});child.once('error',reject);child.once('close',code=>{clearTimeout(timer);code===0?resolve(output.trim()):reject(Error('snapshot proof child failed at '+phase+' '+(diagnostic.match(/fixture-error:[a-z_-]+:[A-Za-z0-9_]+/)?.[0]??'')));});child.stdin.on('error',()=>{});child.stdin.end(input);
 });
 await writeFile(override,`name: ${project}\nservices:\n  account:\n    environment:\n      CLOUD_TEST_SERVICE_PLANS: "1"\n  storage:\n    environment:\n      CLOUD_TEST_SERVICE_PLANS: "1"\n    ports: !override ["127.0.0.1::8333"]\n  postgres:\n    ports: !override ["127.0.0.1::5432"]\n  mailpit:\n    ports: !override ["127.0.0.1::1025", "127.0.0.1::8025"]\n  proxy:\n    ports: !override ["127.0.0.1::3000"]\n  gateway:\n    ports: !override ["127.0.0.1::443", "127.0.0.1::51820/udp"]\n`);
 let account,controllerScope,recoveryBuilt=false,joint,authorisedRun;
 const verifierVolume=project+'-verifier-state';
 const prefix=['compose','--project-name',project,'--env-file','deploy/test-cloud/test.env','-f','compose.yaml','-f','deploy/test-cloud/compose.yaml','-f',override];
 t.after(async()=>{
  try{owned.push(...(await docker(['ps','-aq','--no-trunc','--filter','label=cloud.backup-verifier.owner='+project])).split(/\s+/).filter(Boolean));if(account){const scope=controllerScope??JSON.parse(await docker(['run','--rm','--network','none','--read-only','--mount',`type=volume,src=${verifierVolume},dst=/state,readonly`,'--entrypoint','node',image,'--input-type=module','-e',"import {readFile} from 'node:fs/promises';console.log(await readFile('/state/verifier-controller/identity.json','utf8').catch(()=>'{\"scope\":null}'));"])).scope;if(typeof scope==='string'){const ids=(await docker(['ps','-aq','--no-trunc','--filter','label=cloud.backup-verifier.owner=waitron-cloud-test-backup','--filter','label=cloud.backup-verifier.scope='+scope])).split(/\s+/).filter(Boolean);owned.push(...ids);}}const ids=[...new Set([...owned,...(await docker(['ps','-aq','--no-trunc','--filter',`label=com.docker.compose.project=${project}`])).split(/\s+/).filter(Boolean)])];if(ids.length)await docker(['rm','-f','-v',...ids]);
   for(const kind of ['network','volume'])for(const id of (await docker([kind,'ls','-q','--filter',`label=com.docker.compose.project=${project}`])).split(/\s+/).filter(Boolean))await docker([kind,'rm',id]);
  }finally{try{if(recoveryBuilt)await docker(['image','rm',recoveryImage]);}finally{await rm(directory,{recursive:true,force:true});}}
  if(authorisedRun)await authorisedRun;
  if(joint){
   const remaining=(await docker(['ps','-aq','--no-trunc'])).split(/\s+/);for(const id of owned)assert(!remaining.includes(id),'owned child remains');
   for(const kind of ['network','volume'])assert.equal(await docker([kind,'ls','-q','--filter',`label=com.docker.compose.project=${project}`]),'');
   await assert.rejects(stat(directory),{code:'ENOENT'});
   joint.cleanup={confirmed:true,containers:0,volumes:0,networks:0,directories:0};verifyBackupVerifierProof(joint);
   console.log(jointProofLine(joint));
  }
 });
 await docker(['volume','create','--label',`com.docker.compose.project=${project}`,verifierVolume]);
 await docker([...prefix,'up','--no-build','--pull','never','--detach','--wait','--wait-timeout','80']);
 account=await docker([...prefix,'ps','-q','account']);
 const phase=async(name,input={})=>JSON.parse((await inputDocker(['exec','-i',account,'node','--input-type=module','-e',`import {snapshotClientProof} from './deploy/test-cloud/test-fixtures/snapshot-client.mjs';let s='';for await(const b of process.stdin)s+=b;console.log(JSON.stringify(await snapshotClientProof(${JSON.stringify(name)},JSON.parse(s))));`],JSON.stringify(input),name)).split('\n').at(-1));
 const observations=[],observe=async name=>{assert.deepEqual(await phase('continuous'),{streamObjects:0,pointerRows:0});observations.push(name);};
 await docker(['exec',account,'node','--input-type=module','-e',"import {storageClientProof} from './deploy/test-cloud/test-fixtures/storage-client.mjs';await storageClientProof('seed-snapshot');"]);
 await observe('capture');
 await phase('configure',{image:verifierImage});
 const key=await phase('reserve');
 const exchange='/tmp/cloud-authorised-exchange',source=new URL('test-fixtures/snapshot-authorised-archive.test.ts',import.meta.url).pathname;
 const captureId=await docker(['create','--network','none','--memory','4096m','--memory-swap','4096m','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','128',
  '--tmpfs','/tmp:rw,nosuid,nodev,size=512m,mode=1777','--tmpfs','/waitron/apps/server/node_modules/.vite-temp:rw,nosuid,nodev,size=16m,mode=1777','--tmpfs','/waitron/apps/server/node_modules/.vite:rw,nosuid,nodev,size=32m,mode=1777',
  '--env','CLOUD_AUTHORISED_EXCHANGE='+exchange,'--mount',`type=bind,src=${source},dst=/waitron/apps/server/src/cloud-authorised-archive.test.ts,readonly`,'--workdir','/waitron/apps/server','--entrypoint','node',verifierImage,'-e','setInterval(()=>{},1000)']);owned.push(captureId);
 assert.equal(JSON.parse(await docker(['inspect',captureId]))[0].HostConfig.NetworkMode,'none');
 await docker(['start',captureId]);
 const sendPrivate=async(name,value)=>inputDocker(['exec','-i',captureId,'node','--input-type=module','-e',`import {mkdir,writeFile,rename} from 'node:fs/promises';await mkdir('${exchange}',{recursive:true,mode:0o700});let s='';for await(const b of process.stdin){s+=b;if(s.length>8*1024*1024)throw Error('fixture.input_large');}await writeFile('${exchange}/${name}.pending',s,{mode:0o600});await rename('${exchange}/${name}.pending','${exchange}/${name}');`],JSON.stringify(value),'authorised-private-input');
 await sendPrivate('input.json',key);
 let captureEnded=false;
 authorisedRun=docker(['exec',captureId,'pnpm','exec','vitest','run','src/cloud-authorised-archive.test.ts','--maxWorkers=1']).then(output=>({output}),()=>({failed:true})).finally(()=>{captureEnded=true;});
 let captured;
 for(let n=0;n<100;n++){
  captured=JSON.parse(await docker(['exec',captureId,'node','--input-type=module','-e',`import {readFile} from 'node:fs/promises';console.log(await readFile('${exchange}/capture.json','utf8').catch(e=>{if(e.code==='ENOENT')return 'null';throw e;}));`]));
  if(captured||captureEnded)break;await new Promise(resolve=>setTimeout(resolve,250));
 }
 assert(captured,'authorised source must capture before signed publication');
 // Docker inspection above proves this genuine source has no network; the verifier remains separately bounded.
 captured.metadata.networkDenied=true;assert.equal((await phase('publish',captured)).published,true);
 await observe('publication');
 const config=JSON.parse(await docker(['inspect',account])),volume=config[0].Mounts.find(m=>m.Destination==='/run/local-stack').Name,network=Object.keys(config[0].NetworkSettings.Networks)[0];
 const worker=await docker(['create','--network',network,'--memory','128m','--memory-swap','128m','--env','CLOUD_TEST_SERVICE_PLANS=1','--env','CLOUD_VERIFIER_IMAGE='+verifierImage,'--mount',`type=volume,src=${volume},dst=/run/local-stack,readonly`,'--mount',`type=volume,src=${verifierVolume},dst=/run/backup-verifier`,'--mount','type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock','--entrypoint','node',image,'deploy/test-cloud/runtime.mjs','backup']);owned.push(worker);
 await docker(['start',worker]);
 let verified=false;for(let n=0;n<90;n++){try{const result=await phase('assert');assert.equal(result.targetDigest,JSON.parse(await readFile(new URL('../backup-verifier/target.json',import.meta.url),'utf8')).digest);controllerScope=result.controllerScope;verified=result.realWaitronSnapshotVerified;break;}catch{await new Promise(resolve=>setTimeout(resolve,500));}}
 if(!verified)console.error(await docker(['logs','--tail','8',worker]));assert.equal(verified,true,'real snapshot must reach verified through the delivered scoped worker');
 await observe('verification');
 await docker(['stop','--time','15',worker]);
 const childIds=(await docker(['ps','-aq','--no-trunc','--filter','label=cloud.backup-verifier.owner=waitron-cloud-test-backup'])).split(/\s+/).filter(Boolean);
 const scope=controllerScope;
 for(const id of childIds){const [info]=JSON.parse(await docker(['inspect',id]));assert.notEqual(info.Config.Labels['cloud.backup-verifier.scope'],scope,'completed verifier must leave no child');}
 await observe('admission');
 const catalogue=await phase('catalogue');
 assert.equal(catalogue.currentPointIsDefault,true,'the owner API must select the genuinely qualified snapshot');
 assert.equal(catalogue.continuousRecovery,null,'the owner API must not offer a continuous source');
 await observe('catalogue');
 const [verifierInfo]=JSON.parse(await docker(['image','inspect',verifierImage])),verifierTag=verifierInfo.RepoTags?.[0];assert(verifierTag,'the local candidate needs a buildable tag');
 assert.equal(JSON.parse(await docker(['image','inspect',verifierTag]))[0].Id,verifierImage);
 await docker(['build','--build-arg','VERIFIER_IMAGE='+verifierTag,'-f','deploy/test-cloud/test-fixtures/snapshot-recovery.Dockerfile','-t',recoveryImage,'deploy/test-cloud/test-fixtures']);recoveryBuilt=true;
 const target=await docker(['create','--network',network,'--memory','1024m','--memory-swap','1024m','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--user','1000:1000','--pids-limit','128','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=256m,mode=1777','--entrypoint','node',recoveryImage,'-e','setInterval(()=>{},1000)']);owned.push(target);await docker(['start',target]);
 const targetPhase=async(name,input={})=>JSON.parse((await inputDocker(['exec','-i',target,'node','/waitron/apps/server/dist/cloud-joint-proof.js'],JSON.stringify({phase:name,...input}),name)).split('\n').at(-1));
 const started=await targetPhase('start',{ca:await docker(['exec',account,'cat','/run/local-stack/lan/ca.pem'])});
 const approved=await phase('approve',started);assert.equal(approved.state,'approved');
 await observe('approval');
 const delivered=await targetPhase('read',approved);assert.equal(delivered.independentDigest,true);assert.equal(delivered.prePlacement,true);assert.equal(delivered.client,'pinned-compiled-waitron');assert.equal(delivered.targetDigest,started.targetDigest);
 const denied=await targetPhase('delivery-refusals',approved);
 assert.deepEqual(denied,{alternateTargetRefused:true,damagedArchiveRefused:true,placementCalls:0,restoredReports:0,stateUnchanged:true});
 await observe('read');await observe('placement');
 const refusal=await targetPhase('restore-refusal',approved);assert.equal(refusal.ordinaryRestore,'FISCAL_RESTORE');assert.equal(refusal.activation,'not_attempted');assert.equal(refusal.routeMoved,false);assert.equal(refusal.reportedRestored,false);
 await sendPrivate('delivered.json',delivered.privateDelivery);
 const authorisedResult=await authorisedRun;assert(!authorisedResult.failed,'separately authorised ordinary restore must succeed');
 const authorisedMatches=[...authorisedResult.output.matchAll(/^.*CLOUD_AUTHORISED_ARCHIVE=(\{[^\n]+)$/gm)];assert.equal(authorisedMatches.length,1);
 const authorised=JSON.parse(authorisedMatches[0][1]);
 assert.deepEqual(authorised.delivery,{sha256:approved.digest,bytes:approved.bytes,source:'private-delivery',matchedCapture:true});
 assert.deepEqual(authorised.ordinaryRestore,{exit:0,preparationBoundToRecapture:true,retiredCounters:[123,123,123],activeCounters:[1,1,1],allocations:2});
 assert.equal((await phase('recovery-pending',started)).restored,false);
 const evidence=await phase('evidence');assert.equal(evidence.admission.attemptId,evidence.verification.attemptId);assert.equal(evidence.recovery.attemptId,evidence.admission.attemptId);
 const controlId=await docker(['create','--network','none','--memory','128m','--memory-swap','128m','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777','--mount','type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock','--entrypoint','node','-i',image,'--input-type=module','-e',"import {snapshotVerifierControls} from './deploy/test-cloud/test-fixtures/snapshot-verifier-controls.mjs';let s='';for await(const b of process.stdin){s+=b;if(s.length>8*1024*1024)throw Error('fixture.input_large');}console.log(JSON.stringify(await snapshotVerifierControls(JSON.parse(s))));"]);owned.push(controlId);
 const verifierControls=JSON.parse(await inputDocker(['start','-ai',controlId],JSON.stringify({directory:'/tmp/verifier-controls',image:verifierImage,owner:project,runId:project,request:evidence.verification.request,archive:captured.archive,recoveryKey:key.recoveryKey}),'same-run-verifier-controls'));
 assert.equal((await phase('assert')).attemptId,evidence.admission.attemptId,'refusal controls cannot replace the admitted attempt');
 assert.equal((await phase('recovery-pending',started)).restored,false);
 await observe('recovery');
 const git=async ref=>(await execute('git',['rev-parse',ref],{cwd:root})).stdout.trim(),checks={capture:['encrypted-archive','network-denied'],publication:['signed-publication','immutable-storage'],verification:['bound-sandbox','complete-module-checks','child-removed'],admission:['transaction-committed','current-qualification'],catalogue:['api-verified','api-default-point'],approval:['owner-v2','selected-attempt'],read:['pinned-compiled-waitron-client','target-before-placement','independent-digest'],placement:['genuine-data-placed','integrity-checked'],recovery:['ordinary-restore','separate-authority','no-activation','no-route-movement']};
 joint={version:2,runId:project,cloudHead:await git('HEAD'),cloudTree:await git('HEAD^{tree}'),cloudDirty:!!(await execute('git',['status','--porcelain'],{cwd:root})).stdout.trim(),waitronTarget:evidence.verification.request.target,candidateImage:verifierImage,publication:'unqualified',archive:evidence.archive,continuous:{streamObjects:0,pointerRows:0,observations},phases:[...Object.entries(checks).map(([name,checks])=>({name,state:'executed',runId:project,checks,reason:null})),{name:'refusals',state:'executed',runId:project,checks:['alternate-target-before-placement','archive-integrity','wrong-key','authority-no-activation','malformed-output','timeout','oom','scratch','cancel','crash','uncertain-cleanup'],reason:null}],verification:{request:evidence.verification.request,result:evidence.verification.result,receipt:{childId:evidence.verification.childId,imageId:verifierImage,requestDigest:evidence.admission.requestDigest,controllerScope:evidence.verification.request.attempt.controllerScope,childToken:evidence.verification.request.attempt.childToken,terminated:true,cleanupConfirmed:evidence.verification.cleanupConfirmed}},admission:evidence.admission,recovery:{...evidence.recovery,readDigest:approved.digest,readBytes:approved.bytes,client:delivered.client,placement:'not-run',ordinaryRestore:refusal.ordinaryRestore,activation:refusal.activation,routeMoved:refusal.routeMoved},cleanup:null};
 joint.verifierControls=verifierControls;
 joint.authorisedRecovery={runId:project,archiveSha256:evidence.archive.sha256,archiveBytes:evidence.archive.bytes,pointId:evidence.archive.pointId,attemptId:evidence.admission.attemptId,client:delivered.client,ordinaryActivation:'executed-with-separate-authority',routeMoved:false,cloudReportedRestored:false,delivery:authorised.delivery,ordinaryRestore:authorised.ordinaryRestore,refusals:authorised.refusals};
 assert.equal(joint.phases.find(p=>p.name==='refusals').state,'executed','all current-run verifier refusals must be complete');
 assert.equal(joint.verifierControls?.cases.length,11,'the joint run must execute fresh verifier refusal controls for its own archive');
 assert.equal(joint.authorisedRecovery?.ordinaryRestore.exit,0,'the joint run must recover its independently delivered archive with separate authority');
 console.log(JSON.stringify({realWaitronSnapshotVerified:true,pinnedRevision:'ec91a9e34d2daba146f4ee61850ea4136ad5cfb7',childCleanup:true,planMode:'test-free-paid',captureNetwork:'none',ownerApprovalV2:true,ordinaryRestore:refusal.ordinaryRestore,separatelyAuthorisedRestore:true}));
});
