import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {createBoundContainerWaitronVerifier} from '../src/bound-container-verifier.ts';
import {bufferObject} from '../src/object-transfer.ts';
// @ts-expect-error deployment controller is JavaScript
import {openVerifierController} from '../../../deploy/test-cloud/verifier-controller.mjs';
const image='sha256:'+'1'.repeat(64),id='2'.repeat(64),secret='private-fixture-key /private/archive';
const vector=JSON.parse(await readFile(new URL('./fixtures/verification-vector.json',import.meta.url),'utf8'));

// Losing the failed boundary or forwarding daemon output makes these controls fail.
async function fixture(fault:string,run:(f:any)=>Promise<void>){
 const directory=await mkdtemp(join(tmpdir(),'bound-cleanup-diagnostic-')),bin=join(directory,'bin'),oldPath=process.env.PATH;
 await mkdir(bin);
 const state=join(directory,'child.json'),present=join(directory,'present'),faultFile=join(directory,'fault');
 await writeFile(faultFile,'');
 await writeFile(join(bin,'docker'),`#!${process.execPath}
const fs=require('node:fs'),args=process.argv.slice(2),fault=fs.readFileSync(${JSON.stringify(faultFile)},'utf8'),id=${JSON.stringify(id)},image=${JSON.stringify(image)};
if(args[0]==='image'){console.log(JSON.stringify([{Id:image,Config:{}}]));process.exit(0);}
if(args[0]===fault){process.stderr.write(${JSON.stringify(secret)});process.exit(42);}
if(args[0]==='create'){fs.writeFileSync(${JSON.stringify(present)},'');console.log(id);}
else if(args[0]==='ps'){if(fs.existsSync(${JSON.stringify(present)}))console.log(id);}
else if(args[0]==='inspect'){
 if(!fs.existsSync(${JSON.stringify(present)})){process.stderr.write('Error: No such object: '+id);process.exit(1);}
 const s=JSON.parse(fs.readFileSync(${JSON.stringify(state)},'utf8'));
 console.log(JSON.stringify([{Id:id,Image:image,Config:{Labels:{'cloud.backup-verifier.owner':'diagnostic','cloud.backup-verifier.scope':s.request.attempt.controllerScope,'cloud.backup-verifier.token':s.token,'cloud.backup-verifier.claim':s.request.attempt.claimId,'cloud.backup-verifier.request':s.requestDigest,'cloud.backup-verifier.deadline':String(s.deadline)}}}]));
}else if(args[0]==='rm'&&fault!=='retained')fs.unlinkSync(${JSON.stringify(present)});
`,{mode:0o700});
 process.env.PATH=bin+':'+oldPath;
 try{
  const controller=await openVerifierController({directory,owner:'diagnostic',image});
  const request={...structuredClone(vector),verifierImage:'local.waitron-verifier@'+image,attempt:{...vector.attempt,controllerScope:controller.scope,childToken:randomUUID(),deadline:new Date(Date.now()+25000).toISOString()}};
  await controller.create([],request);await writeFile(faultFile,fault);
  await run({directory,controller,request,faultFile});
 }finally{process.env.PATH=oldPath;await rm(directory,{recursive:true,force:true});}
}
for(const [fault,stage] of [['ps','discover'],['inspect','inspect-owned'],['rm','remove-child']] as const)test(`cleanup diagnostic identifies refused ${fault} without private daemon output`,async()=>{
 await fixture(fault,async({controller,request,directory})=>{
  await assert.rejects(controller.remove(id,request),(error:any)=>{
   assert.equal(error.message,'test_cloud.verifier_docker');
   assert.equal(error.cause.stage,stage);assert.equal(error.cause.operation,fault);assert.equal(error.cause.code,42);
   assert.equal(error.cause.signal,null);assert.equal(error.cause.killed,false);
   assert(Number.isSafeInteger(error.cause.elapsedMs));assert(error.cause.elapsedMs>=0);
   assert(!JSON.stringify(error.cause).includes(secret));return true;
  });
  assert.equal(JSON.parse(await readFile(join(directory,'child.json'),'utf8')).id,id);
 });
});
test('cleanup diagnostic distinguishes a surviving exact child from a Docker command refusal',async()=>{
 await fixture('retained',async({controller,request})=>{
  await assert.rejects(controller.remove(id,request),(error:any)=>{
   assert.equal(error.message,'test_cloud.verifier_ownership');assert.deepEqual(error.cause,{stage:'confirm-absent'});return true;
  });
 });
});
test('bound verifier retains the cleanup boundary and safe command details while refusing a verdict',async()=>{
 await fixture('rm',async({controller,request})=>{
  // Refuse active inspection before archive input; cleanup still uses the real controller.
  const verify=await createBoundContainerWaitronVerifier({image,owner:'diagnostic',controller:{...controller,async reclaim(){},async create(){return id;}}});
  let opened=0;
  await assert.rejects(verify({...bufferObject(Buffer.from([0])),open(){opened++;throw Error(secret);}},{version:1,reference:'key-1',secret:'private-fixture-key'},request,new AbortController().signal),(error:any)=>{
   assert.equal(error.message,'backup.verifier_cleanup');
   assert.equal(error.cause.stage,'controller-remove');assert.equal(error.cause.reason,'test_cloud.verifier_docker');
   assert.equal(error.cause.controllerStage,'remove-child');assert.equal(error.cause.operation,'rm');assert.equal(error.cause.code,42);
   assert(!JSON.stringify(error.cause).includes(secret));return true;
  });assert.equal(opened,0);
 });
});
for(const mode of ['unknown','forged'])test(`bound cleanup diagnostic omits ${mode} controller details and still refuses publication`,async()=>{
 await fixture('',async({controller,request})=>{
  const privateValue=(value:string)=>({private:secret,toString(){return value;}});
  const error=mode==='unknown'?Error(secret,{cause:{stage:secret,operation:secret,code:secret}}):Error('test_cloud.verifier_docker',{cause:{stage:privateValue('remove-child'),operation:privateValue('rm'),code:secret,signal:privateValue('SIGTERM'),killed:secret,elapsedMs:secret}});
  const verify=await createBoundContainerWaitronVerifier({image,owner:'diagnostic',controller:{...controller,async reclaim(){},async create(){return id;},async remove(){throw error;}}});
  await assert.rejects(verify(bufferObject(Buffer.from([0])),{version:1,reference:'key-1',secret:'private-fixture-key'},request,new AbortController().signal),(refusal:any)=>{
   assert.equal(refusal.message,'backup.verifier_cleanup');
   assert.deepEqual(refusal.cause,mode==='unknown'?{stage:'controller-remove'}:{stage:'controller-remove',reason:'test_cloud.verifier_docker'});
   assert(!JSON.stringify(refusal.cause).includes(secret));return true;
  });
 });
});
