import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {promisify} from 'node:util';
const exec=promisify(execFile);

test('venue translation detects queued and interrupted production selection guard omissions',{timeout:150000},async()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url)),scratch=await mkdtemp(join(tmpdir(),'venue-queue-guards-')),candidate=join(scratch,'candidate');
 try{
  await exec('git',['clone','--quiet','--no-hardlinks',root,candidate],{timeout:10000});
  await exec('pnpm',['install','--frozen-lockfile'],{cwd:candidate,timeout:20000});
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const path=join(candidate,'packages/translation/src/worker.ts'),original=await readFile(path,'utf8');
  const cases=[
   {state:'queued',needle:"AND created_at>clock_timestamp()-interval '24 hours'${environment}\n",replacement:"AND created_at>clock_timestamp()-interval '24 hours'\n"},
   {state:'running',needle:"AND created_at>clock_timestamp()-interval '24 hours'${environment})",replacement:"AND created_at>clock_timestamp()-interval '24 hours')"},
  ];
  async function run(state:string){
   const pattern=`^venue translation skips an earlier production ${state} job and completes eligible test work$`;
   return exec(process.execPath,['--test','--test-reporter=tap','--test-name-pattern='+pattern,'test/venue-service-queue.test.ts'],
    {cwd:join(candidate,'packages/translation'),env,timeout:25000,maxBuffer:2*1024*1024})
    .then(r=>({code:0,output:r.stdout+r.stderr}),e=>({code:e.code,output:e.stdout+e.stderr}));
  }
  function green(value:Awaited<ReturnType<typeof run>>){
   assert.equal(value.code,0,value.output);
   for(const [kind,count] of [['tests',1],['pass',1],['fail',0],['cancelled',0],['skipped',0],['todo',0]])
    assert.match(value.output,new RegExp('# '+kind+' '+count+'\\b'));
  }
  for(const c of cases){
   const occurrences=original.split(c.needle).length-1;
   assert.equal(occurrences,1,c.state+' must target one selection guard');green(await run(c.state));
   try{
    await writeFile(path,original.replace(c.needle,c.replacement));const omitted=await run(c.state);
    assert.equal(omitted.code,1,omitted.output);assert.match(omitted.output,/# tests 1\b/);assert.match(omitted.output,/# fail 1\b/);
    assert.match(omitted.output,/error: 'permission_denied'/);assert.match(omitted.output,new RegExp('production '+c.state+' job'));
   }finally{await writeFile(path,original);}
   green(await run(c.state));console.log('VENUE_TRANSLATION_QUEUE_GUARD_DETECTED '+c.state);
  }
 }finally{await rm(scratch,{recursive:true,force:true});}
});
