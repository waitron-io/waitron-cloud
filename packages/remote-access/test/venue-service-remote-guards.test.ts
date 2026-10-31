import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {promisify} from 'node:util';
const exec=promisify(execFile);

// Each omission must break the real database assertion, then the restored guard must pass again.
test('remote venue guards detect nine independent omissions',{timeout:180000},async()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url)),scratch=await mkdtemp(join(tmpdir(),'venue-remote-guards-')),candidate=join(scratch,'candidate');
 try{
  await exec('git',['clone','--quiet','--no-hardlinks',root,candidate],{timeout:10000});
  await exec('pnpm',['install','--frozen-lockfile'],{cwd:candidate,timeout:20000});
  const cases=[
   {name:'current admission',file:'plan-permissions',needle:"  await requireVenueService(client,row.venue_id,'remote_access',mode);",replacement:'',pattern:'venue remote provision refuses level one before external work',expected:'Missing expected rejection'},
   {name:'current level over stale setup',file:'plan-permissions',needle:"if(permission.level==='connected'||permission.level==='hosted')allowed.add(venue.id);",replacement:'allowed.add(venue.id);',pattern:'venue remote stale configured level-one routes and fresh reports remain denied',expected:'Expected values to be strictly deep-equal'},
   {name:'explicit setup',file:'plan-permissions',needle:"AND i.superseded_by IS NULL AND s.state<>'unconfigured'",replacement:'AND i.superseded_by IS NULL',pattern:'venue remote routes isolate same organisation siblings with reports false',expected:'Expected values to be strictly deep-equal'},
   {name:'complete venue batch',file:'plan-permissions',needle:'ORDER BY id FOR NO KEY UPDATE',replacement:'ORDER BY id',pattern:'venue remote batch locks every venue before expiring earlier setup',expected:'batch policy wait must leave earlier installations unlocked'},
   {name:'original installation binding',file:'plan-permissions',needle:'&&row.venue_id===before.venue_id&&row.organisation_id===before.organisation_id&&row.legal_business_id===before.legal_business_id',replacement:'',pattern:'venue remote export rechecks original installation binding after a venue wait',expected:'Expected values to be strictly deep-equal'},
   {name:'reporting manifest eligibility',file:'placement',needle:"if(this.#planMode==='test-venue-levels')ids=",replacement:'if(false)ids=',pattern:'venue remote routes isolate same organisation siblings with reports true',expected:'Expected values to be strictly deep-equal'},
   {name:'reporting scheduler eligibility',file:'reconciler',needle:" if(mode==='test-venue-levels'){",replacement:' if(false){',pattern:'venue remote routes isolate same organisation siblings with reports true',expected:'0 !== 2'},
   {name:'forward observation eligibility',file:'forward-observations',needle:" if(mode==='test-venue-levels'&&!eligible?.has(id))return;",replacement:'',pattern:'venue remote stale configured level-one routes and fresh reports remain denied',expected:"'1' !== '0'"},
   {name:'explicit existing placement reprovision',file:'placement',needle:"this.#planMode==='test-free-paid'||this.#planMode==='test-venue-levels'",replacement:"this.#planMode==='test-free-paid'",pattern:'venue remote routes isolate same organisation siblings with reports false',expected:'Expected values to be strictly equal'},
  ];
  const originals=new Map<string,string>();for(const c of cases)if(!originals.has(c.file))originals.set(c.file,await readFile(join(candidate,'packages/remote-access/src/'+c.file+'.ts'),'utf8'));
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  async function run(pattern:string){
   return exec(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^'+pattern+'$','test/venue-service-remote.test.ts'],{cwd:join(candidate,'packages/remote-access'),env,timeout:25000,maxBuffer:2*1024*1024})
    .then(r=>({code:0,output:r.stdout+r.stderr}),e=>({code:e.code,output:e.stdout+e.stderr}));
  }
  for(const c of cases){
   const path=join(candidate,'packages/remote-access/src/'+c.file+'.ts'),original=originals.get(c.file)!;assert.equal(original.split(c.needle).length,2,c.name+' must target one guard');
   const before=await run(c.pattern);assert.equal(before.code,0,before.output);assert.match(before.output,/# pass 1\b/);assert.match(before.output,/# fail 0\b/);
   try{
    await writeFile(path,original.replace(c.needle,c.replacement));const omitted=await run(c.pattern);
    assert.equal(omitted.code,1,omitted.output);assert.match(omitted.output,/# fail 1\b/);assert.match(omitted.output,/AssertionError|ERR_ASSERTION/);assert.ok(omitted.output.includes(c.expected),omitted.output);
   }finally{await writeFile(path,original);}
   const restored=await run(c.pattern);assert.equal(restored.code,0,restored.output);assert.match(restored.output,/# pass 1\b/);
   console.log('VENUE_REMOTE_GUARD_DETECTED '+c.name);
  }
 }finally{await rm(scratch,{recursive:true,force:true});}
});
