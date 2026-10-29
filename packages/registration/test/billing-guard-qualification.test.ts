import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {promisify} from 'node:util';
const exec=promisify(execFile);

// Run the real refusal cases with one guard removed at a time; setup errors earn no detection.
test('billing guards detect omissions against real PostgreSQL',async()=>{
 const root=new URL('../../../',import.meta.url).pathname;
 const scratch=await mkdtemp(join(tmpdir(),'billing-guards-')),candidate=join(scratch,'candidate');
 try{
  await exec('git',['clone','--quiet','--no-hardlinks',root,candidate],{timeout:10000});
  await exec('pnpm',['install','--frozen-lockfile'],{cwd:candidate,timeout:20000});
  const cases=[
   {name:'composite ownership',file:'packages/registration/migrations/045_billing_store.sql',
    needle:' FOREIGN KEY(venue_id,organisation_id,legal_business_id) REFERENCES venues(id,organisation_id,legal_business_id),',replacement:'',
    test:'billing-schema.test.ts',pattern:'billing schema rejects foreign ownership and retains billing parents'},
   {name:'event payload',file:'packages/registration/src/billing-store.ts',
    needle:'||canonical(previous.command)!==canonical(command)',replacement:'',
    test:'billing-store.test.ts',pattern:'changed event payload refuses without effects'},
   {name:'immutable line snapshot',file:'packages/registration/migrations/045_billing_store.sql',
    needle:'CREATE TRIGGER billing_lines_immutable BEFORE UPDATE OR DELETE ON billing_charge_lines FOR EACH ROW EXECUTE FUNCTION reject_billing_fact_mutation();',replacement:'',
    test:'billing-schema.test.ts',pattern:'billing schema enforces uniqueness and immutable facts'},
   {name:'accepted payment',file:'packages/registration/src/billing-payments.ts',
    needle:'command.expectedRevision!==before.revision||!allowed',replacement:'command.expectedRevision!==before.revision',
    test:'billing-payments.test.ts',pattern:'accepted succeeded payment refuses failed before any observation effect'},
  ];
  async function run(c:typeof cases[number]){
   return exec(process.execPath,['--test','--test-reporter=tap','--test-name-pattern='+c.pattern,'test/'+c.test],{cwd:join(candidate,'packages/registration'),timeout:10000,maxBuffer:2*1024*1024}).then(r=>({code:0,output:r.stdout+r.stderr}),e=>({code:e.code,output:e.stdout+e.stderr}));
  }
  let detected=0;
  for(const c of cases){
   const original=await readFile(join(candidate,c.file),'utf8');
   assert.equal(original.split(c.needle).length,2,c.name+' omission must target exactly one guard');
   const before=await run(c);assert.equal(before.code,0,before.output);assert.match(before.output,/# pass 1\b/);assert.match(before.output,/# fail 0\b/);
   try{
    await writeFile(join(candidate,c.file),original.replace(c.needle,c.replacement));
    const omitted=await run(c);assert.equal(omitted.code,1,omitted.output);assert.match(omitted.output,/# fail 1\b/);assert.match(omitted.output,/AssertionError|ERR_ASSERTION/);assert.ok(omitted.output.includes(c.pattern));
    detected++;console.log('BILLING_GUARD_DETECTED '+c.name);
   }finally{await writeFile(join(candidate,c.file),original);}
   const restored=await run(c);assert.equal(restored.code,0,restored.output);assert.match(restored.output,/# pass 1\b/);
  }
  assert.equal(detected,4);
 }finally{await rm(scratch,{recursive:true,force:true});}
});
