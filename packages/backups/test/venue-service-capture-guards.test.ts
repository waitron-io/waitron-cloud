import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {promisify} from 'node:util';
const exec=promisify(execFile);

// Each deliberate omission must fail its database assertion, with the restored source passing again.
test('capture and installation gap guards detect independent omissions',{timeout:240000},async()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url)),scratch=await mkdtemp(join(tmpdir(),'venue-capture-guards-')),candidate=join(scratch,'candidate');
 try{
  await exec('git',['clone','--quiet','--no-hardlinks',root,candidate],{timeout:10000});
  await exec('pnpm',['install','--frozen-lockfile'],{cwd:candidate,timeout:20000});
  const capturePath='packages/backups/src/captures.ts',permissionPath='packages/registration/src/venue-service-permissions.ts',installationPath='packages/registration/src/installations.ts';
  const cases=[
   {name:'proof before policy and metadata',path:capturePath,needle:"if(this.#options.planMode==='test-free-paid'||this.#options.planMode==='test-venue-levels')await this.authenticate(action,envelope);",replacement:"if(this.#options.planMode==='test-free-paid')await this.authenticate(action,envelope);",
    file:'packages/backups/test/venue-service-captures.test.ts',pattern:'venue capture backup-(reserve|publish) authenticates before unavailable authority',count:2,expected:'invalid_proof'},
   {name:'capture initial generation',path:capturePath,needle:'permission??=current;',replacement:'',
    file:'packages/backups/test/venue-service-captures.test.ts',pattern:'venue capture grant wait rejects (round-trip|trial-extension) without returning credentials',count:2,expected:'Missing expected rejection'},
   {name:'compare current generation',path:capturePath,needle:"if(permission&&(current.revision!==permission.revision||current.organisationId!==permission.organisationId||current.legalBusinessId!==permission.legalBusinessId||current.venueId!==permission.venueId))backupFail('conflict');",replacement:'',
    file:'packages/backups/test/venue-service-captures.test.ts',pattern:'venue capture grant wait rejects (round-trip|trial-extension) without returning credentials',count:2,expected:'Missing expected rejection'},
   {name:'compare grant destination',path:capturePath,needle:"if(this.#options.planMode==='test-venue-levels'&&(current.location.endpoint!==capture.location.endpoint||current.location.bucket!==capture.location.bucket||current.location.region!==capture.location.region))backupFail('conflict');",replacement:'',
    file:'packages/backups/test/venue-service-captures.test.ts',pattern:'venue capture grant wait rejects location without returning credentials',count:1,expected:'Missing expected rejection'},
   {name:'repeat admission after provider wait',path:capturePath,needle:'const current=await this.#catalogue.reserveCapture(routing.installationId,routing.operationId,fence);',replacement:'const current=capture;',
    file:'packages/backups/test/venue-service-captures.test.ts',pattern:'venue capture grant wait rejects .* without returning credentials',count:8,expected:'Missing expected rejection'},
   {name:'synchronise expiry on installation read',path:permissionPath,needle:'expired=elapsed(old,day);',replacement:'expired=false;',
    file:'packages/registration/test/venue-service-installations.test.ts',pattern:'venue installation configuration-v2 clears setup across expiry-read',count:1,expected:'ERR_ASSERTION'},
   {name:'synchronise expiry before late transition',path:permissionPath,needle:'expired=old?elapsed(old,day):false;',replacement:'expired=false;',
    file:'packages/registration/test/venue-service-installations.test.ts',pattern:'venue installation configuration-v2 clears setup across late-extension',count:1,expected:'continuous_backup'},
   {name:'clear setup after unobserved trial gap',path:permissionPath,needle:'if(advance)await installations(client,venueId,expired||window===null);',replacement:'if(advance)await installations(client,venueId,window===null);',
    file:'packages/registration/test/venue-service-installations.test.ts',pattern:'venue installation configuration-v2 clears setup across future-gap',count:1,expected:'continuous_backup'},
   {name:'refresh saved reply after trial gap',path:installationPath,needle:"if(this.#planMode==='existing')return prior.result;",replacement:'if(true)return prior.result;',
    file:'packages/registration/test/venue-service-installations.test.ts',pattern:'venue installation configuration-v2 clears setup across future-gap',count:1,expected:'ERR_ASSERTION'},
  ];
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  async function run(c:typeof cases[number]){
   return exec(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^'+c.pattern+'$',c.file],{cwd:candidate,env,timeout:45000,maxBuffer:2*1024*1024})
    .then(r=>({code:0,output:r.stdout+r.stderr}),e=>({code:e.code,output:e.stdout+e.stderr}));
  }
  for(const c of cases){
   const path=join(candidate,c.path),original=await readFile(path,'utf8');assert.equal(original.split(c.needle).length,2,c.name+' must target one guard');
   const before=await run(c);assert.equal(before.code,0,before.output);assert.match(before.output,new RegExp('# pass '+c.count+'\\b'));assert.match(before.output,/# fail 0\b/);
   try{
    await writeFile(path,original.replace(c.needle,c.replacement));
    const omitted=await run(c);assert.equal(omitted.code,1,omitted.output);assert.match(omitted.output,new RegExp('# fail '+c.count+'\\b'));
    assert.match(omitted.output,/AssertionError|ERR_ASSERTION/);assert.ok(omitted.output.includes(c.expected),omitted.output);
   }finally{await writeFile(path,original);}
   const restored=await run(c);assert.equal(restored.code,0,restored.output);assert.match(restored.output,new RegExp('# pass '+c.count+'\\b'));assert.match(restored.output,/# fail 0\b/);
   console.log('VENUE_CAPTURE_GAP_GUARD_DETECTED '+c.name);
  }
 }finally{await rm(scratch,{recursive:true,force:true});}
});
