import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {promisify} from 'node:util';
const exec=promisify(execFile);

// Each omission runs against the real database and must fail its assertion before restoration.
test('remote boundary guards detect eleven independent omissions',{timeout:180000},async()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url)),scratch=await mkdtemp(join(tmpdir(),'venue-remote-boundary-guards-')),candidate=join(scratch,'candidate');
 try{
  await exec('git',['clone','--quiet','--no-hardlinks',root,candidate],{timeout:10000});
  await exec('pnpm',['install','--frozen-lockfile'],{cwd:candidate,timeout:20000});
  const cases=[
   {name:'legacy authority exclusion',file:'remote-access/src/plan-permissions',needle:"return installed?' AND NOT EXISTS",replacement:"return false?' AND NOT EXISTS",pattern:'legacy remote batch excludes enrolled venues with reports false',expected:'Expected values to be strictly deep-equal'},
   {name:'legacy direct batch',file:'remote-access/src/plan-permissions',needle:'${exclusion}',replacement:'',pattern:'legacy remote batch excludes enrolled venues with reports false',expected:'Expected values to be strictly deep-equal'},
   {name:'legacy reporting manifest',file:'remote-access/src/placement',needle:'${exclusion}',replacement:'',pattern:'legacy remote batch excludes enrolled venues with reports true',expected:'Expected values to be strictly deep-equal'},
   {name:'legacy reporting scheduler',file:'remote-access/src/reconciler',needle:'${exclusion}',replacement:'',pattern:'legacy remote batch excludes enrolled venues with reports true',expected:'Expected values to be strictly deep-equal'},
   {name:'legacy forward observation',file:'remote-access/src/forward-observations',needle:'${exclusion}',replacement:'',pattern:'legacy remote observations cannot grant an enrolled venue access',expected:'Expected values to be strictly equal'},
   {name:'post-wait setup statement',file:'remote-access/src/plan-permissions',needle:' if(lock)await client.query(`SELECT i.id FROM installations i WHERE i.id=ANY($1::uuid[]) ORDER BY i.id${lock}`,[candidates.map(r=>r.id)]);',replacement:'',pattern:'venue remote SHARE batch rereads setup after installation wait',expected:'remote boundary must reach the real installation lock wait'},
   {name:'private route generation digest',file:'remote-access/src/reconciler',needle:":undefined,mode==='test-venue-levels')});",replacement:':undefined,false)});',pattern:'venue remote signing wait refuses reprovisioned generation with reports false',expected:'1 !== 0'},
   {name:'private route revision',file:'remote-access/src/reconciler',needle:"forwardReports||mode==='test-venue-levels'?{revision:Number(row.configuration_revision)}",replacement:'forwardReports?{revision:Number(row.configuration_revision)}',pattern:'venue remote signing wait refuses reprovisioned generation with reports false',expected:'1 !== 0'},
   {name:'captured new placement policy set',file:'remote-access/src/plan-permissions',needle:'WHERE v.organisation_id=ANY($1::uuid[])',replacement:'WHERE ($1::uuid[] IS NOT NULL)',pattern:'an export defers a new placement whose policy was not in its locked set',expected:'Expected values to be strictly deep-equal',legacy:true},
   {name:'captured incoming move policy set',file:'remote-access/src/plan-permissions',needle:'WHERE v.organisation_id=ANY($1::uuid[])',replacement:'WHERE ($1::uuid[] IS NOT NULL)',pattern:'a cell export defers an incoming move whose organisation was absent from its policy locks',expected:'Expected values to be strictly deep-equal',legacy:true},
   {name:'account status current level',file:'account-http/src/remote-access',needle:"permission?permission.level==='connected'||permission.level==='hosted':",replacement:'permission?true:',pattern:'venue remote HTTP status masks downgraded setup and needs explicit reprovision after upgrade',expected:'Expected values to be strictly equal'},
  ];
  const originals=new Map<string,string>();for(const c of cases)if(!originals.has(c.file))originals.set(c.file,await readFile(join(candidate,'packages/'+c.file+'.ts'),'utf8'));
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  async function run(c:typeof cases[number]){
   const http=c.file.startsWith('account-http/'),legacy='legacy' in c&&c.legacy,pkg=http?'account-http':'remote-access',file=legacy?'plan-permissions.test.ts':http?'venue-service-remote.test.ts':'venue-service-remote-boundaries.test.ts';
   return exec(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^'+c.pattern+'$','test/'+file],{cwd:join(candidate,'packages',pkg),env,timeout:25000,maxBuffer:2*1024*1024})
    .then(r=>({code:0,output:r.stdout+r.stderr}),e=>({code:e.code,output:e.stdout+e.stderr}));
  }
  for(const c of cases){
   const path=join(candidate,'packages/'+c.file+'.ts'),original=originals.get(c.file)!;assert.equal(original.split(c.needle).length,2,c.name+' must target one guard');
   const before=await run(c);assert.equal(before.code,0,before.output);assert.match(before.output,/# pass 1\b/);assert.match(before.output,/# fail 0\b/);
   try{
    await writeFile(path,original.replace(c.needle,c.replacement));const omitted=await run(c);
    assert.equal(omitted.code,1,omitted.output);assert.match(omitted.output,/# fail 1\b/);assert.match(omitted.output,/AssertionError|ERR_ASSERTION/);assert.ok(omitted.output.includes(c.expected),omitted.output);
   }finally{await writeFile(path,original);}
   const restored=await run(c);assert.equal(restored.code,0,restored.output);assert.match(restored.output,/# pass 1\b/);assert.match(restored.output,/# fail 0\b/);
   console.log('VENUE_REMOTE_BOUNDARY_GUARD_DETECTED '+c.name);
  }
 }finally{await rm(scratch,{recursive:true,force:true});}
});
