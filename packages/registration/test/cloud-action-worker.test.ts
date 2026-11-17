import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before,after,beforeEach,test} from 'node:test';
import {Pool} from 'pg';
import {createSession} from '@waitron-cloud/identity';
import {CloudActions,transaction} from '../src/index.ts';
import {migrate} from '../src/migrate.ts';
import {resetSchema} from './fixtures/reset-schema.ts';
import {openProofWindow} from './fixtures/action-proof.ts';
import {testOutbox} from './fixtures/delivery.ts';

if(!process.env.TEST_DATABASE_URL)throw Error('Run through scripts/test-postgres.mjs');
const schema=`action_worker_${randomUUID().replaceAll('-','')}`,operator=randomUUID();
const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,options:`-c search_path=${schema} -c statement_timeout=10000`});
let actor:Awaited<ReturnType<typeof createSession>>,actions:CloudActions;
const proposal={occurrence:'demo-failure-1',cell:'demo-cell',target:'demo-worker',actionId:'cloud_restart',proposal:'Restart failed demo worker in place',evidence:'demo-worker stopped:1'};
before(async()=>{await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);});
after(async()=>{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();});
beforeEach(async()=>{
 await resetSchema(pool);await pool.query('INSERT INTO cloud_accounts(id) VALUES($1)',[operator]);
 await pool.query("INSERT INTO cloud_credentials(account_id,email,password_hash,email_verified_at) VALUES($1,'operator@example.test','synthetic',clock_timestamp())",[operator]);
 actor=await transaction(pool,c=>createSession(c,operator));await openProofWindow(pool,actor.token);actions=new CloudActions(pool,operator,testOutbox);
});
async function api(){const value=await import('../src/cloud-action-worker.ts').catch(()=>({CloudActionWorker:undefined,cloudActionDemoEnabled:undefined}));assert.equal(typeof value.CloudActionWorker,'function','automatic demo worker missing');return value as typeof import('../src/cloud-action-worker.ts');}
async function propose(overrides={}){return actions.propose(actor.token,actor.csrfToken,{...proposal,...overrides});}
function executor(){
 const effects=new Map<string,string>();let calls=0;
 return {effects,get calls(){return calls;},
  eligible:async(request:{target:string;evidence:string})=>request.target==='demo-worker'&&request.evidence==='demo-worker stopped:1',
  restart:async(request:{effectId:string})=>{calls++;effects.set(request.effectId,'confirmed');},
  observe:async(effectId:string)=>effects.get(effectId)==='confirmed'?'confirmed' as const:'unknown' as const,
 };
}

test('demoModeOffByDefault: disabled and production modes cannot touch a target',async()=>{
 const {CloudActionWorker,cloudActionDemoEnabled}=await api();const effect=executor();await propose();
 assert.equal(cloudActionDemoEnabled({}),false);assert.equal(cloudActionDemoEnabled({CLOUD_ACTION_DEMO:'0'}),false);
 assert.throws(()=>cloudActionDemoEnabled({CLOUD_ACTION_DEMO:'yes'}),/demo/);
 assert.throws(()=>cloudActionDemoEnabled({CLOUD_ACTION_DEMO:'1',NODE_ENV:'production'}),/demo/);
 assert.equal(await new CloudActionWorker(pool,{executor:effect,operatorAccountId:operator}).runOnce(),false);
 assert.equal(effect.calls,0);assert.equal((await pool.query('SELECT dispatch_started_at FROM cloud_action_requests')).rows[0].dispatch_started_at,null);
});

test('automatic restart commits its identity before the effect and reports the observed result',async()=>{
 const {CloudActionWorker}=await api(),effect=executor(),request=await propose();
 const original=effect.restart;effect.restart=async value=>{
  assert.ok((await pool.query('SELECT dispatch_started_at FROM cloud_action_requests WHERE id=$1',[request.id])).rows[0].dispatch_started_at);
  assert.equal(value.effectId,request.effectId);await original(value);
 };
 const worker=new CloudActionWorker(pool,{demo:true,operatorAccountId:operator,executor:effect});
 assert.equal(await worker.runOnce(),true);assert.equal(await worker.runOnce(),false);assert.equal(effect.calls,1);
 assert.deepEqual((await pool.query('SELECT outcome FROM cloud_action_requests')).rows[0].outcome,{status:'confirmed'});
 const read=await actions.read(actor.token);assert.deepEqual(read.requests[0]?.outcome,{status:'confirmed'});
});

