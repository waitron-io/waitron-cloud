import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm,mkdir,symlink,rename,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Readable} from 'node:stream';
// Removing the ID/owner fence would delete the decoy; removing the slot would run two children.
const docker=(...args)=>execFileSync('docker',args,{encoding:'utf8',timeout:120000,stdio:['pipe','pipe','pipe']}).trim();
const dockerPath=()=>execFileSync('which',['docker'],{encoding:'utf8'}).trim();
const enabled=process.env.TEST_CLOUD_VERIFIER_CONTROLLER_PROOF==='1';
test('scoped verifier serialises children, journals exact IDs and leaves foreign containers untouched',{skip:!enabled,timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'cloud-scoped-verifier-')),owner='scope-'+randomUUID(),tag='cloud-scope-test:'+owner,ids=[];
 t.after(async()=>{try{const state=JSON.parse(await readFile(join(directory,'identity.json'),'utf8'));ids.push(...docker('ps','-aq','--no-trunc','--filter','label=cloud.backup-verifier.owner='+owner,'--filter','label=cloud.backup-verifier.scope='+state.scope).split(/\s+/).filter(Boolean));}catch{}for(const id of new Set(ids))try{docker('rm','-f',id);}catch{}try{docker('image','rm',tag);}catch{}await rm(directory,{recursive:true,force:true});});
 docker('build','-q','-t',tag,'-f','packages/backups/test/container-fixture/Dockerfile','.');
 const image=JSON.parse(docker('image','inspect',tag))[0].Id;
 const {openVerifierController}=await import('./verifier-controller.mjs');
 const {openTestBackupVerifier}=await import('./backup-worker.mjs');
 await assert.rejects(openTestBackupVerifier({directory:join(directory,'wrong-image'),image}),/test_cloud.verifier_configuration/);
 const controller=await openVerifierController({directory,owner,image});
 const args=['--network','none','--read-only','--entrypoint','node',image,'-e','setInterval(()=>{},1000)'];
 const id=await controller.create(args);ids.push(id);assert.match(id,/^[a-f0-9]{64}$/);
 const state=JSON.parse(await readFile(join(directory,'child.json'),'utf8'));assert.equal(state.id,id);
 docker('start',id);
 await assert.rejects(controller.create(args),/test_cloud.verifier_busy/);
 await assert.rejects(openVerifierController({directory,owner,image}),/test_cloud.verifier_busy/);
 const foreign=docker('create','--label','cloud.backup-verifier.owner='+owner,'--label','cloud.backup-verifier.deadline=0','--entrypoint','node',image,'-e','');ids.push(foreign);
 await assert.rejects(controller.remove(foreign),/test_cloud.verifier_ownership/);
 await writeFile(join(directory,'child.json'),JSON.stringify({...state,id:foreign}),{mode:0o600});
 await assert.rejects(controller.remove(foreign),/test_cloud.verifier_ownership/);
 assert.equal(JSON.parse(docker('inspect',id))[0].State.Running,true);
 assert.equal(JSON.parse(docker('inspect',foreign))[0].State.Status,'created');
 await writeFile(join(directory,'child.json'),JSON.stringify(state),{mode:0o600});await controller.remove(id);
 await assert.rejects(readFile(join(directory,'child.json')),/ENOENT/);
 assert.equal(JSON.parse(docker('inspect',foreign))[0].State.Status,'created');
 const scope=JSON.parse(await readFile(join(directory,'identity.json'),'utf8')).scope;
 for(const changed of ['owner','scope','token','image']){
  const labels={'cloud.backup-verifier.owner':owner,'cloud.backup-verifier.scope':scope,'cloud.backup-verifier.token':state.token};
  if(changed!=='image')labels['cloud.backup-verifier.'+changed]='foreign-'+labels['cloud.backup-verifier.'+changed];
  const decoy=docker('create',...Object.entries(labels).flatMap(([key,value])=>['--label',key+'='+value]),'--entrypoint','node',changed==='image'?'node:26':image,'-e','');ids.push(decoy);
  await writeFile(join(directory,'child.json'),JSON.stringify({...state,id:decoy}),{mode:0o600});
  await assert.rejects(controller.remove(decoy),/test_cloud.verifier_ownership/);
  assert.equal(JSON.parse(docker('inspect',decoy))[0].State.Status,'created');
  docker('rm','-f',decoy);await rm(join(directory,'child.json'));
 }
 // A restart must recover a child created before its ID was saved, and refuse lost intent.
 const interrupted=await controller.create(args);ids.push(interrupted);
 const intent=JSON.parse(await readFile(join(directory,'child.json'),'utf8'));
 await writeFile(join(directory,'child.json'),JSON.stringify({...intent,id:null,deadline:0}),{mode:0o600});
 await openVerifierController({directory,owner,image});
 assert.throws(()=>docker('inspect',interrupted));
 const lost=await controller.create(args);ids.push(lost);
 const original=await readFile(join(directory,'child.json'),'utf8');await rm(join(directory,'child.json'));
 await assert.rejects(openVerifierController({directory,owner,image}),/test_cloud.verifier_ownership/);
 await writeFile(join(directory,'child.json'),original,{mode:0o600});await controller.remove(lost);
 const gone=await controller.create(args);ids.push(gone);docker('rm','-f',gone);await controller.remove(gone);
 await assert.rejects(openVerifierController({directory,owner:'another-owner',image}),/test_cloud.verifier_ownership/);
 await assert.rejects(openVerifierController({directory,owner,image:tag}),/test_cloud.verifier_configuration/);
 // A failed create reply cannot prove that the daemon will never finish creating the child.
 const bin=join(directory,'bin');await mkdir(bin,{mode:0o700});const realDocker=dockerPath(),oldPath=process.env.PATH;
 await writeFile(join(bin,'docker'),`#!${process.execPath}\nconst cp=require('node:child_process'),args=process.argv.slice(2);if(args[0]==='create')process.exit(125);const r=cp.spawnSync(${JSON.stringify(realDocker)},args,{stdio:'inherit'});process.exit(r.status??1);`,{mode:0o700});
 process.env.PATH=bin+':'+oldPath;
 try{await assert.rejects(controller.create(args),/test_cloud.verifier_docker/);const uncertain=JSON.parse(await readFile(join(directory,'child.json'),'utf8'));assert.equal(uncertain.id,null);await assert.rejects(controller.create(args),/test_cloud.verifier_busy/);}
 finally{process.env.PATH=oldPath;await rm(join(directory,'child.json'),{force:true});}
 const {createContainerWaitronVerifier}=await import('../../packages/backups/src/container-verifier.ts');
 const verify=await createContainerWaitronVerifier({image,owner,controller,memoryMiB:192,scratchMiB:16});
 const data=Buffer.from([5]);
 const result=await verify({receipt:{size:1,digest:''},open:()=>{const journal=JSON.parse(readFileSync(join(directory,'child.json'),'utf8'));const [child]=JSON.parse(docker('inspect',journal.id));assert.equal(child.HostConfig.NetworkMode,'none');assert.equal(child.HostConfig.Memory,201326592);assert.equal(child.HostConfig.MemorySwap,201326592);assert.equal(child.HostConfig.ReadonlyRootfs,true);assert.deepEqual(child.Mounts,[]);assert.equal(child.Config.User,'1000:1000');assert.match(child.HostConfig.Tmpfs['/scratch'],/size=16m/);return Readable.from([data]);},async dispose(){}},{recoveryKey:'fixture'}, {sourceNodeId:'00000000-0000-4000-8000-000000000005',modules:{fake:1},capturedAt:'2026-09-26T00:00:00.000Z'},new AbortController().signal);
 assert.equal(result.integrityOk,true);assert.equal(JSON.parse(docker('inspect',foreign))[0].State.Status,'created');await assert.rejects(readFile(join(directory,'child.json')),/ENOENT/);
 console.log(JSON.stringify({exactIds:true,foreignPreserved:true,singleChild:true,containerFixtureVerified:true}));
});

