import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import {createLeaseIssuer} from '@waitron-cloud/registration';
import {database,connectedVenue} from './fixtures.ts';
let db:Awaited<ReturnType<typeof database>>;
const origin='https://cloud.example.test',issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
before(async()=>{db=await database();});after(async()=>db?.close());
const refusedBy=(name:string)=>(error:unknown)=>{assert.equal((error as {constraint?:string}).constraint,name,String(error));return true;};
const job=(v:{venueId:string;installationId:string},state='queued')=>db.pool.query(`INSERT INTO translation_jobs
 (id,installation_id,venue_id,operation_id,job_sha256,job_bytes,state,total,provider,model,prompt_version,finished_at)
 VALUES($1,$2,$3,$4,$5,10,$6,1,'openai','gpt-6-luna','translate-all-v1',CASE WHEN $6 IN ('queued','running') THEN NULL ELSE clock_timestamp() END)`,
 [randomUUID(),v.installationId,v.venueId,randomUUID(),'a'.repeat(64),state]);
test('the seeded policy and price are the values the plan derives',async()=>{
 assert.deepEqual((await db.pool.query('SELECT monthly_cap_micro_usd::text,estimate_micro_usd_per_item::text FROM translation_policy')).rows,[{monthly_cap_micro_usd:'5000000',estimate_micro_usd_per_item:'146'}]);
 assert.deepEqual((await db.pool.query("SELECT provider,input_micro_usd_per_million::text,output_micro_usd_per_million::text FROM translation_prices WHERE model='gpt-6-luna'")).rows,
  [{provider:'openai',input_micro_usd_per_million:'100000',output_micro_usd_per_million:'500000'}]);
 await assert.rejects(db.pool.query('INSERT INTO translation_policy VALUES(false,1,1)'),refusedBy('translation_policy_singleton_check'));
 await assert.rejects(db.pool.query('INSERT INTO translation_policy VALUES(true,1,1)'),refusedBy('translation_policy_pkey'));
});
test('a venue holds one open job at a time, and finished ones do not count',async()=>{
 const v=await connectedVenue(db,issuer,origin);
 await job(v);await assert.rejects(job(v),refusedBy('translation_jobs_one_open_idx'));
 await job(v,'done');await job(v,'expired');
});
test('a partly done or failed job carries a reason from its own list',async()=>{
 const v=await connectedVenue(db,issuer,origin);
 const finished=(state:string,reason:string|null)=>db.pool.query(`INSERT INTO translation_jobs
  (id,installation_id,venue_id,operation_id,job_sha256,job_bytes,state,reason,total,provider,model,prompt_version,finished_at)
  VALUES($1,$2,$3,$4,$5,10,$6,$7,1,'openai','gpt-6-luna','translate-all-v1',clock_timestamp())`,[randomUUID(),v.installationId,v.venueId,randomUUID(),'a'.repeat(64),state,reason]);
 await finished('partly_done','limit_reached');await finished('partly_done','provider_failed');
 await finished('failed','provider_unavailable');await finished('failed','consent_required');await finished('failed','limit_reached');
 for(const [state,reason,rule] of [
  ['partly_done',null,'translation_jobs_reason_required_check'],['failed',null,'translation_jobs_reason_required_check'],
  ['partly_done','provider_unavailable','translation_jobs_partly_done_reason_check'],['failed','provider_failed','translation_jobs_failed_reason_check'],
  ['done','limit_reached','translation_jobs_reason_state_check'],['expired','not_a_reason','translation_jobs_reason_check'],
 ] as const)await assert.rejects(finished(state,reason),refusedBy(rule));
 await assert.rejects(db.pool.query(`INSERT INTO translation_jobs(id,installation_id,venue_id,operation_id,job_sha256,job_bytes,state,total,provider,model,prompt_version)
  VALUES($1,$2,$3,$4,$5,10,'done',1,'openai','gpt-6-luna','translate-all-v1')`,[randomUUID(),v.installationId,v.venueId,randomUUID(),'a'.repeat(64)]),refusedBy('translation_jobs_finished_at_check'));
});
test('the fourth service name is accepted and an unknown one is not',async()=>{
 const v=await connectedVenue(db,issuer,origin);
 // Registration already creates the translation row, so the fixture uses an upsert.
 await db.pool.query(`INSERT INTO installation_services(installation_id,service,state) VALUES($1,'content_translation','ready')
  ON CONFLICT (installation_id,service) DO UPDATE SET state='ready'`,[v.installationId]);
 await assert.rejects(db.pool.query("INSERT INTO installation_services(installation_id,service) VALUES($1,'bogus')",[v.installationId]),refusedBy('installation_services_service_check'));
});
test('usage events accept the translation measures with any positive quantity',async()=>{
 const v=await connectedVenue(db,issuer,origin);
 const insert=(type:string,quantity:number,kind:string)=>db.pool.query(`INSERT INTO usage_events(organisation_id,venue_id,event_type,quantity,source_kind,source_reference,occurred_at)
  VALUES($1,$2,$3,$4,$5,$6,clock_timestamp())`,[v.organisationId,v.venueId,type,quantity,kind,randomUUID()]);
 await insert('translation.cost_micro_usd',731,'translation_job');
 await assert.rejects(insert('translation.cost_micro_usd',5,'backup_point'),refusedBy('usage_events_source_match_check'));
 await assert.rejects(insert('operation.monitoring_probe',2,'monitoring_probe'),refusedBy('usage_events_unit_quantity_check'));
 await assert.rejects(insert('translation.unknown',1,'translation_job'),refusedBy('usage_events_event_type_check'));
});
test('a consent names exactly the three providers, and a venue holds one current consent',async()=>{
 const v=await connectedVenue(db,issuer,origin);
 const insert=(providers:string[])=>db.pool.query(`INSERT INTO translation_consents(id,venue_id,organisation_id,account_id,consent_version,providers)
  VALUES($1,$2,$3,$4,'providers-2026-10-14',$5)`,[randomUUID(),v.venueId,v.organisationId,v.accountId,providers]);
 await assert.rejects(insert(['openai']),refusedBy('translation_consents_providers_check'));await insert(['openai','anthropic','google']);
 await assert.rejects(insert(['openai','anthropic','google']),refusedBy('translation_consents_current_idx'));
});

