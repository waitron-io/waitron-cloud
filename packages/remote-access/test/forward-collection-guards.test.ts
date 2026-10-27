import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {before,after,test} from 'node:test';

const root=fileURLToPath(new URL('../../../',import.meta.url));let temporary:string,candidate:string;
before(async()=>{
 temporary=await mkdtemp(join(tmpdir(),'forward-guard-copy-'));candidate=join(temporary,'candidate');
 execFileSync('git',['clone','--quiet','--no-hardlinks',root,candidate],{timeout:30000,stdio:'pipe'});
 execFileSync('pnpm',['install','--frozen-lockfile','--offline'],{cwd:candidate,timeout:120000,stdio:'pipe'});
},{timeout:150000});
after(async()=>{if(temporary)await rm(temporary,{recursive:true,force:true});});
interface Fault {name:string;source:string;file:string;pattern:string;changes:[string,string][]}
const store='packages/remote-access/src/forward-observations.ts',collector='packages/remote-access/src/forward-report-collector.ts';
const observations='packages/remote-access/test/forward-observations.test.ts',collection='packages/remote-access/test/forward-report-collector.test.ts',retention='packages/remote-access/test/forward-report-retention.test.ts';
const faults:Fault[]=[
 {name:'signature',source:store,file:observations,pattern:'^wrong_signature_',changes:[
  ["verifyForwardReport(envelope,createPublicKey(initial.public_key),(await client.query('SELECT clock_timestamp() AS now')).rows[0].now.getTime())","JSON.parse(Buffer.from((envelope as any).payload,'base64url').toString())"],
  ['verifyForwardReport(envelope,createPublicKey(reporter.public_key),now.getTime())',"JSON.parse(Buffer.from((envelope as any).payload,'base64url').toString())"]]},
 {name:'country',source:store,file:observations,pattern:'^wrong_country_',changes:[["mapping.country!=='ES'||",''],['cell.country!==mapping.country||','']]},
 {name:'environment',source:store,file:observations,pattern:'^wrong_environment_',changes:[['cell.environment!==mapping.environment||','']]},
 {name:'generation',source:store,file:observations,pattern:'^wrong_generation_',changes:[['||Number(reporter.generation)!==report.generation',''],['&&Number(reporter.generation)===observation.generation','']]},
 {name:'revision',source:store,file:observations,pattern:'^wrong_revision_',changes:[['&&Number(route.revision)===observation.revision','']]},
 {name:'route binding',source:store,file:observations,pattern:'^wrong_binding_',changes:[['&&routeBinding(route as GatewayRoute)===observation.routeBinding','']]},
 {name:'manifest floor',source:store,file:observations,pattern:'^wrong_manifest-low_',changes:[['&&observation.manifestSequence>=Number(reporter.minimum_manifest_sequence)','']]},
 {name:'manifest ceiling',source:store,file:observations,pattern:'^wrong_manifest-high_',changes:[['&&observation.manifestSequence<=Number(cell.sequence)','']]},
 {name:'replay cursor',source:store,file:observations,pattern:'^signed current report',changes:[['||Number(reporter.last_sequence)>=report.sequence','']]},
 {name:'persistent budget',source:store,file:observations,pattern:'^simultaneous_new_old',changes:[['||reporter.next_accept_at>now','']]},
 {name:'observation ordering',source:store,file:observations,pattern:'^rollback_allows',changes:[['||(sameStream&&observation.observationSequence<=Number(prior.observation_sequence))','']]},
 {name:'observation time',source:store,file:observations,pattern:'^rollback_allows',changes:[['observation.observedAt<prior.observed_at.getTime()||','']]},
 {name:'expiry on read',source:store,file:retention,pattern:'^expiry_and_prune',changes:[['&&observation.expiresAt>now','']]},
 {name:'pruning',source:store,file:retention,pattern:'^expiry_and_prune',changes:[["return (await client.query('DELETE FROM remote_forward_observations WHERE venue_id=ANY($1::uuid[])',[rows.map(r=>r.venue_id)])).rowCount??0;",'return 0;']]},
 {name:'backup exclusion',source:'scripts/database-backup-policy.mjs',file:retention,pattern:'^logical_restore_',changes:[["['--exclude-table-data=*.remote_forward_observations']",'[]']]},
 {name:'exclusive certificate completion lock',source:'packages/remote-access/src/reconciler.ts',file:'packages/remote-access/test/reconciler.test.ts',pattern:'^reporting concurrent staff',changes:[["scope.kind==='route'?'SHARE':'UPDATE'","scope.kind==='route'?'SHARE':'SHARE'"]]},
 {name:'scheduling avoids installation locks',source:'packages/remote-access/src/reconciler.ts',file:'packages/remote-access/test/reconciler.test.ts',pattern:'^reporting certificate completion and scheduling',changes:[["OF i`:'';","OF i`:' FOR SHARE OF i';"]]},
 {name:'cell-scoped completion locks',source:'packages/remote-access/src/reconciler.ts',file:observations,pattern:'^reporting cell jobs',changes:[["cellId=scope?.kind==='route'?scope.targetId:null","cellId=null"]]},
 {name:'locked reporter signature',source:store,file:observations,pattern:'^signature is rechecked',changes:[['verifyForwardReport(envelope,createPublicKey(reporter.public_key),now.getTime())',"JSON.parse(Buffer.from((envelope as any).payload,'base64url').toString())"]]},
 {name:'successful prune before recovery ingestion',source:collector,file:collection,pattern:'^failed pruning',changes:[['if(this.#pruneFailed.has(id))throw unavailable();','']]},
 {name:'hard link refusal',source:collector,file:collection,pattern:'^collector refuses hard-link ',changes:[['||s.nlink!==1','']]},
 {name:'directory permissions',source:collector,file:collection,pattern:'^collector refuses directory-mode ',changes:[['||(s.mode&0o7777)!==0o2750','']]},
 {name:'directory symlink race',source:collector,file:collection,pattern:'^collector refuses directory-open ',changes:[['constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW','constants.O_RDONLY|constants.O_DIRECTORY']]},
 {name:'final real path',source:collector,file:collection,pattern:'^collector refuses post-read ',changes:[['||await realpath(mapping.file)!==mapping.file','']]},
 {name:'nonblocking file open',source:collector,file:collection,pattern:'^collector refuses fifo ',changes:[['|constants.O_NONBLOCK','']]},
 {name:'file permissions',source:collector,file:collection,pattern:'^collector refuses mode ',changes:[['||(s.mode&0o7777)!==0o640','']]},
 {name:'writer identity',source:collector,file:collection,pattern:'^collector refuses uid ',changes:[['s.uid!==mapping.writerUid||','']]},
 {name:'reader identity',source:collector,file:collection,pattern:'^collector refuses gid ',changes:[['s.gid!==mapping.readerGid||','']]},
 {name:'file size',source:collector,file:collection,pattern:'^collector refuses oversize ',changes:[['||s.size>262144',''],['size>262144||','']]},
];
for(const fault of faults)test(`${fault.source===collector?'native':'postgres'}: deleting ${fault.name} makes its original denial fail`,{timeout:150000},async()=>{
 const path=join(candidate,fault.source),original=await readFile(path,'utf8');let altered=original;
 const env={...process.env};delete env.NODE_TEST_CONTEXT;delete env.FORCE_COLOR;
 const run=()=>spawnSync(process.execPath,['--test','--test-reporter=tap','--test-timeout=30000','--test-name-pattern='+fault.pattern,fault.file],{cwd:candidate,env,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024});
 const control=run();assert.equal(control.status,0,control.stdout+control.stderr);assert.match(control.stdout,/# pass [1-9]\d*/);
 try{
  for(const [needle,replacement] of fault.changes){assert(altered.includes(needle),`missing guard: ${fault.name}`);altered=altered.replaceAll(needle,replacement);}
  await writeFile(path,altered);const broken=run();assert.equal(broken.status,1,broken.stdout+broken.stderr);assert.match(broken.stdout+broken.stderr,/AssertionError/);
 }finally{await writeFile(path,original);}
 const restored=run();assert.equal(restored.status,0,restored.stdout+restored.stderr);
});
