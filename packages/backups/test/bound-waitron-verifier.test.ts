import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,readdir,realpath,rm,writeFile,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import * as factory from '../src/waitron-verifier.ts';
import {bufferObject} from '../src/object-transfer.ts';
import {backupVerificationRequestDigest,backupVerificationTargetDigests,type BackupVerificationRequest} from '../src/verification-protocol.ts';
const vector=JSON.parse(await readFile(new URL('./fixtures/verification-vector.json',import.meta.url),'utf8'));
const key={version:1,reference:'key-1',secret:'private-fixture-key'};
function request():BackupVerificationRequest{return {...structuredClone(vector),attempt:{...vector.attempt,deadline:new Date(Date.now()+25000).toISOString()}};}
function output(req:BackupVerificationRequest){return {protocol:req.protocol,requestDigest:backupVerificationRequestDigest(req),attemptToken:req.attempt.childToken,measuredArchive:{sha256:req.archive.sha256,bytes:req.archive.bytes},targetDigest:req.target.digest,policyDigest:req.target.policyDigest,modules:req.target.modules.map(m=>({name:m.name,semanticsVersion:m.semanticsVersion,status:'passed',checks:[{code:'data',status:'passed'}]})),status:'passed',reason:'none',activation:'not_attempted'};}
async function fixture(req:BackupVerificationRequest,body='return result;'){
 const root=await realpath(await mkdtemp(join(tmpdir(),'cloud-bound-native-'))),checkout=join(root,'waitron'),scratch=join(root,'scratch'),dist=join(checkout,'apps/server/dist');
 await mkdir(join(dist,'drizzle/core/meta'),{recursive:true});await mkdir(scratch,{mode:0o700});
 await writeFile(join(dist,'drizzle/core/meta/_journal.json'),'{}');
 await writeFile(join(dist,'package.json'),'{"type":"module"}');
 await writeFile(join(dist,'backup-verification.js'),`import assert from 'node:assert/strict';import {readFile,writeFile,mkdir,chmod} from 'node:fs/promises';export const BACKUP_VERIFICATION_MODULES=[{name:'fixture-only'}];export function currentBackupVerificationTarget(){return ${JSON.stringify(req.target)}};export async function verifyBackupArtifact(request,deps){const result=${JSON.stringify(output(req))};assert.deepEqual(request,${JSON.stringify(req)});assert.deepEqual(deps.recoveryKey,${JSON.stringify(key)});assert.equal(deps.migrationsRoot,${JSON.stringify(join(dist,'drizzle'))});assert.equal(deps.modules,BACKUP_VERIFICATION_MODULES);assert.deepEqual(deps.runtime,request.target.runtime);assert.equal(typeof deps.now,'function');assert.equal(deps.signal.aborted,false);assert.deepEqual([...await readFile(deps.artifactPath)],[0,255,1,2]);await writeFile(deps.scratchRoot+'/executed','yes');${body}}`);
 return {root,checkout,scratch,dist,async close(){await rm(root,{recursive:true,force:true});}};
}
const create=async(checkout:string,options:object={})=>{
 assert.equal(typeof factory.createBoundWaitronVerifier,'function','bound compiled-bundle factory is missing');
 return factory.createBoundWaitronVerifier(checkout,options);
};
test('bound native verifier calls only the compiled public bundle and cleans the archive before returning',async()=>{
 const req=request(),f=await fixture(req);
 try{
  const verify=await create(f.checkout,{temporaryRoot:f.scratch});
  await assert.doesNotReject(async()=>{assert.deepEqual(await verify(bufferObject(Buffer.from([0,255,1,2])),key,req,new AbortController().signal),output(req));});
  assert.deepEqual(await readdir(f.scratch),[]);
 }finally{await f.close();}
});
test('bound native verifier refuses absent compiled assets without a source fallback',async()=>{
 const req=request(),f=await fixture(req);
 try{await rm(join(f.dist,'backup-verification.js'));await mkdir(join(f.checkout,'apps/server/src'));await writeFile(join(f.checkout,'apps/server/src/restore.ts'),'throw Error("source must not run")');await assert.rejects(create(f.checkout),/^Error: backup.verifier_configuration$/);}
 finally{await f.close();}
});
test('bound native verifier refuses a different actual target and missing migration journal',async()=>{
 for(const fault of ['target','journal']){
  const req=request(),f=await fixture(req);
  try{
   if(fault==='target'){const path=join(f.dist,'backup-verification.js'),actual=structuredClone(req.target);actual.modules[0]!.packageVersion='1.2.4';Object.assign(actual,backupVerificationTargetDigests(actual));const before='function currentBackupVerificationTarget(){return '+JSON.stringify(req.target)+'}';await writeFile(path,(await readFile(path,'utf8')).replace(before,'function currentBackupVerificationTarget(){return '+JSON.stringify(actual)+'}'));}
   else await rm(join(f.dist,'drizzle/core/meta/_journal.json'));
   const verify=await create(f.checkout,{temporaryRoot:f.scratch});
   await assert.rejects(verify(bufferObject(Buffer.from([0,255,1,2])),key,req,new AbortController().signal),/backup.verifier_(?:configuration|failed)/);
   assert.deepEqual(await readdir(f.scratch),[]);
  }finally{await f.close();}
 }
});
test('bound native verifier refuses wrong or missing key binding before opening source',async()=>{
 const req=request(),f=await fixture(req);let opened=0;
 try{const verify=await create(f.checkout,{temporaryRoot:f.scratch});for(const bad of [{...key,version:2},{...key,reference:'another-key'},{...key,secret:''},{...key,secret:'x'.repeat(4097)}])await assert.rejects(verify({receipt:{digest:'',size:1},open(){opened++;throw Error('source must stay closed')},async dispose(){}},bad,req,new AbortController().signal),/^Error: backup.verifier_input$/);assert.equal(opened,0);assert.deepEqual(await readdir(f.scratch),[]);}
 finally{await f.close();}
});
test('native zero exit with no result, forged coverage or private crash cannot count as verification',async()=>{
 for(const body of ['process.exit(0);','return {...result,modules:[]};','throw Error("private-fixture-key");']){
  const req=request(),f=await fixture(req,body);
  try{const verify=await create(f.checkout,{temporaryRoot:f.scratch});await assert.rejects(verify(bufferObject(Buffer.from([0,255,1,2])),key,req,new AbortController().signal),/^(?:Error: backup.verifier_output|Error: backup.verifier_failed)$/);assert.deepEqual(await readdir(f.scratch),[]);}
  finally{await f.close();}
 }
});
test('cancelled bound native verifier reaps its process and removes scratch',async()=>{
 const req=request(),f=await fixture(req,'await new Promise(()=>setInterval(()=>{},1000));'),stop=new AbortController();
 try{const verify=await create(f.checkout,{temporaryRoot:f.scratch}),pending=verify(bufferObject(Buffer.from([0,255,1,2])),key,req,stop.signal);const checked=assert.rejects(pending,/backup.verifier_cancelled/);setTimeout(()=>stop.abort(),150);await checked;assert.deepEqual(await readdir(f.scratch),[]);}
 finally{await f.close();}
});
test('native source-open failures are bounded and never expose private diagnostics',async()=>{
 const req=request(),f=await fixture(req);
 try{const verify=await create(f.checkout,{temporaryRoot:f.scratch});await assert.rejects(verify({receipt:{digest:'',size:4},open(){throw Error('private-fixture-key')},async dispose(){}},key,req,new AbortController().signal),/^Error: backup.verifier_input$/);assert.deepEqual(await readdir(f.scratch),[]);}
 finally{await f.close();}
});

