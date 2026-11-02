import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';

test('a failed bound cleanup remains red while its next case and image cleanup succeed',{timeout:210000},()=>{
 const source=new URL('./bound-container-verifier.test.ts',import.meta.url),original=readFileSync(source,'utf8');
 const control=new URL('./.bound-cascade-'+randomUUID()+'.ts',import.meta.url),scratch=mkdtempSync(join(tmpdir(),'bound-cascade-')),record=join(scratch,'owned.json');
 const target='const {verify,req}=await setup(),out=await verify(source(4)';
 const replacement=`const base=await setup(),{req}=base,verify=await factory.createBoundContainerWaitronVerifier({image,owner,controller:{...base.controller,async remove(id:string,request:BackupVerificationRequest){
  await writeFile(${JSON.stringify(record)},JSON.stringify({id,image,tag,labels:{'cloud.backup-verifier.owner':owner,'cloud.backup-verifier.scope':request.attempt.controllerScope,'cloud.backup-verifier.token':request.attempt.childToken,'cloud.backup-verifier.claim':request.attempt.claimId,'cloud.backup-verifier.request':backupVerificationRequestDigest(request),'cloud.backup-verifier.deadline':String(Date.parse(request.attempt.deadline))}}));
  throw Error('injected cleanup refusal');
 }}}),out=await verify(source(4)`;
 const docker=(...args:string[])=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:10000}).trim();
 try{
  assert(original.includes(target));writeFileSync(control,original.replace(target,replacement));
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const child=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-timeout=30000','--test-name-pattern=invalid archive is a bounded verdict|wrong key, scope',control.pathname],{env,encoding:'utf8',timeout:180000,maxBuffer:1048576});
  assert.equal(child.error,undefined,child.stderr);assert.equal(child.status,1,child.stdout+child.stderr);
  assert.match(child.stdout,/# tests 2\b/);assert.match(child.stdout,/# fail 1\b/);assert.match(child.stdout,/# pass 1\b/);
  assert.match(child.stdout,/backup\.verifier_cleanup/);assert.match(child.stdout,/ok 2 - wrong key, scope/);
  const saved=JSON.parse(readFileSync(record,'utf8'));
  assert.throws(()=>docker('inspect',saved.id));assert.throws(()=>docker('image','inspect',saved.tag));
 }finally{
  // A broken rescue must fail the test without leaving the control's own child behind.
  try{
   let saved;try{saved=JSON.parse(readFileSync(record,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   if(saved){
    let info;try{info=JSON.parse(docker('inspect',saved.id))[0];}
    catch(error){const missing=error as {status?:number;signal?:string;stderr?:string};if(missing.status!==1||missing.signal||String(missing.stderr).trim().toLowerCase()!=='error: no such object: '+saved.id)throw error;}
    if(info){assert.equal(info.Id,saved.id);assert.equal(info.Image,saved.image);for(const [key,value] of Object.entries(saved.labels))assert.equal(info.Config.Labels[key],value);docker('rm','-f',saved.id);}
    const tags=docker('image','ls','--format','{{.Repository}}:{{.Tag}}',saved.tag);
    if(tags){assert.equal(tags,saved.tag);docker('image','rm',saved.tag);}
   }
  }finally{rmSync(control,{force:true});rmSync(scratch,{recursive:true,force:true});}
 }
});
