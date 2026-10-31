import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {promisify} from 'node:util';
const exec=promisify(execFile);
test('venue translation HTTP and wait authority detect independent guard omissions',{timeout:150000},async()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url)),scratch=await mkdtemp(join(tmpdir(),'venue-translation-http-guards-')),candidate=join(scratch,'candidate');
 try{
  await exec('git',['clone','--quiet','--no-hardlinks',root,candidate],{timeout:10000});
  await exec('pnpm',['install','--frozen-lockfile'],{cwd:candidate,timeout:30000});
  const refresh="     row=(await client.query(query+' FOR SHARE OF i',[routing.installationId])).rows[0];claims=authorize(row);";
  const cases=[
   {name:'HTTP mode propagation',file:'packages/account-http/src/app.ts',needle:'new TranslationMachine(pool,options.leaseIssuer,config.portalOrigin,options.leaseTrust,undefined,options.planMode)',replacement:'new TranslationMachine(pool,options.leaseIssuer,config.portalOrigin,options.leaseTrust)',package:'account-http',test:'venue-service-translation-http.test.ts',pattern:'venue HTTP translation refuses registered admission before creating a job'},
   {name:'post-policy proof authentication',file:'packages/translation/src/machine.ts',needle:refresh,replacement:refresh.replace('claims=authorize(row);',''),package:'translation',test:'venue-service-authority.test.ts',pattern:'venue translation rechecks revocation after policy wait'},
  ];
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  async function run(c:typeof cases[number]){
   return exec(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^'+c.pattern+'$','test/'+c.test],{cwd:join(candidate,'packages',c.package),env,timeout:25000,maxBuffer:2*1024*1024})
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
    await writeFile(path,original.replace(c.needle,c.replacement));const omitted=await run(c);
    assert.equal(omitted.code,1,omitted.output);assert.match(omitted.output,/# tests 1\b/);assert.match(omitted.output,/# fail 1\b/);assert.match(omitted.output,/ERR_ASSERTION|AssertionError/);
    assert.match(omitted.output,c.name==='HTTP mode propagation'?/200|queued/:/Missing expected rejection/);
   }finally{await writeFile(path,original);}
   green(await run(c));console.log('VENUE_TRANSLATION_HTTP_GUARD_DETECTED '+c.name);
  }
 }finally{await rm(scratch,{recursive:true,force:true});}
});
