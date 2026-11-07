import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {promisify} from 'node:util';
const exec=promisify(execFile);

// Every removed guard must expose its real database regression before exact restoration.
test('direct remote admission guards detect independent wait omissions',{timeout:180000},async()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url)),scratch=await mkdtemp(join(tmpdir(),'venue-direct-wait-guards-')),candidate=join(scratch,'candidate');
 try{
  await exec('git',['clone','--quiet','--no-hardlinks',root,candidate],{timeout:10000});
  await exec('pnpm',['install','--frozen-lockfile'],{cwd:candidate,timeout:20000});
  const path=join(candidate,'packages/remote-access/src/plan-permissions.ts'),original=await readFile(path,'utf8');
  const cases=[
   {name:'original installation venue',needle:'||current.venue_id!==row.venue_id',replacement:'',pattern:'venue direct provision rejects changed venue after authority wait'},
   {name:'current installation key',needle:'||current.public_key!==key',replacement:'',pattern:'venue direct certificate rejects changed key after authority wait'},
   {name:'setup after installation lock',needle:'SELECT venue_id,public_key FROM installations WHERE id=$1 FOR UPDATE',replacement:'SELECT venue_id,public_key FROM installations WHERE id=$1',pattern:'venue direct move rereads setup after installation wait'},
  ];
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  async function run(pattern:string){
   return exec(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^'+pattern+'$','test/venue-service-direct-waits.test.ts'],{cwd:join(candidate,'packages/remote-access'),env,timeout:25000,maxBuffer:2*1024*1024})
    .then(r=>({code:0,output:r.stdout+r.stderr}),e=>({code:e.code,output:e.stdout+e.stderr}));
  }
  for(const c of cases){
   assert.equal(original.split(c.needle).length,2,c.name+' must target one guard');
   const before=await run(c.pattern);assert.equal(before.code,0,before.output);assert.match(before.output,/# pass 1\b/);assert.match(before.output,/# fail 0\b/);
   try{
    await writeFile(path,original.replace(c.needle,c.replacement));const omitted=await run(c.pattern);
    assert.equal(omitted.code,1,omitted.output);assert.match(omitted.output,/# fail 1\b/);assert.match(omitted.output,/AssertionError|ERR_ASSERTION/);assert.match(omitted.output,/Missing expected rejection/);
   }finally{await writeFile(path,original);}
   const restored=await run(c.pattern);assert.equal(restored.code,0,restored.output);assert.match(restored.output,/# pass 1\b/);assert.match(restored.output,/# fail 0\b/);
   console.log('VENUE_DIRECT_WAIT_GUARD_DETECTED '+c.name);
  }
 }finally{await rm(scratch,{recursive:true,force:true});}
});
