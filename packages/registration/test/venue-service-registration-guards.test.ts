import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {promisify} from 'node:util';
const exec=promisify(execFile);

// Each missing policy lock must trip its real PostgreSQL assertion, with both controls passing.
test('registration and pairing policy guards detect all five omissions',{timeout:150000},async()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url));
 const scratch=await mkdtemp(join(tmpdir(),'venue-registration-guards-')),candidate=join(scratch,'candidate');
 try{
  await exec('git',['clone','--quiet','--no-hardlinks',root,candidate],{timeout:10000});
  await exec('pnpm',['install','--frozen-lockfile'],{cwd:candidate,timeout:20000});
  const registration='packages/registration/src/index.ts',pairing='packages/registration/src/pairing.ts';
  const cases=[
   {name:'registration completion organisation',file:registration,
    needle:"await requireUnexpired(client, binding);\n        await client.query('SELECT id FROM organisations WHERE id=$1 FOR SHARE', [binding.organisationId]);\n        await client.query(`INSERT INTO venues",
    replacement:'await requireUnexpired(client, binding);\n        await client.query(`INSERT INTO venues',
    pattern:'registration completion locks organisation before venue and installations'},
   {name:'registration replay organisation',file:registration,
    needle:"// Replays join the same policy order before touching a completed installation.\n          await client.query('SELECT id FROM organisations WHERE id=$1 FOR SHARE', [binding.organisationId]);",
    replacement:'',pattern:'registration replay locks organisation before venue and installations'},
   {name:'registration replay venue',file:registration,needle:'AND legal_business_id=$3 AND local_venue_id=$4 AND environment=$5 FOR NO KEY UPDATE',
    replacement:'AND legal_business_id=$3 AND local_venue_id=$4 AND environment=$5',
    pattern:'registration replay waits for a venue transition without holding installations'},
   {name:'pairing replay organisation',file:pairing,
    needle:"await client.query('SELECT id FROM organisations WHERE id=$1 FOR SHARE',[row.organisation_id]);",
    replacement:'',pattern:'pairing replay locks organisation before venue and installations'},
   {name:'pairing replay venue',file:pairing,needle:'AND legal_business_id=$3 AND local_venue_id=$4 AND environment=$5 FOR NO KEY UPDATE',
    replacement:'AND legal_business_id=$3 AND local_venue_id=$4 AND environment=$5',
    pattern:'pairing replay waits for a venue transition without holding installations'},
  ];
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  async function run(pattern:string){
   return exec(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^'+pattern+'$','test/venue-service-registration-races.test.ts'],
    {cwd:join(candidate,'packages/registration'),env,timeout:15000,maxBuffer:2*1024*1024})
    .then(r=>({code:0,output:r.stdout+r.stderr}),e=>({code:e.code,output:e.stdout+e.stderr}));
  }
  for(const c of cases){
   const path=join(candidate,c.file),original=await readFile(path,'utf8');
   assert.equal(original.split(c.needle).length,2,c.name+' must target one guard');
   const before=await run(c.pattern);assert.equal(before.code,0,before.output);assert.match(before.output,/# pass 1\b/);assert.match(before.output,/# fail 0\b/);
   try{
    await writeFile(path,original.replace(c.needle,c.replacement));
    const omitted=await run(c.pattern);assert.equal(omitted.code,1,omitted.output);assert.match(omitted.output,/# fail 1\b/);
    assert.match(omitted.output,/AssertionError|ERR_ASSERTION/);assert.match(omitted.output,/completion must wait for the policy lock before installation access/);assert.ok(omitted.output.includes(c.pattern));
   }finally{await writeFile(path,original);}
   const restored=await run(c.pattern);assert.equal(restored.code,0,restored.output);assert.match(restored.output,/# pass 1\b/);
   console.log('VENUE_REGISTRATION_GUARD_DETECTED '+c.name);
  }
 }finally{await rm(scratch,{recursive:true,force:true});}
});
