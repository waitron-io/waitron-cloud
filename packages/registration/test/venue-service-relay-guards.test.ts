import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {promisify} from 'node:util';
const exec=promisify(execFile);
test('venue relay detects independent policy and mode propagation omissions',{timeout:150000},async()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url)),scratch=await mkdtemp(join(tmpdir(),'venue-relay-guards-')),candidate=join(scratch,'candidate');
 try{
  await exec('git',['clone','--quiet','--no-hardlinks',root,candidate],{timeout:10000});
  await exec('pnpm',['install','--frozen-lockfile'],{cwd:candidate,timeout:30000});
  const cases=[
   {name:'basic venue policy',file:'packages/registration/src/relay-grants.ts',needle:"await requireVenueService(client,candidate.venue_id,'transactional_email',planMode);",replacement:'',operation:'approval'},
   {name:'message mode propagation',file:'packages/registration/src/relay-messages.ts',needle:'new RelayGrantStore(pool,config.grants,planMode)',replacement:'new RelayGrantStore(pool,config.grants)',operation:'messages'},
   {name:'worker mode propagation',file:'packages/registration/src/relay-worker.ts',needle:'new RelayGrantStore(pool,config.grants,planMode)',replacement:'new RelayGrantStore(pool,config.grants)',operation:'handoff'},
   {name:'HTTP mode propagation',file:'packages/account-http/src/app.ts',needle:'new RelayMessages(pool,options.leaseIssuer,config.portalOrigin,options.relay,options.leaseTrust,options.planMode)',replacement:'new RelayMessages(pool,options.leaseIssuer,config.portalOrigin,options.relay,options.leaseTrust)',operation:'HTTP'},
  ];
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  async function run(c:typeof cases[number]){
   return exec(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^venue relay '+c.operation+' takes policy authority before installation locks$','test/venue-service-relay.test.ts'],{cwd:join(candidate,'packages/registration'),env,timeout:15000,maxBuffer:2*1024*1024})
    .then(r=>({code:0,output:r.stdout+r.stderr}),e=>({code:e.code,output:e.stdout+e.stderr}));
  }
  function green(value:Awaited<ReturnType<typeof run>>){
   assert.equal(value.code,0,value.output);
   for(const [name,count] of [['tests',1],['pass',1],['fail',0],['cancelled',0],['skipped',0],['todo',0]])assert.match(value.output,new RegExp('# '+name+' '+count+'\\b'));
  }
  for(const c of cases){
   const path=join(candidate,c.file),original=await readFile(path,'utf8');assert.equal(original.split(c.needle).length,2,c.name+' must match exactly once');
   green(await run(c));
   try{
    await writeFile(path,original.replace(c.needle,c.replacement));const fault=await run(c);
    assert.equal(fault.code,1,fault.output);assert.match(fault.output,/# tests 1\b/);assert.match(fault.output,/# fail 1\b/);
    assert.match(fault.output,/ERR_ASSERTION|AssertionError/);assert.match(fault.output,/relay must wait for the venue policy transition/);
    assert.doesNotMatch(fault.output,/test timed out|cancelledByParent|ECONNREFUSED|ERR_MODULE_NOT_FOUND/);
   }finally{await writeFile(path,original);}
   green(await run(c));console.log('VENUE_RELAY_GUARD_DETECTED '+c.name);
  }
 }finally{await rm(scratch,{recursive:true,force:true});}
});