async function insertJob(v:{venueId:string;installationId:string},changes:Record<string,unknown>={}){
 const row={id:randomUUID(),installation_id:v.installationId,venue_id:v.venueId,operation_id:randomUUID(),
  job_sha256:'a'.repeat(64),job_bytes:10,state:'done',total:1,provider:'openai',model:'gpt-6-luna',
  prompt_version:'translate-all-v1',finished_at:new Date(),...changes};
 const columns=Object.keys(row);
 return (await db.pool.query(`INSERT INTO translation_jobs(${columns.join(',')}) VALUES(${columns.map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`,Object.values(row))).rows[0];
}
test('job metadata refuses invalid fingerprints, bounds, counters and provider values',async()=>{
 const v=await connectedVenue(db,issuer,origin);
 const invalid:[Record<string,unknown>,string][]=[
  [{job_sha256:'A'.repeat(64)},'job_sha256'],[{job_sha256:'a'.repeat(63)},'job_sha256'],
  [{job_bytes:0},'job_bytes'],[{job_bytes:1048577},'job_bytes'],
  [{state:'unknown'},'state'],[{total:0},'total'],[{total:1001},'total'],
  [{done:-1},'done'],[{failed:-1},'failed'],[{done:1,failed:1},'counts'],
  [{input_tokens:-1},'input_tokens'],[{output_tokens:-1},'output_tokens'],[{cost_micro_usd:-1},'cost_micro_usd'],
  [{review_applied:-1},'review_applied'],[{review_dropped:-1},'review_dropped'],
  [{provider:'unknown'},'provider'],[{prompt_version:'UPPER'},'prompt_version'],
  [{prompt_version:'a'.repeat(65)},'prompt_version'],[{lease_count:-1},'lease_count'],
 ];
 for(const [changes,rule] of invalid)await assert.rejects(insertJob(v,changes),refusedBy(`translation_jobs_${rule}_check`));
 await insertJob(v,{job_bytes:1,total:1,done:1});
 await insertJob(v,{job_bytes:1048576,total:1000,done:999,failed:1});
 const row=await insertJob(v,{state:'queued',finished_at:null});
 assert.equal(row.done,0);assert.equal(row.failed,0);assert.equal(row.cost_micro_usd,'0');
 assert.equal(row.lease_id,null);assert.equal(row.lease_count,0);
 await db.pool.query("UPDATE translation_jobs SET state='running' WHERE id=$1",[row.id]);
 await assert.rejects(insertJob(v,{state:'queued',finished_at:null}),refusedBy('translation_jobs_one_open_idx'));
 await db.pool.query("UPDATE translation_jobs SET state='done',finished_at=clock_timestamp() WHERE id=$1",[row.id]);
 await insertJob(v,{state:'queued',finished_at:null});
});
test('a signed submit operation cannot name two jobs for the same installation',async()=>{
 const v=await connectedVenue(db,issuer,origin),operation_id=randomUUID();
 await insertJob(v,{operation_id});
 await assert.rejects(insertJob(v,{operation_id}),refusedBy('translation_jobs_installation_id_operation_id_key'));
 const other=await connectedVenue(db,issuer,origin);await insertJob(other,{operation_id});
});
test('a retained body belongs to a job and stores batches as an object',async()=>{
 const v=await connectedVenue(db,issuer,origin),row=await insertJob(v);
 await assert.rejects(db.pool.query("INSERT INTO translation_job_bodies(job_id,body,batch_results) VALUES($1,'{}','[]')",[row.id]),refusedBy('translation_job_bodies_batch_results_check'));
 await db.pool.query("INSERT INTO translation_job_bodies(job_id,body) VALUES($1,'retained menu')",[row.id]);
 assert.deepEqual((await db.pool.query('SELECT body,batch_results FROM translation_job_bodies WHERE job_id=$1',[row.id])).rows,[{body:'retained menu',batch_results:{}}]);
 await assert.rejects(db.pool.query("INSERT INTO translation_job_bodies(job_id,body) VALUES($1,'duplicate')",[row.id]),refusedBy('translation_job_bodies_pkey'));
 await assert.rejects(db.pool.query("INSERT INTO translation_job_bodies(job_id,body) VALUES($1,'orphan')",[randomUUID()]),refusedBy('translation_job_bodies_job_id_fkey'));
});
test('policy and price rows reject invalid bounds without changing the seeded defaults',async()=>{
 for(const [column,rule] of [['monthly_cap_micro_usd','monthly_cap_micro_usd'],['estimate_micro_usd_per_item','estimate_micro_usd_per_item']])
  await assert.rejects(db.pool.query(`UPDATE translation_policy SET ${column}=0`),refusedBy(`translation_policy_${rule}_check`));
 for(const [column,value,rule] of [
  ['model','','model'],['model','a'.repeat(101),'model'],['provider','unknown','provider'],
  ['input_micro_usd_per_million',-1,'input_micro_usd_per_million'],['output_micro_usd_per_million',-1,'output_micro_usd_per_million'],
  ['source','','source'],['source','a'.repeat(501),'source'],
 ] as const)await assert.rejects(db.pool.query(`UPDATE translation_prices SET ${column}=$1`,[value]),refusedBy(`translation_prices_${rule}_check`));
});
test('withdrawn consent frees the current slot while keeping the earlier record',async()=>{
 const v=await connectedVenue(db,issuer,origin),other=await connectedVenue(db,issuer,origin);
 const insert=(version:string,organisation=v.organisationId)=>db.pool.query(`INSERT INTO translation_consents(id,venue_id,organisation_id,account_id,consent_version,providers)
  VALUES($1,$2,$3,$4,$5,ARRAY['openai','anthropic','google']) RETURNING id`,[randomUUID(),v.venueId,organisation,v.accountId,version]);
 await assert.rejects(insert('not a version'),refusedBy('translation_consents_consent_version_check'));
 await assert.rejects(insert('providers-v1',other.organisationId),refusedBy('translation_consents_venue_id_organisation_id_fkey'));
 const id=(await insert('providers-v1')).rows[0].id;
 await assert.rejects(db.pool.query("UPDATE translation_consents SET withdrawn_at=consented_at-interval '1 second' WHERE id=$1",[id]),refusedBy('translation_consents_withdrawn_check'));
 await db.pool.query('UPDATE translation_consents SET withdrawn_at=clock_timestamp() WHERE id=$1',[id]);
 await insert('providers-v2');
 assert.deepEqual((await db.pool.query('SELECT consent_version,withdrawn_at IS NULL AS current FROM translation_consents WHERE venue_id=$1 ORDER BY consent_version',[v.venueId])).rows,
  [{consent_version:'providers-v1',current:false},{consent_version:'providers-v2',current:true}]);
});