// The request token, claim and deadline must own creation and cleanup across a restart.
test('bound controller journals the exact request and refuses foreign or uncertain ownership',{skip:!enabled,timeout:120000},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'cloud-bound-controller-')),owner='bound-'+randomUUID(),tag='cloud-bound-scope:'+owner,ids=[];
 t.after(async()=>{try{const state=JSON.parse(await readFile(join(directory,'identity.json'),'utf8'));ids.push(...docker('ps','-aq','--no-trunc','--filter','label=cloud.backup-verifier.owner='+owner,'--filter','label=cloud.backup-verifier.scope='+state.scope).split(/\s+/).filter(Boolean));}catch{}for(const id of new Set(ids))try{docker('rm','-f',id);}catch{}try{docker('image','rm',tag);}catch{}await rm(directory,{recursive:true,force:true});});
 docker('build','-q','-t',tag,'-f','packages/backups/test/container-fixture/Dockerfile','.');
 const image=JSON.parse(docker('image','inspect',tag))[0].Id;
 const {openVerifierController}=await import('./verifier-controller.mjs');
 const {backupVerificationRequestDigest}=await import('../../packages/backups/src/verification-protocol.ts');
 const controller=await openVerifierController({directory,owner,image});
 assert.equal(typeof controller.scope,'string','bound attempts need the durable controller scope');
 const base=JSON.parse(await readFile('packages/backups/test/fixtures/verification-vector.json','utf8'));
 const request=()=>({...structuredClone(base),verifierImage:'local.waitron-verifier@'+image,attempt:{...base.attempt,controllerScope:controller.scope,childToken:'same-request-token-'+randomUUID(),claimId:'claim-'+randomUUID(),deadline:new Date(Date.now()+25000).toISOString()}});
 const args=['--network','none','--read-only','--entrypoint','node',image,'-e',''];
 let req=request(),id=await controller.create(args,req);ids.push(id);
 let state=JSON.parse(await readFile(join(directory,'child.json'),'utf8'));
 assert.equal(state.token,req.attempt.childToken);assert.equal(state.deadline,Date.parse(req.attempt.deadline));assert.equal(state.requestDigest,backupVerificationRequestDigest(req));assert.deepEqual(state.request,req);assert.equal(state.id,id);
 const [info]=JSON.parse(docker('inspect',id));
 for(const [field,value] of Object.entries({scope:req.attempt.controllerScope,token:req.attempt.childToken,claim:req.attempt.claimId,request:backupVerificationRequestDigest(req),deadline:String(Date.parse(req.attempt.deadline))}))assert.equal(info.Config.Labels['cloud.backup-verifier.'+field],value);
 for(const changed of [{...req,attempt:{...req.attempt,claimId:'foreign'}},{...req,attempt:{...req.attempt,childToken:'foreign'}},{...req,verifierImage:'local.waitron-verifier@sha256:'+'a'.repeat(64)}]){await assert.rejects(controller.remove(id,changed),/test_cloud.verifier_ownership/);assert.equal(JSON.parse(docker('inspect',id))[0].State.Status,'created');}
 await assert.rejects(controller.remove(id),/test_cloud.verifier_ownership/);
 await assert.rejects(controller.create(args,request()),/test_cloud.verifier_busy/);
 await controller.remove(id,req);await assert.rejects(readFile(join(directory,'child.json')),/ENOENT/);
 // Invalid scope/image/deadline and attempts to override reserved labels never create anything.
 for(const changed of [{...req,attempt:{...req.attempt,controllerScope:'foreign'}},{...req,verifierImage:'local.waitron-verifier@sha256:'+'a'.repeat(64)},{...req,attempt:{...req.attempt,deadline:'2026-01-01T00:00:00.000Z'}},{...req,attempt:{...req.attempt,deadline:new Date(Date.now()+60000).toISOString()}}])await assert.rejects(controller.create(args,changed),/test_cloud.verifier_ownership/);
 await assert.rejects(controller.create(['--label','cloud.backup-verifier.token=foreign',...args],request()),/test_cloud.verifier_ownership/);
 assert.equal(docker('ps','-aq','--filter','label=cloud.backup-verifier.owner='+owner),'');
 // A lost create response with an exact discoverable token remains recoverable after expiry.
 req=request();id=await controller.create(args,req);ids.push(id);state=JSON.parse(await readFile(join(directory,'child.json'),'utf8'));
 const expired={...req,attempt:{...req.attempt,deadline:'2026-01-01T00:00:00.000Z'}};
 // Keep all immutable labels and journal fields aligned, simulating a genuine elapsed deadline.
 docker('rm','-f',id);const replayLabels={'cloud.backup-verifier.owner':owner,'cloud.backup-verifier.scope':controller.scope,'cloud.backup-verifier.token':expired.attempt.childToken,'cloud.backup-verifier.claim':expired.attempt.claimId,'cloud.backup-verifier.request':backupVerificationRequestDigest(expired),'cloud.backup-verifier.deadline':String(Date.parse(expired.attempt.deadline))};
 const interrupted=docker('create',...Object.entries(replayLabels).flatMap(([key,value])=>['--label',key+'='+value]),...args);ids.push(interrupted);
 await writeFile(join(directory,'child.json'),JSON.stringify({...state,id:null,request:expired,requestDigest:backupVerificationRequestDigest(expired),deadline:Date.parse(expired.attempt.deadline)}),{mode:0o600});
 const duplicate=docker('create',...Object.entries({...replayLabels,'cloud.backup-verifier.claim':'foreign-claim'}).flatMap(([key,value])=>['--label',key+'='+value]),...args);ids.push(duplicate);
 await assert.rejects(openVerifierController({directory,owner,image}),/test_cloud.verifier_ownership/);assert.equal(JSON.parse(docker('inspect',interrupted))[0].State.Status,'created');assert.equal(JSON.parse(docker('inspect',duplicate))[0].State.Status,'created');docker('rm','-f',duplicate);
 const same=docker('create',...Object.entries(replayLabels).flatMap(([key,value])=>['--label',key+'='+value]),...args);ids.push(same);
 await assert.rejects(openVerifierController({directory,owner,image}),/test_cloud.verifier_ownership/);assert.equal(JSON.parse(docker('inspect',interrupted))[0].State.Status,'created');assert.equal(JSON.parse(docker('inspect',same))[0].State.Status,'created');docker('rm','-f',same);
 await openVerifierController({directory,owner,image});assert.throws(()=>docker('inspect',interrupted));
 // No discoverable child does not settle an unknown daemon outcome.
 await writeFile(join(directory,'child.json'),JSON.stringify({...state,id:null,request:expired,requestDigest:backupVerificationRequestDigest(expired),deadline:Date.parse(expired.attempt.deadline)}),{mode:0o600});
 await assert.rejects(openVerifierController({directory,owner,image}),/test_cloud.verifier_ownership/);await rm(join(directory,'child.json'));
 // A mismatched journal cannot authorise deleting a real exact-token child.
 req=request();id=await controller.create(args,req);ids.push(id);state=JSON.parse(await readFile(join(directory,'child.json'),'utf8'));
 await writeFile(join(directory,'child.json'),JSON.stringify({...state,token:'foreign'}),{mode:0o600});await assert.rejects(controller.remove(id,req),/test_cloud.verifier_ownership/);assert.equal(JSON.parse(docker('inspect',id))[0].State.Status,'created');
 await writeFile(join(directory,'child.json'),JSON.stringify(state),{mode:0o600});await controller.remove(id,req);
 req=request();id=await controller.create(args,req);ids.push(id);
 await rename(join(directory,'child.json'),join(directory,'saved-child.json'));await symlink('saved-child.json',join(directory,'child.json'));
 await assert.rejects(controller.remove(id,req),/test_cloud.verifier_ownership/);assert.equal(JSON.parse(docker('inspect',id))[0].State.Status,'created');
 await rm(join(directory,'child.json'));await rename(join(directory,'saved-child.json'),join(directory,'child.json'));
 await chmod(join(directory,'child.json'),0o644);await assert.rejects(controller.remove(id,req),/test_cloud.verifier_ownership/);assert.equal(JSON.parse(docker('inspect',id))[0].State.Status,'created');
 await chmod(join(directory,'child.json'),0o600);
 const canonical=await readFile(join(directory,'child.json'),'utf8');
 for(const corrupt of [canonical+' '.repeat(131073),canonical.replace('"token":','"token":"foreign","token":'),JSON.stringify({...JSON.parse(canonical),unexpected:'field'})]){
  await writeFile(join(directory,'child.json'),corrupt,{mode:0o600});await assert.rejects(controller.remove(id,req),/test_cloud.verifier_ownership/);assert.equal(JSON.parse(docker('inspect',id))[0].State.Status,'created');
 }
 await writeFile(join(directory,'child.json'),canonical,{mode:0o600});await controller.remove(id,req);
 const bin=join(directory,'missing-bin'),removed=join(directory,'removed-id'),realDocker=dockerPath(),oldPath=process.env.PATH;await mkdir(bin,{mode:0o700});
 await writeFile(join(bin,'docker'),`#!${process.execPath}\nconst cp=require('node:child_process'),fs=require('node:fs'),args=process.argv.slice(2);if(args[0]==='inspect'&&/^[a-f0-9]{64}$/.test(args[1])){cp.execFileSync(${JSON.stringify(realDocker)},['rm','-f',args[1]]);fs.writeFileSync(${JSON.stringify(removed)},args[1]);}const r=cp.spawnSync(${JSON.stringify(realDocker)},args,{stdio:'inherit'});process.exit(r.status??1);`,{mode:0o700});
 process.env.PATH=bin+':'+oldPath;
 try{await assert.rejects(controller.create(args,request()),/test_cloud.verifier_ownership/);assert.match(await readFile(removed,'utf8'),/^[a-f0-9]{64}$/);assert.equal(JSON.parse(await readFile(join(directory,'child.json'),'utf8')).id,null);}
 finally{process.env.PATH=oldPath;}
 const identity=await readFile(join(directory,'identity.json'),'utf8');
 try{await writeFile(join(directory,'identity.json'),'null',{mode:0o600});await assert.rejects(openVerifierController({directory,owner,image}),/test_cloud.verifier_ownership/);}
 finally{await writeFile(join(directory,'identity.json'),identity,{mode:0o600});}
});
