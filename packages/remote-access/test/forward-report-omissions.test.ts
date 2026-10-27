import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {before,after,test} from 'node:test';

const root=fileURLToPath(new URL('../../../',import.meta.url));let temporary:string,candidate:string;
before(async()=>{
 temporary=await mkdtemp(join(tmpdir(),'forward-display-omissions-'));candidate=join(temporary,'candidate');
 execFileSync('git',['clone','--quiet','--no-hardlinks',root,candidate],{timeout:30000,stdio:'pipe'});
 // Include the complete candidate, including uncommitted test additions in a driver run.
 const patch=execFileSync('git',['diff','--binary','HEAD'],{cwd:root,maxBuffer:8*1024*1024});
 if(patch.length)execFileSync('git',['apply','--binary','-'],{cwd:candidate,input:patch});
 execFileSync('pnpm',['install','--frozen-lockfile','--offline'],{cwd:candidate,timeout:120000,stdio:'pipe'});
},{timeout:150000});
after(async()=>{if(temporary)await rm(temporary,{recursive:true,force:true});});
interface Fault {name:string;source:string;file:string;pattern:string;changes:[string,string][];postgres?:boolean}
const faults:Fault[]=[
 {name:'report cell binding',source:'packages/remote-access/src/forward-report.ts',file:'packages/remote-access/test/forward-report.test.ts',pattern:'^report keys,',changes:[['entry.cellId!==value.cellId||','']]},
 {name:'installation identity',source:'packages/remote-access/src/forward-report.ts',file:'packages/remote-access/test/forward-report.test.ts',pattern:'^report keys,',changes:[['!isUuid(entry.installationId)||','']]},
 {name:'venue identity',source:'packages/remote-access/src/forward-report.ts',file:'packages/remote-access/test/forward-report.test.ts',pattern:'^report keys,',changes:[['!isUuid(entry.venueId)||','']]},
 {name:'private view projection',source:'packages/remote-access/src/forward-observations.ts',file:'packages/account-http/test/forwarding-causes.test.ts',pattern:'^owner status returns exactly',changes:[['?{category:observation.category,observedAt:row.observed_at.toISOString(),expiresAt:row.expires_at.toISOString()}:null','?row:null']],postgres:true},
 {name:'policy-before-installation order',source:'packages/account-http/src/remote-access.ts',file:'packages/account-http/test/forwarding-causes.test.ts',pattern:'^existing-plan status locks',changes:[["  await client.query('SELECT o.id FROM organisations o JOIN venues v ON v.organisation_id=o.id WHERE v.id=$1 ORDER BY o.id FOR SHARE OF o',[binding.venue_id]);",'']],postgres:true},
 {name:'report signature',source:'packages/remote-access/src/forward-report.ts',file:'packages/remote-access/test/forward-report.test.ts',pattern:'^report signature,',changes:[['||!verify(null,bytes,key,signature)','']]},
 {name:'writer queue bound',source:'packages/remote-access/src/forward-report-writer.ts',file:'packages/remote-access/test/forward-report-writer.test.ts',pattern:'^sixty_four_routes',changes:[['if(!entry&&this.#entries.size>=64)return none;','']]},
 {name:'writer cadence',source:'packages/remote-access/src/forward-report-writer.ts',file:'packages/remote-access/test/forward-report-writer.test.ts',pattern:'^sixty_four_routes',changes:[['||now-this.#lastPublication<30000','']]},
 {name:'completion ordering',source:'packages/remote-access/src/forward-report-writer.ts',file:'packages/remote-access/test/forward-report-writer.test.ts',pattern:'^new_success_beats',changes:[['||ordinal<=slot.completed','']]},
 {name:'final session check',source:'packages/account-http/src/remote-access.ts',file:'packages/account-http/test/forwarding-causes.test.ts',pattern:'^session expiry while the private',changes:[['  await authorize(client);\n  const deadline=','  const deadline=']],postgres:true},
 {name:'owner requirement',source:'packages/account-http/src/remote-access.ts',file:'packages/account-http/test/forwarding-causes.test.ts',pattern:'^status refuses foreign',changes:[[' AND m.is_owner FOR SHARE OF m',' FOR SHARE OF m']],postgres:true},
 {name:'server current-binding read',source:'packages/account-http/src/remote-access.ts',file:'packages/account-http/test/forwarding-causes.test.ts',pattern:'^owner status erases revision',changes:[['new ForwardObservationStore(pool,options.planMode).readCurrent(client,id)',"client.query('SELECT category,observed_at,expires_at FROM remote_forward_observations WHERE installation_id=$1',[id]).then(r=>r.rows[0]?{category:r.rows[0].category,observedAt:r.rows[0].observed_at.toISOString(),expiresAt:r.rows[0].expires_at.toISOString()}:null)"]],postgres:true},
];
for(const fault of faults)test(`${fault.postgres?'postgres':'native'}: deleting ${fault.name} makes its owning assertion fail`,{timeout:150000},async()=>{
 const path=join(candidate,fault.source),original=await readFile(path,'utf8');let altered=original;
 const env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.FORCE_COLOR;delete env.FORWARDING_RECEIPT_DIR;
 const run=()=>spawnSync(process.execPath,['--test','--test-reporter=tap','--test-timeout=120000','--test-name-pattern='+fault.pattern,fault.file],{cwd:candidate,env,encoding:'utf8',timeout:130000,maxBuffer:4*1024*1024});
 const control=run();assert.equal(control.status,0,control.stdout+control.stderr);assert.match(control.stdout,/# pass [1-9]\d*/);
 try{
  for(const [needle,replacement] of fault.changes){assert(altered.includes(needle),`missing guard: ${fault.name}`);altered=altered.replaceAll(needle,replacement);}
  await writeFile(path,altered);const broken=run();assert.equal(broken.status,1,broken.stdout+broken.stderr);assert.match(broken.stdout+broken.stderr,/AssertionError/);
 }finally{await writeFile(path,original);}
 const restored=run();assert.equal(restored.status,0,restored.stdout+restored.stderr);
});
