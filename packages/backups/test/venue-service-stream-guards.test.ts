import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {promisify} from 'node:util';
const exec=promisify(execFile);

// Each independent omission must lose its behavioural assertion, with both original and restored controls passing.
test('managed stream venue guards detect independent omissions',{timeout:240000},async()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url)),scratch=await mkdtemp(join(tmpdir(),'venue-stream-guards-')),candidate=join(scratch,'candidate');
 try{
  await exec('git',['clone','--quiet','--no-hardlinks',root,candidate],{timeout:10000});
  await exec('pnpm',['install','--frozen-lockfile'],{cwd:candidate,timeout:20000});
  const streamPath='packages/backups/src/managed-streams.ts',permissionPath='packages/registration/src/venue-service-permissions.ts';
  const cases=[
   {name:'post-policy installation scope',needle:"if (mode === 'test-venue-levels' && row.venue_id !== initial.venue_id) backupFail('permission_denied');",replacement:'',
    pattern:'venue stream policy wait rechecks installation scope before provisioning',count:1,expected:'sibling'},
   {name:'explicit venue reprovision',needle:"const cleared=(this.#planMode==='test-free-paid'||this.#planMode==='test-venue-levels') && existing",replacement:"const cleared=this.#planMode==='test-free-paid' && existing",
    pattern:'venue stream explicit reprovision preserves keys reader and observed data',count:1,expected:'backup.conflict'},
   {name:'provision destination after wait',needle:"if (this.#planMode === 'test-venue-levels' &&\n          (install.venue_id !== initial.install.venue_id || install.endpoint !== initial.install.endpoint ||\n           install.bucket !== initial.install.bucket || install.region !== initial.install.region)) backupFail('conflict');",replacement:'',
    pattern:'venue stream configure wait rejects changed (endpoint|bucket|region) without publishing',count:3,expected:'Missing expected rejection'},
   {name:'observation destination after wait',needle:"if (this.#planMode === 'test-venue-levels' &&\n          (row.venue_id !== initial.venue_id || row.endpoint !== initial.endpoint ||\n           row.bucket !== initial.bucket || row.region !== initial.region)) backupFail('conflict');",replacement:'',
    pattern:'venue stream observe wait rejects changed (endpoint|bucket|region) without publishing',count:3,expected:'Missing expected rejection'},
   {name:'stream reprovision after trial gaps',needle:"const cleared=(this.#planMode==='test-free-paid'||this.#planMode==='test-venue-levels') && existing",replacement:"const cleared=this.#planMode==='test-free-paid' && existing",
    pattern:'venue stream explicit reprovision after .* preserves recovery and its neighbour',count:4,expected:'backup.conflict'},
   {name:'stream expiry read clears setup',path:permissionPath,needle:'expired=elapsed(old,day);',replacement:'expired=false;',
    pattern:'venue stream explicit reprovision after expiry-read preserves recovery and its neighbour',count:1,expected:'continuous_backup'},
   {name:'stream late extension clears setup',path:permissionPath,needle:'expired=old?elapsed(old,day):false;',replacement:'expired=false;',
    pattern:'venue stream explicit reprovision after late-extension preserves recovery and its neighbour',count:1,expected:'continuous_backup'},
   {name:'stream unobserved gap clears setup',path:permissionPath,needle:'if(advance)await installations(client,venueId,expired||window===null);',replacement:'if(advance)await installations(client,venueId,window===null);',
    pattern:'venue stream explicit reprovision after future-gap preserves recovery and its neighbour',count:1,expected:'continuous_backup'},
  ];
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  async function run(c:typeof cases[number]){
   return exec(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^'+c.pattern+'$','packages/backups/test/venue-service-streams.test.ts'],{cwd:candidate,env,timeout:45000,maxBuffer:2*1024*1024})
    .then(r=>({code:0,output:r.stdout+r.stderr}),e=>({code:e.code,output:e.stdout+e.stderr}));
  }
  for(const c of cases){
   const path=join(candidate,c.path??streamPath),original=await readFile(path,'utf8');
   assert.equal(original.split(c.needle).length,2,c.name+' must target one guard');
   const before=await run(c);assert.equal(before.code,0,before.output);assert.match(before.output,new RegExp('# pass '+c.count+'\\b'));assert.match(before.output,/# fail 0\b/);
   try{
    await writeFile(path,original.replace(c.needle,c.replacement));
    const omitted=await run(c);assert.equal(omitted.code,1,omitted.output);assert.match(omitted.output,new RegExp('# fail '+c.count+'\\b'));
    assert.ok(omitted.output.includes(c.expected),omitted.output);
   }finally{await writeFile(path,original);}
   const restored=await run(c);assert.equal(restored.code,0,restored.output);assert.match(restored.output,new RegExp('# pass '+c.count+'\\b'));assert.match(restored.output,/# fail 0\b/);
   console.log('VENUE_STREAM_GUARD_DETECTED '+c.name);
  }
 }finally{await rm(scratch,{recursive:true,force:true});}
});