test('changedPolicyBlocksDispatch and real targets remain unavailable',async()=>{
 const {CloudActionWorker}=await api(),effect=executor();
 await propose({actionId:'machine_replace'});await propose({occurrence:'other',target:'real-machine'});
 // This is a request admitted under an older policy, not permission to change the catalogue.
 const {proposeCloudAction}=await import('../src/cloud-action-store.ts');
 await transaction(pool,c=>proposeCloudAction(c,{...proposal,occurrence:'older-policy'},'ask-first',operator,testOutbox));
 const worker=new CloudActionWorker(pool,{demo:true,operatorAccountId:operator,executor:effect});
 assert.equal(await worker.runOnce(),false);assert.equal(effect.calls,0);
 assert.equal((await pool.query('SELECT count(*) FROM cloud_action_requests WHERE dispatch_started_at IS NOT NULL')).rows[0].count,'0');
});

test('changed evidence and a rejected or superseded request cannot restart a workload',async()=>{
 const {CloudActionWorker}=await api(),effect=executor(),first=await propose();
 await propose({evidence:'workload recovered'});
 const rejected=await propose({occurrence:'rejected'});await actions.decide(actor.token,actor.csrfToken,{requestId:rejected.id,version:1,decision:'rejected'});
 assert.equal((await actions.read(actor.token)).requests.find(r=>r.id===first.id)?.state,'superseded');
 assert.equal(await new CloudActionWorker(pool,{demo:true,operatorAccountId:operator,executor:effect}).runOnce(),false);assert.equal(effect.calls,0);
});

test('twoWorkersOneEffect: concurrent pollers never issue the same restart twice',async()=>{
 const {CloudActionWorker}=await api(),effect=executor();await propose();
 const options={demo:true,operatorAccountId:operator,executor:effect};
 await Promise.all([new CloudActionWorker(pool,options).runOnce(),new CloudActionWorker(pool,options).runOnce()]);
 assert.equal(effect.calls,1);assert.equal((await pool.query("SELECT count(*) FROM cloud_action_requests WHERE outcome->>'status'='confirmed'")).rows[0].count,'1');
});

test('oneDisruptionPerCell: an unresolved effect blocks another restart in its cell',async()=>{
 const {CloudActionWorker}=await api(),effect=executor();await propose();await propose({occurrence:'second'});
 effect.restart=async()=>{throw Error('lost synthetic reply');};
 const worker=new CloudActionWorker(pool,{demo:true,operatorAccountId:operator,executor:effect});
 await assert.rejects(worker.runOnce(),/lost synthetic reply/);assert.equal(await worker.runOnce(),false);
 assert.equal((await pool.query('SELECT count(*) FROM cloud_action_requests WHERE dispatch_started_at IS NOT NULL')).rows[0].count,'1');
 const row=(await pool.query('SELECT effect_id FROM cloud_action_requests WHERE dispatch_started_at IS NOT NULL')).rows[0];
 effect.effects.set(row.effect_id,'confirmed');assert.equal(await worker.runOnce(),true);
 assert.equal((await pool.query('SELECT outcome FROM cloud_action_requests WHERE effect_id=$1',[row.effect_id])).rows[0].outcome.status,'confirmed');
});

test('operator authority is checked again after the target inspection waits',async()=>{
 const {CloudActionWorker}=await api(),effect=executor();await propose();
 effect.eligible=async()=>{await pool.query('UPDATE cloud_accounts SET disabled_at=clock_timestamp() WHERE id=$1',[operator]);return true;};
 const worker=new CloudActionWorker(pool,{demo:true,operatorAccountId:operator,executor:effect});
 assert.equal(await worker.runOnce(),false);assert.equal(effect.calls,0);
 assert.equal((await pool.query('SELECT dispatch_started_at FROM cloud_action_requests')).rows[0].dispatch_started_at,null);
});

