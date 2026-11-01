import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {promisify} from 'node:util';
const exec=promisify(execFile);

// Independent omissions must lose a behavioural assertion and recover when the original source is restored.
test('replacement venue guards detect independent omissions',{timeout:180000},async()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url)),scratch=await mkdtemp(join(tmpdir(),'venue-replacement-guards-')),candidate=join(scratch,'candidate');
 try{
  await exec('git',['clone','--quiet','--no-hardlinks',root,candidate],{timeout:10000});
  await exec('pnpm',['install','--frozen-lockfile'],{cwd:candidate,timeout:20000});
  const path=join(candidate,'packages/backups/src/replacement.ts'),original=await readFile(path,'utf8');
  const cases=[
   {name:'current activation authority',needle:'\n  await backupPlan(client,r.venue_id,this.planMode);',replacement:'',
    pattern:'venue snapshot replacement refuses new proposals at level one without changing recovery',expected:'Missing expected rejection'},
   {name:'completed replay authority',needle:"if(this.planMode!=='existing'){await permission(client,r.account_id,r.venue_id);await backupPlan(client,r.venue_id,this.planMode);}",
    replacement:"if(this.planMode!=='existing'){await permission(client,r.account_id,r.venue_id);}",
    pattern:'venue snapshot completed replacement replay cannot bypass a downgrade',expected:'Missing expected rejection'},
   {name:'proof expiry after authority wait',needle:'await current(client,c.id);claims(this.origin,action,envelope);return view(r,saved);',
    replacement:'await current(client,c.id);return view(r,saved);',pattern:'venue replacement rechecks proof expiry after waiting on venue authority',expected:'Missing expected rejection'},
   {name:'session expiry after storage wait',needle:'await current(client,id);await resolveSession(client,token,{csrfToken:csrf,touch:false});',
    replacement:'await current(client,id);',pattern:'venue replacement rolls back activation when session expires behind a storage lock',expected:'Missing expected rejection'},
  ];
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  async function run(pattern:string){
   return exec(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^'+pattern+'$','packages/backups/test/venue-service-replacement.test.ts'],{cwd:candidate,env,timeout:30000,maxBuffer:2*1024*1024})
    .then(r=>({code:0,output:r.stdout+r.stderr}),e=>({code:e.code,output:e.stdout+e.stderr}));
  }
  for(const c of cases){
   assert.equal(original.split(c.needle).length,2,c.name+' must target one guard');
   const before=await run(c.pattern);assert.equal(before.code,0,before.output);assert.match(before.output,/# pass 1\b/);assert.match(before.output,/# fail 0\b/);
   try{
    await writeFile(path,original.replace(c.needle,c.replacement));
    const omitted=await run(c.pattern);assert.equal(omitted.code,1,omitted.output);assert.match(omitted.output,/# fail 1\b/);
    assert.match(omitted.output,/AssertionError|ERR_ASSERTION/);assert.ok(omitted.output.includes(c.expected),omitted.output);
   }finally{await writeFile(path,original);}
   const restored=await run(c.pattern);assert.equal(restored.code,0,restored.output);assert.match(restored.output,/# pass 1\b/);assert.match(restored.output,/# fail 0\b/);
   console.log('VENUE_REPLACEMENT_GUARD_DETECTED '+c.name);
  }
 }finally{await rm(scratch,{recursive:true,force:true});}
});
