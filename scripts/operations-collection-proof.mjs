import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';

const output=resolve(process.argv[2]??'/tmp/cloud-operations-collection-receipt.json');
if(process.argv.length>3||!process.env.NODE_AUTH_TOKEN)throw Error('Set NODE_AUTH_TOKEN to a package-read token');
const id=randomUUID().slice(0,8),project=`cloud-operations-proof-${id}`,tag=`operations-proof-${id}`;
const env={...process.env,LOCAL_STACK_IMAGE_TAG:tag,LOCAL_STACK_POSTGRES_PORT:'0',LOCAL_STACK_ACCOUNT_PORT:'0',LOCAL_STACK_OPERATIONS_PORT:'0',CLOUD_OPERATIONS_INTERVAL_MS:'1000'};
function run(args,capture=false){return execFileSync('docker',args,{env,encoding:'utf8',timeout:600000,stdio:capture?['ignore','pipe','pipe']:'inherit'})?.trim()??'';}
const compose=(...args)=>run(['compose','-p',project,'--profile','operations',...args]);
const capture=(...args)=>run(['compose','-p',project,'--profile','operations',...args],true);
const sql=query=>capture('exec','-T','postgres','psql','-U','cloud','-d','cloud','-Atc',query);
let origin;
async function status(){const response=await fetch(`${origin}/status`,{signal:AbortSignal.timeout(2000)});return {http:response.status,...await response.json()};}
async function until(check){const end=Date.now()+45000;while(Date.now()<end){try{const value=await status();if(check(value))return value;}catch{}await delay(200);}throw Error('collection proof timed out');}
const metrics=async()=>await(await fetch(`${origin}/metrics`,{signal:AbortSignal.timeout(2000)})).text();
const fresh=()=>sql('UPDATE usage_reconciliation_sources SET last_attempted_at=clock_timestamp(),caught_up_at=clock_timestamp()');
let receipt,error;
try{
 compose('build','bootstrap');compose('up','-d','--no-build','operations-collector');
 origin=`http://${capture('port','operations-collector','9091')}`;
 const initial=await until(value=>value.snapshot?.state==='degraded');
 fresh();const healthy=await until(value=>value.snapshot?.ready===true);assert.equal(healthy.http,200);
 const healthyMetrics=await metrics();assert.match(healthyMetrics,/waitron_cloud_operations_ready 1\n/);
 sql("UPDATE usage_reconciliation_sources SET caught_up_at=clock_timestamp()-interval '10 minutes'");
 const degraded=await until(value=>value.snapshot?.components.usage.code==='stale');assert.equal(degraded.snapshot.ready,false);assert.equal(degraded.http,200);
 const degradedMetrics=await metrics();assert.match(degradedMetrics,/waitron_cloud_operations_ready 0\n/);
 const labels=new Set([...healthyMetrics.matchAll(/\{([^}]+)\}/g),...degradedMetrics.matchAll(/\{([^}]+)\}/g)].map(match=>match[1]));
 assert(labels.size<80);for(const label of labels)assert.match(label,/^(component="[a-z_]+",state="(?:ready|degraded|unready|unknown)",code="[a-z_]+"|status="[a-z_]+")$/);
 const migration=sql('SELECT name FROM schema_migrations ORDER BY name LIMIT 1');
 const digest=sql(`SELECT digest FROM schema_migrations WHERE name='${migration}'`);
 sql(`UPDATE schema_migrations SET digest=repeat('0',64) WHERE name='${migration}'`);
 const incompatible=await until(value=>value.collection.state==='failed');assert.equal(incompatible.http,503);assert.equal(incompatible.snapshot,null);
 assert.doesNotMatch(await metrics(),/waitron_cloud_operations_ready /);
 await delay(1200);const stillFailed=await status();assert.equal(stillFailed.collection.succeededAt,incompatible.collection.succeededAt);
 sql(`UPDATE schema_migrations SET digest='${digest}' WHERE name='${migration}'`);fresh();
 const schemaRecovered=await until(value=>value.snapshot?.ready===true);
 compose('stop','postgres');
 const databaseLost=await until(value=>value.collection.state==='failed');assert.equal(databaseLost.http,503);assert.equal(databaseLost.snapshot,null);
 assert.doesNotMatch(await metrics(),/waitron_cloud_operations_ready /);
 compose('start','postgres');const recovered=await until(value=>value.snapshot?.ready===true);
 assert(Date.parse(recovered.collection.succeededAt)>Date.parse(schemaRecovered.collection.succeededAt));
 // The exact collector child environment must refuse a write, despite using the local runtime login.
 const readonly=capture('exec','-T','-e','PGOPTIONS=-c default_transaction_read_only=on','operations-collector','node','--input-type=module','-e',
  `import {createRequire} from 'node:module';import {loadRuntime,runtimeEnvironment} from './deploy/local-stack/runtime.mjs';const {Pool}=createRequire(new URL('./packages/operations/package.json',import.meta.url))('pg');const {DATABASE_URL}=runtimeEnvironment('usage',await loadRuntime('/run/local-stack'));const pool=new Pool({connectionString:DATABASE_URL});try{await pool.query('UPDATE usage_reconciliation_sources SET caught_up_at=clock_timestamp()');throw Error('write accepted');}catch(error){if(error.code!=='25006')throw error;console.log('read_only_refused');}finally{await pool.end();}`);
 assert.equal(readonly,'read_only_refused');
 const beforeRestart=Date.now();compose('restart','operations-collector');
 const restarted=await until(value=>value.snapshot?.ready&&Date.parse(value.collection.succeededAt)>beforeRestart);
 const node=capture('ps','-q','operations-collector');compose('stop','operations-collector');
 const stopped=JSON.parse(run(['inspect',node],true))[0].State;assert.equal(stopped.ExitCode,0);assert.equal(stopped.OOMKilled,false);
 receipt={version:1,head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim()!=='',project,intervalMs:1000,initial,healthy,degraded,incompatible,databaseLost,recovered,restarted,metricLabelSets:labels.size,readonly,stopExitCode:stopped.ExitCode};
}catch(cause){error=cause;try{compose('logs','--no-color','operations-collector','account');}catch{}}
finally{
 try{compose('down','--volumes','--remove-orphans');}catch(cause){error??=cause;}
 try{run(['image','rm',`waitron-cloud-local-stack:${tag}`],true);}catch(cause){error??=cause;}
}
const cleanup={};
for(const [kind,args] of Object.entries({containers:['ps','-aq'],volumes:['volume','ls','-q'],networks:['network','ls','-q']}))cleanup[kind]=run([...args,'--filter',`label=com.docker.compose.project=${project}`],true).split('\n').filter(Boolean).length;
if(error)throw new Error(`Operations collection proof failed; cleanup: ${JSON.stringify(cleanup)}`,{cause:error});
assert.deepEqual(cleanup,{containers:0,volumes:0,networks:0});receipt.cleanup=cleanup;
await writeFile(output,JSON.stringify(receipt,null,2)+'\n');console.log(`PASS operations collection proof: ${output}`);
