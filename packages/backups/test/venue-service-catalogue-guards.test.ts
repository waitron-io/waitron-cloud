import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {promisify} from 'node:util';
const exec=promisify(execFile);

// A removed guard must fail its behavioral assertion, then pass again after restoration.
test('snapshot venue guards detect independent omissions',{timeout:180000},async()=>{
 const root=fileURLToPath(new URL('../../../',import.meta.url));
 const scratch=await mkdtemp(join(tmpdir(),'venue-catalogue-guards-')),candidate=join(scratch,'candidate');
 try{
  await exec('git',['clone','--quiet','--no-hardlinks',root,candidate],{timeout:10000});
  await exec('pnpm',['install','--frozen-lockfile'],{cwd:candidate,timeout:20000});
  const path=join(candidate,'packages/backups/src/catalogue.ts'),original=await readFile(path,'utf8');
  const cases=[
   {name:'current authority',needle:"if (mode === 'test-venue-levels') return await requireVenueService(client,venueId,'retained_snapshots',mode);",
    replacement:"if (mode === 'test-venue-levels') return;",pattern:'venue snapshot schema failure never creates keys or storage state',expected:'Missing expected rejection'},
   {name:'explicit reprovision',needle:"if((this.#planMode==='test-free-paid'||this.#planMode==='test-venue-levels') && setup?.state==='unconfigured') {",
    replacement:"if(this.#planMode==='test-free-paid' && setup?.state==='unconfigured') {",pattern:'venue snapshot explicit same location reprovision keeps keys and advances setup once',expected:'unconfigured'},
   {name:'retained expiry admission',needle:"if(mode==='test-venue-levels')return (await readVenuePermissions(client,venueId,mode)).level!=='registered';",
    replacement:"if(mode==='test-venue-levels')return true;",pattern:'venue level one pauses retained expiry but cleans only abandoned staging',expected:'null'},
   {name:'deletion exclusion',needle:"if(this.#planMode==='test-free-paid'||this.#planMode==='test-venue-levels') {",
    replacement:"if(this.#planMode==='test-free-paid') {",pattern:'venue snapshot admitted deletion finishes before downgrade commits',expected:'downgrade must wait for admitted deletion'},
   {name:'post-wait installation scope',needle:"if(mode==='test-venue-levels'&&row.venue_id!==initial.venue_id)backupFail('permission_denied');",
    replacement:'',pattern:'venue snapshot policy wait refuses a changed installation venue',expected:'Missing expected rejection'},
   {name:'object wait releases authority',needle:"if(this.#planMode==='test-venue-levels')return this.#publishVenue(installationId,id,m,fence);",
    replacement:'',pattern:'venue snapshot object wait rejects round-trip without publishing',expected:'object work must release venue authority and installation locks'},
   {name:'post-wait generation',needle:"if(permission.revision!==first.generation)backupFail('conflict');",
    replacement:'',pattern:'venue snapshot object wait rejects round-trip without publishing',expected:'Missing expected rejection'},
   {name:'post-wait installation key',needle:"if(install.public_key!==first.publicKey)backupFail('conflict');",
    replacement:'',pattern:'venue snapshot object wait rejects key-change without publishing',expected:'Missing expected rejection'},
   {name:'post-wait location',needle:"if(l.endpoint!==first.location.endpoint||l.bucket!==first.location.bucket||l.region!==first.location.region)backupFail('conflict');",
    replacement:'',pattern:'venue snapshot object wait rejects location-change without publishing',expected:'Missing expected rejection'},
   {name:'post-wait capture expiry',needle:"if(latest.expired)backupFail('capture_expired');",
    replacement:'',pattern:'venue snapshot object wait rejects capture-expiry without publishing',expected:'Missing expected rejection'},
   {name:'post-wait revocation',needle:'if (row.revoked_at) backupFail("revoked");',
    replacement:'',pattern:'venue snapshot object wait rejects revocation without publishing',expected:'Missing expected rejection'},
   {name:'canonical object serialization',needle:"await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[lock]);",
    replacement:'',pattern:'venue concurrent snapshot publications keep the winning object and metadata together',expected:'a refused copy must never overwrite the admitted archive'},
   {name:'successful publication releases capture',needle:"if(!discard)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[lock]);",
    replacement:'if(false){}',pattern:'venue concurrent snapshot publications keep the winning object and metadata together',expected:'backup.conflict'},
   {name:'failed publication releases capture',needle:'client.release(discard);',replacement:'client.release(false);',
    pattern:'venue failed snapshot publication releases its capture for another publisher',expected:'a failed publication must release its capture lease'},
  ];
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  async function run(pattern:string){
   return exec(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^'+pattern+'$','test/venue-service-backups.test.ts'],
    {cwd:join(candidate,'packages/backups'),env,timeout:20000,maxBuffer:2*1024*1024})
    .then(r=>({code:0,output:r.stdout+r.stderr}),e=>({code:e.code,output:e.stdout+e.stderr}));
  }
  for(const c of cases){
   assert.equal(original.split(c.needle).length,2,c.name+' must target one guard');
   const before=await run(c.pattern);assert.equal(before.code,0,before.output);assert.match(before.output,/# pass 1\b/);assert.match(before.output,/# fail 0\b/);assert.match(before.output,/# skipped 0\b/);
   try{
    await writeFile(path,original.replace(c.needle,c.replacement));
    const omitted=await run(c.pattern);assert.equal(omitted.code,1,omitted.output);assert.match(omitted.output,/# fail 1\b/);
    assert.match(omitted.output,/AssertionError|ERR_ASSERTION/);assert.ok(omitted.output.includes(c.expected),omitted.output);assert.ok(omitted.output.includes(c.pattern));
   }finally{await writeFile(path,original);}
   const restored=await run(c.pattern);assert.equal(restored.code,0,restored.output);assert.match(restored.output,/# pass 1\b/);assert.match(restored.output,/# skipped 0\b/);
   console.log('VENUE_CATALOGUE_GUARD_DETECTED '+c.name);
  }
 }finally{await rm(scratch,{recursive:true,force:true});}
});
