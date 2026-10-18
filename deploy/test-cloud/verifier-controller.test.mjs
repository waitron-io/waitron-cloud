import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
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
