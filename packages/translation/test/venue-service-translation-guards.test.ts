import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {promisify} from 'node:util';
const exec=promisify(execFile);

test('venue translation detects admission callback and generation guard omissions',{timeout:150000},async()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url)),scratch=await mkdtemp(join(tmpdir(),'venue-translation-guards-')),candidate=join(scratch,'candidate');
 try{
  await exec('git',['clone','--quiet','--no-hardlinks',root,candidate],{timeout:10000});
  await exec('pnpm',['install','--frozen-lockfile'],{cwd:candidate,timeout:20000});
  const cases=[
   {name:'new job admission',file:'machine.ts',needle:'!allowed||',pattern:'venue translation denies a unenrolled venue despite ready setup and consent'},
   {name:'provider permission callback',file:'worker.ts',needle:"   ...(this.#planMode==='test-venue-levels'?{stillPermitted:()=>this.#permitted(job,leaseId,revision!)}:{}),",pattern:'venue translation success after downgrade starts no review or retry'},
   {name:'admitted permission generation',file:'worker.ts',needle:'   if(permission.revision!==revision)return false;',pattern:'venue translation success after round trip starts no review or retry'},
  ];
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  async function run(pattern:string){
   return exec(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^'+pattern+'$','test/venue-service-translation.test.ts'],{cwd:join(candidate,'packages/translation'),env,timeout:25000,maxBuffer:2*1024*1024})
    .then(r=>({code:0,output:r.stdout+r.stderr}),e=>({code:e.code,output:e.stdout+e.stderr}));
  }
  function green(value:Awaited<ReturnType<typeof run>>){
   assert.equal(value.code,0,value.output);assert.match(value.output,/# tests 1\b/);assert.match(value.output,/# pass 1\b/);assert.match(value.output,/# fail 0\b/);
   for(const count of ['cancelled','skipped','todo'])assert.match(value.output,new RegExp('# '+count+' 0\\b'));
  }
  for(const c of cases){
   const path=join(candidate,'packages/translation/src',c.file),original=await readFile(path,'utf8');
   assert.equal(original.split(c.needle).length,2,c.name+' must target one guard');green(await run(c.pattern));
   try{
    await writeFile(path,original.replace(c.needle,''));const omitted=await run(c.pattern);
    assert.equal(omitted.code,1,omitted.output);assert.match(omitted.output,/# tests 1\b/);assert.match(omitted.output,/# fail 1\b/);assert.match(omitted.output,/AssertionError|ERR_ASSERTION/);
   }finally{await writeFile(path,original);}
   green(await run(c.pattern));console.log('VENUE_TRANSLATION_GUARD_DETECTED '+c.name);
  }
 }finally{await rm(scratch,{recursive:true,force:true});}
});