test('uncertain native cleanup overrides both passed and invalid output',async()=>{
 for(const status of ['passed','invalid']){
  const req=request(),body="await mkdir(deps.scratchRoot+'/blocked');await writeFile(deps.scratchRoot+'/blocked/retained','private');await chmod(deps.scratchRoot+'/blocked',0);return "+(status==='passed'?'result':"{...result,status:'invalid',reason:'archive_invalid',modules:[]}")+";",f=await fixture(req,body);
  try{const verify=await create(f.checkout,{temporaryRoot:f.scratch});await assert.rejects(verify(bufferObject(Buffer.from([0,255,1,2])),key,req,new AbortController().signal),/^Error: backup.verifier_cleanup$/);const dirs=await readdir(f.scratch);assert.equal(dirs.length,1);await chmod(join(f.scratch,dirs[0]!,'blocked'),0o700);}
  finally{for(const name of await readdir(f.scratch)){await chmod(join(f.scratch,name,'blocked'),0o700).catch(()=>{});}await f.close();}
 }
});
test('expired or pre-cancelled native attempts do not open an archive or create scratch',async()=>{
 const req=request(),f=await fixture(req);let opened=0;
 const source={receipt:{digest:'',size:4},open(){opened++;throw Error('must not open')},async dispose(){}};
 try{const verify=await create(f.checkout,{temporaryRoot:f.scratch});await assert.rejects(verify(source,key,{...req,attempt:{...req.attempt,deadline:'2026-01-01T00:00:00.000Z'}},new AbortController().signal),/^Error: backup.verifier_timeout$/);await assert.rejects(verify(source,key,req,AbortSignal.abort()),/^Error: backup.verifier_cancelled$/);assert.equal(opened,0);assert.deepEqual(await readdir(f.scratch),[]);}
 finally{await f.close();}
});
