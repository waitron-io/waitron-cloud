import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {promisify} from 'node:util';
const exec=promisify(execFile);

// Each removed boundary must fail its real behavior cases, with both original and restored controls passing.
test('managed stream machine guards detect independent omissions',{timeout:240000},async()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url)),scratch=await mkdtemp(join(tmpdir(),'venue-stream-machine-guards-')),candidate=join(scratch,'candidate');
 try{
  await exec('git',['clone','--quiet','--no-hardlinks',root,candidate],{timeout:10000});
  await exec('pnpm',['install','--frozen-lockfile'],{cwd:candidate,timeout:20000});
  const path=join(candidate,'packages/account-http/src/managed-streams.ts'),original=await readFile(path,'utf8');
  const cases=[
   {name:'authentication before metadata and policy',needle:'  await this.authenticate(action,envelope);',replacement:'',
    pattern:'venue stream machine backup-stream-(configure|observe) authenticates before (metadata|registered|unavailable)',count:6,expected:'invalid_proof'},
   {name:'current machine proof after provider wait',needle:'const now=Date.now(),claims=verifyMachine(envelope,row.public_key,this.#origin,action,now);',replacement:'const now=Date.now(),claims=readMachineClaims(envelope);',
    pattern:'venue stream HTTP backup-stream-(configure|observe) provider wait rejects proof-expiry',count:2,expected:'200 !== 401'},
   {name:'current lease after provider wait',needle:'const lease=verifyLease(encoded,this.#trusted,this.#origin,now);',replacement:'const lease=verifyLease(encoded,this.#trusted,this.#origin,now-60000);',
    pattern:'venue stream HTTP backup-stream-(configure|observe) provider wait rejects lease-expiry',count:2,expected:'200 !== 401'},
  ];
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  async function run(c:typeof cases[number]){
   return exec(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^'+c.pattern+'$','packages/account-http/test/venue-service-streams.test.ts'],{cwd:candidate,env,timeout:45000,maxBuffer:2*1024*1024})
    .then(r=>({code:0,output:r.stdout+r.stderr}),e=>({code:e.code,output:e.stdout+e.stderr}));
  }
  for(const c of cases){
   assert.equal(original.split(c.needle).length,2,c.name+' must target one guard');
   const before=await run(c);assert.equal(before.code,0,before.output);assert.match(before.output,new RegExp('# pass '+c.count+'\\b'));assert.match(before.output,/# fail 0\b/);
   try{
    await writeFile(path,original.replace(c.needle,c.replacement));
    const omitted=await run(c);assert.equal(omitted.code,1,omitted.output);assert.match(omitted.output,new RegExp('# fail '+c.count+'\\b'));assert.ok(omitted.output.includes(c.expected),omitted.output);
   }finally{await writeFile(path,original);}
   const restored=await run(c);assert.equal(restored.code,0,restored.output);assert.match(restored.output,new RegExp('# pass '+c.count+'\\b'));assert.match(restored.output,/# fail 0\b/);
   console.log('VENUE_STREAM_MACHINE_GUARD_DETECTED '+c.name);
  }
 }finally{await rm(scratch,{recursive:true,force:true});}
});
