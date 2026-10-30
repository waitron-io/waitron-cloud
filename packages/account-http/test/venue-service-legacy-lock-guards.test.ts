import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {promisify} from 'node:util';
const exec=promisify(execFile);

// Each real database control runs before omission and after exact restoration.
test('legacy remote first-enrolment guards detect nine independent omissions',{timeout:180000},async()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url)),scratch=await mkdtemp(join(tmpdir(),'legacy-venue-guards-')),candidate=join(scratch,'candidate');
 try{
  await exec('git',['clone','--quiet','--no-hardlinks',root,candidate],{timeout:10000});
  await exec('pnpm',['install','--frozen-lockfile'],{cwd:candidate,timeout:20000});
  const cases=[
   {name:'every legacy parent lock',file:'plan-permissions',needle:'ORDER BY v.id FOR SHARE OF v',replacement:'ORDER BY v.id',pattern:'legacy remote .* waits for first enrolment',count:7,expected:'legacy remote batch must wait for first enrolment'},
   {name:'direct legacy parent capture',file:'plan-permissions',needle:'const captured=await lockLegacyRemoteScope(client,cellId,scope.installationIds);',replacement:'const captured={organisations:[],venues:[],venue_authority:true};',pattern:'legacy remote eligibility waits for first enrolment',count:1,expected:'legacy remote batch must wait for first enrolment'},
   {name:'reporting manifest parent capture',file:'placement',needle:"this.#planMode==='test-free-paid'?await lockLegacyRemoteScope",replacement:'false?await lockLegacyRemoteScope',pattern:'legacy remote reporting manifest waits for first enrolment',count:1,expected:'legacy remote batch must wait for first enrolment'},
   {name:'reporting scheduler parent capture',file:'reconciler',needle:"mode==='test-free-paid'?await lockLegacyRemoteScope",replacement:'false?await lockLegacyRemoteScope',pattern:'legacy remote reporting scheduler waits for first enrolment',count:1,expected:'legacy remote batch must wait for first enrolment'},
   {name:'observation write parent capture',file:'forward-observations',needle:"mode==='test-free-paid'?await lockLegacyRemoteScope",replacement:'false?await lockLegacyRemoteScope',pattern:'legacy remote observation write waits for first enrolment',count:1,expected:'legacy remote batch must wait for first enrolment'},
   {name:'observation read parent capture',file:'forward-observations',needle:"mode==='test-free-paid'?await lockLegacyRemoteScope",replacement:'false?await lockLegacyRemoteScope',pattern:'legacy remote observation read waits for first enrolment',count:1,expected:'legacy remote batch must wait for first enrolment'},
   {name:'captured direct venue set',file:'plan-permissions',needle:' AND v.id=ANY($2::uuid[])',replacement:' AND ($2::uuid[] IS NOT NULL)',pattern:'legacy remote manifest defers a new same-organisation placement',count:1,expected:'Expected values to be strictly deep-equal'},
   {name:'captured reporting venue set',file:'placement',needle:' AND ($4::uuid[] IS NULL OR v.id=ANY($4::uuid[]))',replacement:' AND ($4::uuid[] IS NULL OR $4::uuid[] IS NOT NULL)',pattern:'legacy remote reporting manifest defers a new same-organisation placement',count:1,expected:'Expected values to be strictly deep-equal'},
   {name:'captured scheduler venue set',file:'reconciler',needle:' AND ($4::uuid[] IS NULL OR v.id=ANY($4::uuid[]))',replacement:' AND ($4::uuid[] IS NULL OR $4::uuid[] IS NOT NULL)',pattern:'legacy remote reporting scheduler defers a new same-organisation placement',count:1,expected:"'2' !== '0'"},
  ];
  const originals=new Map<string,string>();for(const c of cases)if(!originals.has(c.file))originals.set(c.file,await readFile(join(candidate,'packages/remote-access/src/'+c.file+'.ts'),'utf8'));
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  async function run(c:typeof cases[number]){
   return exec(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^'+c.pattern+'$','test/venue-service-legacy-locks.test.ts'],{cwd:join(candidate,'packages/remote-access'),env,timeout:30000,maxBuffer:2*1024*1024})
    .then(r=>({code:0,output:r.stdout+r.stderr}),e=>({code:e.code,output:e.stdout+e.stderr}));
  }
  for(const c of cases){
   const path=join(candidate,'packages/remote-access/src/'+c.file+'.ts'),original=originals.get(c.file)!;assert.equal(original.split(c.needle).length,2,c.name+' must target one guard');
   const before=await run(c);assert.equal(before.code,0,before.output);assert.match(before.output,new RegExp('# pass '+c.count+'\\b'));assert.match(before.output,/# fail 0\b/);
   try{
    await writeFile(path,original.replace(c.needle,c.replacement));const omitted=await run(c);
    assert.equal(omitted.code,1,omitted.output);assert.match(omitted.output,new RegExp('# fail '+c.count+'\\b'));assert.match(omitted.output,/AssertionError|ERR_ASSERTION/);assert.ok(omitted.output.includes(c.expected),omitted.output);
   }finally{await writeFile(path,original);}
   const restored=await run(c);assert.equal(restored.code,0,restored.output);assert.match(restored.output,new RegExp('# pass '+c.count+'\\b'));assert.match(restored.output,/# fail 0\b/);
   console.log('VENUE_LEGACY_REMOTE_GUARD_DETECTED '+c.name);
  }
 }finally{await rm(scratch,{recursive:true,force:true});}
});
