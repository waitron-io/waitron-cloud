import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import {createLeaseIssuer,transaction} from '@waitron-cloud/registration';
import {collectJob,createJob,jobFingerprint,lockVenue,readJob} from '../src/index.ts';
import {connectedVenue,database} from './fixtures.ts';
let db:Awaited<ReturnType<typeof database>>;
const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
before(async()=>{db=await database();});after(async()=>db?.close());
// Replacing JSON with JSONB rejects these accepted strings before collect can return them.
test('persist and collect accepted control characters and unpaired surrogates without changing text',async()=>{
 const v=await connectedVenue(db,issuer,'https://cloud.example.test');
 const texts=['nul\u0000end','high\ud800end','low\udfffend','paired😀\u0001'];
 const items=texts.map((staffName,i)=>({ref:'p'+i,kind:'product',family:'p'+i,category:'A',staffName,existing:{},missing:['ca']}));
 const body=JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca']},items,houseStyle:[]});
 const job=await transaction(db.pool,async c=>{await lockVenue(c,v.venueId);return createJob(c,{installationId:v.installationId,venueId:v.venueId,operationId:randomUUID(),fingerprint:jobFingerprint(body),body,total:4});});
 const results=texts.map((text,i)=>({ref:'p'+i,names:{ca:text},placeholder:false,corrections:[{field:'internal',wrong:text,right:text+'!'}]}));
 await db.pool.query('UPDATE translation_job_bodies SET batch_results=$2 WHERE job_id=$1',[job.id,{0:{results,failed:[]}}]);
 await db.pool.query("UPDATE translation_jobs SET state='done',done=4,finished_at=clock_timestamp() WHERE id=$1",[job.id]);
 const page=await transaction(db.pool,async c=>collectJob(c,await readJob(c,v.installationId,job.id)));
 assert.deepEqual(page.results,results);assert.deepEqual(page.failed,[]);assert.equal(page.nextCursor,null);
 await assert.rejects(db.pool.query("UPDATE translation_job_bodies SET batch_results='[]' WHERE job_id=$1",[job.id]),(e:unknown)=>{assert.equal((e as {constraint:string}).constraint,'translation_job_bodies_batch_results_check');return true;});
});