test('LAN demo restarts its owned child process and retains its independent outcome',async t=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const directory=await mkdtemp(join(tmpdir(),'cloud-actions-demo-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const modulePath=new URL('../../../deploy/test-cloud/cloud-action-demo.mjs',import.meta.url).href;
 const demoModule=await import(modulePath).catch(()=>({openSyntheticWorkload:undefined}));
 assert.equal(typeof demoModule.openSyntheticWorkload,'function','LAN owned workload missing');
 const workload=await demoModule.openSyntheticWorkload(directory,{CLOUD_ACTION_DEMO:'1'});t.after(()=>workload.close());
 const before=await workload.health();assert.equal(before.healthy,true);
 const input=await workload.fail();assert.equal((await workload.health()).healthy,false);
 const request=await propose(input);
 const {CloudActionWorker}=await api();
 assert.equal(await new CloudActionWorker(pool,{demo:true,operatorAccountId:operator,executor:workload}).runOnce(),true);
 const after=await workload.health();assert.equal(after.healthy,true);assert.notEqual(after.pid,before.pid);
 assert.equal(await workload.observe(request.effectId),'confirmed');
 assert.equal(await workload.eligible({...request,target:'unowned-worker'}),false);
 await workload.close();const reopened=await demoModule.openSyntheticWorkload(directory,{CLOUD_ACTION_DEMO:'1'});
 try{assert.equal(await reopened.observe(request.effectId),'confirmed');}finally{await reopened.close();}
});

test('demo CLI refuses default mode and checks the complete schema before queuing a synthetic failure',async t=>{
 const {mkdtemp,rm,readFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{spawn}=await import('node:child_process');
 const directory=await mkdtemp(join(tmpdir(),'cloud-action-cli-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const cli=new URL('../src/cloud-action-cli.ts',import.meta.url).pathname;
 const invoke=(enabled:boolean)=>new Promise<{code:number|null;stderr:string}>((resolve,reject)=>{
  const child=spawn(process.execPath,[cli,'--fail'],{env:{PATH:process.env.PATH,DATABASE_URL:process.env.TEST_DATABASE_URL,PGOPTIONS:`-c search_path=${schema}`,CLOUD_ACTION_DEMO:enabled?'1':'0',CLOUD_ACTION_DEMO_DIR:directory},stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});child.once('error',reject);child.once('close',code=>resolve({code,stderr}));
 });
 const disabled=await invoke(false);assert.equal(disabled.code,1);assert.match(disabled.stderr,/Synthetic action command refused/);
 await assert.rejects(readFile(join(directory,'fail')),/ENOENT/);
 const enabled=await invoke(true);assert.equal(enabled.code,0,enabled.stderr);assert.equal(await readFile(join(directory,'fail'),'utf8'),'fail');
 await rm(join(directory,'fail'));await pool.query("INSERT INTO schema_migrations(name,digest) VALUES('future.sql','synthetic')");
 assert.equal((await invoke(true)).code,1);await assert.rejects(readFile(join(directory,'fail')),/ENOENT/);
});

test('account-side demo loop turns a requested failure into a saved automatic report',async t=>{
 const {mkdtemp,rm,writeFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{setTimeout:delay}=await import('node:timers/promises');
 const directory=await mkdtemp(join(tmpdir(),'cloud-action-loop-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const modulePath=new URL('../../../deploy/test-cloud/cloud-action-demo.mjs',import.meta.url).href;
 const {startCloudActionDemo}=await import(modulePath);
 const demo=await startCloudActionDemo({pool,outbox:testOutbox,operatorAccountId:operator,directory,environment:{CLOUD_ACTION_DEMO:'1'}});t.after(()=>demo.close());
 await writeFile(join(directory,'fail'),'fail');
 const deadline=Date.now()+8000;let rows:any[]=[];
 while(Date.now()<deadline){rows=(await pool.query('SELECT * FROM cloud_action_requests')).rows;if(rows[0]?.outcome)break;await delay(20);}
 assert.equal(rows.length,1);assert.equal(rows[0].action_id,'cloud_restart');assert.equal(rows[0].cell,'demo-cell');
 assert.deepEqual(rows[0].outcome,{status:'confirmed'});assert.ok(rows[0].dispatch_started_at);
 assert.equal((await pool.query("SELECT count(*) FROM email_outbox WHERE kind='operator_notice'")).rows[0].count,'1');
});
