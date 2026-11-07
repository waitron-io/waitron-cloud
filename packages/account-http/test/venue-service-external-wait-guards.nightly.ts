import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {promisify} from 'node:util';
const exec=promisify(execFile);

// Each retained identity component must prevent publication after an external wait.
test('external remote waits detect four independent identity omissions',{timeout:180000},async()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url)),scratch=await mkdtemp(join(tmpdir(),'venue-external-wait-guards-')),candidate=join(scratch,'candidate');
 try{
  await exec('git',['clone','--quiet','--no-hardlinks',root,candidate],{timeout:10000});
  await exec('pnpm',['install','--frozen-lockfile'],{cwd:candidate,timeout:20000});
  const path=join(candidate,'packages/remote-access/src/placement.ts'),original=await readFile(path,'utf8');
  const binding="...(mode==='test-venue-levels'?{binding:{venueId:row.installation_venue_id,publicKey:row.public_key}}:{})";
  const cases=[
   {name:'DNS original venue',needle:'row.venue_id!==admitted.binding.venueId||',replacement:'',pattern:'venue direct DNS wait refuses changed venue without hostname writes'},
   {name:'DNS original key',needle:'||row.public_key!==admitted.binding.publicKey',replacement:'',pattern:'venue direct DNS wait refuses changed key without hostname writes'},
   {name:'certificate original venue',needle:binding,replacement:binding.replace('venueId:row.installation_venue_id',"venueId:''"),pattern:'venue direct certificate publication refuses changed venue after issuance'},
   {name:'certificate original key',needle:binding,replacement:binding.replace('publicKey:row.public_key',"publicKey:''"),pattern:'venue direct certificate publication refuses changed key after issuance'},
  ];
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  async function run(pattern:string){
   return exec(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^'+pattern+'$','test/venue-service-direct-waits.test.ts'],{cwd:join(candidate,'packages/remote-access'),env,timeout:25000,maxBuffer:2*1024*1024})
    .then(r=>({code:0,output:r.stdout+r.stderr}),e=>({code:e.code,output:e.stdout+e.stderr}));
  }
  for(const c of cases){
   assert.equal(original.split(c.needle).length,2,c.name+' must target one guard');
   const before=await run(c.pattern);assert.equal(before.code,0,before.output);assert.match(before.output,/# pass 1\b/);assert.match(before.output,/# fail 0\b/);
   try{
    await writeFile(path,original.replace(c.needle,c.replacement));const omitted=await run(c.pattern);
    assert.equal(omitted.code,1,omitted.output);assert.match(omitted.output,/# fail 1\b/);assert.match(omitted.output,/AssertionError|ERR_ASSERTION/);assert.match(omitted.output,/Missing expected rejection/);
   }finally{await writeFile(path,original);}
   const restored=await run(c.pattern);assert.equal(restored.code,0,restored.output);assert.match(restored.output,/# pass 1\b/);assert.match(restored.output,/# fail 0\b/);
   console.log('VENUE_EXTERNAL_WAIT_GUARD_DETECTED '+c.name);
  }
 }finally{await rm(scratch,{recursive:true,force:true});}
});