test('concurrent submissions leave exactly one open job for the venue',async()=>{
 const v=await connectedVenue(db,issuer,origin);
 const results=await Promise.allSettled([job(v),job(v)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const refusal=results.find(r=>r.status==='rejected');assert.ok(refusal&&refusal.status==='rejected');
 assert.equal(refusal.reason.constraint,'translation_jobs_one_open_idx');
 assert.equal((await db.pool.query("SELECT count(*)::integer AS n FROM translation_jobs WHERE venue_id=$1 AND state IN ('queued','running')",[v.venueId])).rows[0].n,1);
});

test('a job cannot charge a different venue from the installation it belongs to',async()=>{
 const v=await connectedVenue(db,issuer,origin),other=await connectedVenue(db,issuer,origin);
 await assert.rejects(insertJob(v,{venue_id:other.venueId}),refusedBy('translation_jobs_installation_venue_fkey'));
 await insertJob(v);
});
test('the database keeps the positive quantity rule for translation usage',async()=>{
 const v=await connectedVenue(db,issuer,origin);
 for(const quantity of [0,-1])await assert.rejects(db.pool.query(`INSERT INTO usage_events(organisation_id,venue_id,event_type,quantity,source_kind,source_reference,occurred_at)
  VALUES($1,$2,'translation.cost_micro_usd',$3,'translation_job',$4,clock_timestamp())`,[v.organisationId,v.venueId,quantity,randomUUID()]),refusedBy('usage_events_quantity_check'));
});
test('the database keeps the source reference rule for translation usage',async()=>{
 const v=await connectedVenue(db,issuer,origin);
 for(const reference of ['-bad','','has a space','x'.repeat(257)])await assert.rejects(db.pool.query(`INSERT INTO usage_events(organisation_id,venue_id,event_type,quantity,source_kind,source_reference,occurred_at)
  VALUES($1,$2,'translation.cost_micro_usd',731,'translation_job',$3,clock_timestamp())`,[v.organisationId,v.venueId,reference]),refusedBy('usage_events_source_reference_check'));
});
