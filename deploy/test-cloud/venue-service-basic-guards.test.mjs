import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {promisify} from 'node:util';
const exec=promisify(execFile);

test('venue basic mail detects independent lost signup and reset admission',{timeout:150000},async()=>{
 const root=fileURLToPath(new URL('../../',import.meta.url)),scratch=await mkdtemp(join(tmpdir(),'venue-basic-guards-')),candidate=join(scratch,'candidate');
 try{
  await exec('git',['clone','--quiet','--no-hardlinks',root,candidate],{timeout:10000});
  await exec('pnpm',['install','--frozen-lockfile'],{cwd:candidate,timeout:30000});
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const run=()=>exec(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^venue basic connected keeps signup and password reset independent across transitions$','deploy/test-cloud/venue-service-basic.test.mjs'],{cwd:candidate,env,timeout:20000,maxBuffer:2*1024*1024})
   .then(r=>({code:0,output:r.stdout+r.stderr}),e=>({code:e.code,output:e.stdout+e.stderr}));
  function green(value){
   assert.equal(value.code,0,value.output);
   for(const [name,count] of [['tests',1],['pass',1],['fail',0],['cancelled',0],['skipped',0],['todo',0]])assert.match(value.output,new RegExp('# '+name+' '+count+'\\b'));
  }
  for(const c of [
   {file:'signup.ts',needle:"await this.#outbox.enqueue(client, 'verification', { email, token, expiresAt, locale });",assertion:'signup must enqueue verification independently of venue billing'},
   {file:'password-recovery.ts',needle:"if (accountId) await this.#outbox.enqueue(client, 'password_reset', { email, token, expiresAt, locale });",assertion:'both account mails must be admitted at every level'},
  ]){
   const path=join(candidate,'packages/registration/src',c.file),original=await readFile(path,'utf8');assert.equal(original.split(c.needle).length,2);
   green(await run());
   try{
    await writeFile(path,original.replace(c.needle,''));const fault=await run();
    assert.equal(fault.code,1,fault.output);assert.match(fault.output,/# tests 1\b/);assert.match(fault.output,/# fail 1\b/);
    assert.match(fault.output,/ERR_ASSERTION/);assert.ok(fault.output.includes(c.assertion),fault.output);
    assert.doesNotMatch(fault.output,/test timed out|cancelledByParent|ECONNREFUSED|ERR_MODULE_NOT_FOUND/);
   }finally{await writeFile(path,original);}
   green(await run());console.log('VENUE_BASIC_GUARD_DETECTED '+c.file);
  }
 }finally{await rm(scratch,{recursive:true,force:true});}
});
