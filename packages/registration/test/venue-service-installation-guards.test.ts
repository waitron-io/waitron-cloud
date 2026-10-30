import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {promisify} from 'node:util';
const exec=promisify(execFile);

// Each removed admission or response guard must fail its real database assertion.
test('installation venue guards detect all six omissions',{timeout:180000},async()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url));
 const scratch=await mkdtemp(join(tmpdir(),'venue-installation-guards-')),candidate=join(scratch,'candidate');
 try{
  await exec('git',['clone','--quiet','--no-hardlinks',root,candidate],{timeout:10000});
  await exec('pnpm',['install','--frozen-lockfile'],{cwd:candidate,timeout:20000});
  const path=join(candidate,'packages/registration/src/installations.ts'),original=await readFile(path,'utf8');
  const cases=[
   {name:'current authority',needle:"if(mode==='test-venue-levels')return (await readVenuePermissions(client,venueId,mode)).level;",
    replacement:"if(mode==='test-venue-levels')return 'connected';",pattern:'venue signature verification precedes unavailable authority',expected:'Missing expected rejection'},
   {name:'translation response mask',needle:"if(mode==='test-venue-levels'||s.service!=='content_translation')",
    replacement:"if(s.service!=='content_translation')",pattern:'venue configuration-v2 fresh reply masks every unavailable service',expected:'content_translation'},
   {name:'cached response refresh',needle:"if(this.#planMode==='existing')return prior.result;",replacement:'if(true)return prior.result;',
    pattern:'venue configuration-v2 cached reply masks every unavailable service',expected:'content_translation'},
   {name:'setup admission',needle:"if(!paidInstallationPlan(plan,this.#planMode))fail('permission_denied');",replacement:'',
    pattern:'venue level one denies trusted setup without changing its stored services',expected:'Missing expected rejection'},
   {name:'complete venue batch lock',needle:'ORDER BY id FOR NO KEY UPDATE',replacement:'ORDER BY id',
    pattern:'venue account list locks every venue before expiring earlier setup',expected:'batch policy wait must leave earlier installations unlocked'},
   {name:'post-wait account scope',needle:"if(this.#planMode==='test-venue-levels'&&(v.venueId!==i.venue_id||v.organisationId!==i.organisation_id||v.legalBusinessId!==i.legal_business_id))fail('permission_denied');",
    replacement:'',pattern:'venue account list rechecks installation scope after its policy wait',expected:'Missing expected rejection'},
  ];
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  async function run(pattern:string){
   return exec(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^'+pattern+'$','test/venue-service-installations.test.ts'],
    {cwd:join(candidate,'packages/registration'),env,timeout:20000,maxBuffer:2*1024*1024})
    .then(r=>({code:0,output:r.stdout+r.stderr}),e=>({code:e.code,output:e.stdout+e.stderr}));
  }
  for(const c of cases){
   assert.equal(original.split(c.needle).length,2,c.name+' must target one guard');
   const before=await run(c.pattern);assert.equal(before.code,0,before.output);assert.match(before.output,/# pass 1\b/);assert.match(before.output,/# fail 0\b/);
   try{
    await writeFile(path,original.replace(c.needle,c.replacement));
    const omitted=await run(c.pattern);assert.equal(omitted.code,1,omitted.output);assert.match(omitted.output,/# fail 1\b/);
    assert.match(omitted.output,/AssertionError|ERR_ASSERTION/);assert.ok(omitted.output.includes(c.expected),omitted.output);assert.ok(omitted.output.includes(c.pattern));
   }finally{await writeFile(path,original);}
   const restored=await run(c.pattern);assert.equal(restored.code,0,restored.output);assert.match(restored.output,/# pass 1\b/);
   console.log('VENUE_INSTALLATION_GUARD_DETECTED '+c.name);
  }
 }finally{await rm(scratch,{recursive:true,force:true});}
});
