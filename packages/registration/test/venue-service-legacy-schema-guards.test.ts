import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {promisify} from 'node:util';
const exec=promisify(execFile);

// Each compatibility branch must preserve old clients and refuse damaged current authority.
test('historical schema guards detect all seven omissions',{timeout:240000},async()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url));
 const scratch=await mkdtemp(join(tmpdir(),'venue-schema-guards-')),candidate=join(scratch,'candidate');
 try{
  await exec('git',['clone','--quiet','--no-hardlinks',root,candidate],{timeout:10000});
  await exec('pnpm',['install','--frozen-lockfile'],{cwd:candidate,timeout:20000});
  const registration='packages/registration/src/index.ts',plans='packages/registration/src/organisation-plans.ts',schema='packages/registration/src/venue-service-schema.ts';
  const cases=[
   {name:'registration completion historical schema',file:registration,
    needle:'const enrolled = await venueServiceAuthorityInstalled(client)',replacement:'const enrolled = true',
    pattern:'release 45 registration completion and replay preserve the historical schema'},
   {name:'registration replay historical schema',file:registration,
    needle:'const authority = await venueServiceAuthorityInstalled(client)',replacement:'const authority = true',
    pattern:'release 45 registration completion and replay preserve the historical schema'},
   {name:'pairing replay historical schema',file:'packages/registration/src/pairing.ts',
    needle:'const authority=await venueServiceAuthorityInstalled(client)',replacement:'const authority=true',
    pattern:'release 45 pairing completion and replay preserve the historical schema'},
   {name:'legacy reader historical schema',file:plans,
    needle:'if (await venueServiceAuthorityInstalled(client)',replacement:'if (true',
    pattern:'release 45 legacy plan read does not require venue authority'},
   {name:'legacy setter historical schema',file:plans,
    needle:'const exclusion = await venueServiceAuthorityInstalled(client)',replacement:'const exclusion = true',
    pattern:'release 45 legacy plan change does not require venue authority'},
   {name:'missing current table refuses',file:schema,
    needle:"OR EXISTS(SELECT 1 FROM schema_migrations WHERE name='046_venue_service_authority.sql')",replacement:'OR false',
    pattern:'a missing current authority table cannot silently restore legacy plan access',assertion:true},
   {name:'missing receipt cannot hide authority',file:schema,
    needle:"to_regclass('billing_service_authority') IS NOT NULL",replacement:'false',
    pattern:'a missing migration receipt cannot hide an enrolled venue from legacy plans',assertion:true},
  ];
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  async function run(pattern:string){
   return exec(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^'+pattern+'$','test/venue-service-legacy-schema.test.ts'],
    {cwd:join(candidate,'packages/registration'),env,timeout:30000,maxBuffer:2*1024*1024})
    .then(r=>({code:0,output:r.stdout+r.stderr}),e=>({code:e.code,output:e.stdout+e.stderr}));
  }
  for(const c of cases){
   const path=join(candidate,c.file),original=await readFile(path,'utf8');assert.equal(original.split(c.needle).length,2,c.name+' must target one guard');
   const before=await run(c.pattern);assert.equal(before.code,0,before.output);assert.match(before.output,/# pass 1\b/);assert.match(before.output,/# fail 0\b/);
   try{
    await writeFile(path,original.replace(c.needle,c.replacement));
    const omitted=await run(c.pattern);assert.equal(omitted.code,1,omitted.output);assert.match(omitted.output,/# fail 1\b/);assert.ok(omitted.output.includes(c.pattern));
    if(c.assertion)assert.match(omitted.output,/Missing expected rejection/);
    else{assert.match(omitted.output,/relation "billing_service_authority" does not exist/);assert.match(omitted.output,/42P01/);}
   }finally{await writeFile(path,original);}
   const restored=await run(c.pattern);assert.equal(restored.code,0,restored.output);assert.match(restored.output,/# pass 1\b/);
   console.log('VENUE_SCHEMA_GUARD_DETECTED '+c.name);
  }
 }finally{await rm(scratch,{recursive:true,force:true});}
});
