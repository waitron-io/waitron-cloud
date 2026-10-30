import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {promisify} from 'node:util';
const exec=promisify(execFile);

// A successful API refusal cannot substitute for the provider rejecting an already-issued key.
test('venue storage guards detect independent physical writer omissions',{timeout:240000},async()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url)),scratch=await mkdtemp(join(tmpdir(),'venue-storage-guards-')),candidate=join(scratch,'candidate');
 try{
  await exec('git',['clone','--quiet','--no-hardlinks',root,candidate],{timeout:10000});
  await exec('pnpm',['install','--frozen-lockfile'],{cwd:candidate,timeout:20000});
  const cases=[
   {name:'publication mode identity',path:'deploy/test-cloud/storage-authority.mjs',needle:'let allowed=item.policyMode===undefined||item.policyMode===policyMode;',replacement:'let allowed=true;',
    pattern:'venue storage separates legacy revision one from venue generation one',expected:'Missing expected rejection'},
   {name:'provision mode identity',path:'deploy/test-cloud/storage-authority.mjs',needle:'item.policyRevision!==revision||state.version===2&&item.policyMode!==policyMode',replacement:'item.policyRevision!==revision',
    pattern:'venue storage separates legacy revision one from venue generation one',expected:'a retained legacy instance must rotate'},
   {name:'writer generation on restart',path:'deploy/test-cloud/service-runtime.mjs',needle:'writerMode===mode&&await policy(id)===revision',replacement:'writerMode===mode&&(await policy(id),true)',
    pattern:'venue storage withdraws stale generations across downgrade round trips and restart',expected:'Missing expected rejection'},
   {name:'generation after provider wait',path:'deploy/test-cloud/service-runtime.mjs',needle:"if(await policy(input.venueId)!==revision)throw Error('permission_denied');",replacement:'',
    pattern:'venue storage rejects a generation change during provider publication',expected:'Missing expected rejection'},
   {name:'reader generation after file lease',path:'deploy/test-cloud/service-runtime.mjs',needle:"if(revision!==await policy(input.venueId))throw Error('permission_denied');",replacement:'',
    pattern:'venue storage reader refuses a permission round trip while waiting for its file lease',expected:'Missing expected rejection'},
   {name:'physical writer generation after trial gaps',path:'deploy/test-cloud/service-runtime.mjs',needle:'writerMode===mode&&await policy(id)===revision',replacement:'writerMode===mode&&(await policy(id),true)',
    pattern:'venue storage withdraws the physical writer across (late-extension|end-then-hosted|future-gap)',expected:'Missing expected rejection',count:3},
  ];
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  async function run(pattern:string){
   return exec(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^'+pattern+'$','deploy/test-cloud/venue-service-storage.test.mjs'],{cwd:candidate,env,timeout:45000,maxBuffer:2*1024*1024})
    .then(r=>({code:0,output:r.stdout+r.stderr}),e=>({code:e.code,output:e.stdout+e.stderr}));
  }
  for(const c of cases){
   const path=join(candidate,c.path),original=await readFile(path,'utf8');assert.equal(original.split(c.needle).length,2,c.name+' must target one guard');
   const count=c.count??1;
   const before=await run(c.pattern);assert.equal(before.code,0,before.output);assert.match(before.output,new RegExp('# pass '+count+'\\b'));assert.match(before.output,/# fail 0\b/);
   try{
    await writeFile(path,original.replace(c.needle,c.replacement));
    const omitted=await run(c.pattern);assert.equal(omitted.code,1,omitted.output);assert.match(omitted.output,new RegExp('# fail '+count+'\\b'));assert.match(omitted.output,/AssertionError|ERR_ASSERTION/);assert.ok(omitted.output.includes(c.expected),omitted.output);
   }finally{await writeFile(path,original);}
   const restored=await run(c.pattern);assert.equal(restored.code,0,restored.output);assert.match(restored.output,new RegExp('# pass '+count+'\\b'));assert.match(restored.output,/# fail 0\b/);
   console.log('VENUE_STORAGE_GUARD_DETECTED '+c.name);
  }
 }finally{await rm(scratch,{recursive:true,force:true});}
});
