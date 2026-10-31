import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {promisify} from 'node:util';
const exec=promisify(execFile);

// Every omitted guard must change an observable decision in the new venue mode.
test('venue report authority detects six independent proof and binding omissions',{timeout:180000},async()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url)),scratch=await mkdtemp(join(tmpdir(),'venue-report-guards-')),candidate=join(scratch,'candidate');
 try{
  await exec('git',['clone','--quiet','--no-hardlinks',root,candidate],{timeout:10000});
  await exec('pnpm',['install','--frozen-lockfile'],{cwd:candidate,timeout:20000});
  const observations='packages/remote-access/src/forward-observations.ts',proof='packages/remote-access/src/forward-report.ts';
  const cases=[
   {name:'cryptographic signature',file:proof,needle:'||!verify(null,bytes,key,signature)',pattern:'venue report authority rejects signature without changing observations'},
   {name:'mapped environment',file:observations,needle:'cell.environment!==mapping.environment||',pattern:'venue report authority rejects environment without changing observations'},
   {name:'route revision',file:observations,needle:'Number(route.revision)===observation.revision&&',pattern:'venue report authority rejects revision without changing observations'},
   {name:'route binding',file:observations,needle:'routeBinding(route as GatewayRoute)===observation.routeBinding',replacement:'true',pattern:'venue report authority rejects binding without changing observations'},
   {name:'current reporter generation',file:observations,needle:'Number(reporter.generation)===observation.generation',replacement:'true',pattern:'venue report authority hides stale generation before pruning'},
   {name:'current venue eligibility',file:observations,needle:"if(mode==='test-venue-levels'&&!eligible?.has(id))return;",pattern:'venue report authority accepts only the still eligible sibling in one signed batch'},
  ];
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  async function run(pattern:string){
   return exec(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^'+pattern+'$','test/venue-service-report-authority.test.ts'],{cwd:join(candidate,'packages/remote-access'),env,timeout:25000,maxBuffer:2*1024*1024})
    .then(r=>({code:0,output:r.stdout+r.stderr}),e=>({code:e.code,output:e.stdout+e.stderr}));
  }
  for(const c of cases){
   const path=join(candidate,c.file),original=await readFile(path,'utf8');
   assert.equal(original.split(c.needle).length,2,c.name+' must target one guard');
   const before=await run(c.pattern);assert.equal(before.code,0,before.output);assert.match(before.output,/# pass 1\b/);assert.match(before.output,/# fail 0\b/);
   try{
    await writeFile(path,original.replace(c.needle,c.replacement??''));const omitted=await run(c.pattern);
    assert.equal(omitted.code,1,omitted.output);assert.match(omitted.output,/# fail 1\b/);assert.match(omitted.output,/AssertionError|ERR_ASSERTION/);
   }finally{await writeFile(path,original);}
   const restored=await run(c.pattern);assert.equal(restored.code,0,restored.output);assert.match(restored.output,/# pass 1\b/);assert.match(restored.output,/# fail 0\b/);
   console.log('VENUE_REPORT_AUTHORITY_GUARD_DETECTED '+c.name);
  }
 }finally{await rm(scratch,{recursive:true,force:true});}
});
