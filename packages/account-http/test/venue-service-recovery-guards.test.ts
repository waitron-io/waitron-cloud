import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {promisify} from 'node:util';
const exec=promisify(execFile);

// Each omitted delivery guard must fail real HTTP assertions, with the original and restored source passing.
test('recovery HTTP venue guards detect independent omissions',{timeout:300000},async()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url)),scratch=await mkdtemp(join(tmpdir(),'venue-recovery-guards-')),candidate=join(scratch,'candidate');
 try{
  await exec('git',['clone','--quiet','--no-hardlinks',root,candidate],{timeout:10000});
  await exec('pnpm',['install','--frozen-lockfile'],{cwd:candidate,timeout:20000});
  const path=join(candidate,'packages/account-http/src/recovery.ts'),original=await readFile(path,'utf8');
  const cases=[
   {name:'remember admitted generation',needle:'permission??=current;destination??=currentDestination;',replacement:'destination??=currentDestination;',
    pattern:'venue snapshot recovery provider wait rejects (round-trip|trial-extension) without credentials',count:2},
   {name:'compare current generation',needle:"if(permission&&(current.revision!==permission.revision||current.organisationId!==permission.organisationId||current.legalBusinessId!==permission.legalBusinessId||current.venueId!==permission.venueId))throw new Error('backup.conflict');",replacement:'',
    pattern:'venue snapshot recovery provider wait rejects (round-trip|trial-extension) without credentials',count:2},
   {name:'compare grant destination',needle:"if(destination!==undefined&&currentDestination!==destination)throw new Error('backup.conflict');",replacement:'',
    pattern:'venue (snapshot|continuous) recovery provider wait rejects ((endpoint|bucket|region) without credentials|a changed reader reference without credentials)',count:7},
   {name:'repeat continuous admission after provider wait',needle:'const current=await read();',replacement:'const current=first;',
    pattern:'venue continuous recovery provider wait rejects (membership|operation-expiry|owner-close|proof-expiry) without credentials',count:4},
   {name:'repeat snapshot admission after provider wait',needle:'const current=await read(),expires=Date.parse(grant.expiresAt);',replacement:'const current=first,expires=Date.parse(grant.expiresAt);',
    pattern:'venue snapshot recovery provider wait rejects (membership|operation-expiry|owner-close|proof-expiry) without credentials',count:4},
  ];
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  async function run(c:typeof cases[number]){
   return exec(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^'+c.pattern+'$','packages/account-http/test/venue-service-recovery.test.ts'],{cwd:candidate,env,timeout:60000,maxBuffer:2*1024*1024})
    .then(r=>({code:0,output:r.stdout+r.stderr}),e=>({code:e.code,output:e.stdout+e.stderr}));
  }
  for(const c of cases){
   assert.equal(original.split(c.needle).length,2,c.name+' must target one guard');
   const before=await run(c);assert.equal(before.code,0,before.output);assert.match(before.output,new RegExp('# pass '+c.count+'\\b'));assert.match(before.output,/# fail 0\b/);
   try{
    await writeFile(path,original.replace(c.needle,c.replacement));
    const omitted=await run(c);assert.equal(omitted.code,1,omitted.output);assert.match(omitted.output,new RegExp('# fail '+c.count+'\\b'));assert.match(omitted.output,/AssertionError|ERR_ASSERTION/);assert.match(omitted.output,/200 !== (401|403|409|410)/);
   }finally{await writeFile(path,original);}
   const restored=await run(c);assert.equal(restored.code,0,restored.output);assert.match(restored.output,new RegExp('# pass '+c.count+'\\b'));assert.match(restored.output,/# fail 0\b/);
   console.log('VENUE_RECOVERY_HTTP_GUARD_DETECTED '+c.name);
  }
 }finally{await rm(scratch,{recursive:true,force:true});}
});
