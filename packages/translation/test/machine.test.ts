import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {after,before,test} from 'node:test';
import {createLeaseIssuer,InstallationError,type SignedEnvelope} from '@waitron-cloud/registration';
import {jobFingerprint,maxCollectBytes,TranslationError,TranslationMachine,type TranslationAction,type ItemResult} from '../src/index.ts';
import {connectedVenue,database,readyForTranslation} from './fixtures.ts';
let db:Awaited<ReturnType<typeof database>>;
const origin='https://cloud.example.test';
const newIssuer=()=>createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
const issuer=newIssuer();
type LeaseInput=Parameters<typeof issuer.issue>[0];
const machine=()=>new TranslationMachine(db.pool,issuer,origin);
before(async()=>{db=await database();});after(async()=>db?.close());
async function venue(){const v=await connectedVenue(db,issuer,origin);await readyForTranslation(db,v);return v;}
type Venue=Awaited<ReturnType<typeof venue>>;
type Action='translation-status'|'translation-collect'|'translation-release';
const code=(name:string)=>(e:unknown)=>(e instanceof TranslationError||e instanceof InstallationError)&&e.code===name;
const envelopeOf=(e:SignedEnvelope)=>({payload:e.payload,signature:e.signature});
const item=(ref:string)=>({ref,kind:'product',family:ref,category:'BAR',staffName:'CAFE',existing:{},missing:['ca','es']});
const jobText=(refs=['product:1'])=>JSON.stringify({version:1,country:'ES',languages:{default:'ca',enabled:['ca','es']},items:refs.map(item),houseStyle:[]});
const jobs=async(v:Venue)=>(await db.pool.query('SELECT count(*)::integer AS n FROM translation_jobs WHERE venue_id=$1',[v.venueId])).rows[0].n as number;
const setService=(v:Venue,state:string)=>db.pool.query("UPDATE installation_services SET state=$2 WHERE installation_id=$1 AND service='content_translation'",[v.installationId,state]);
async function submit(v:Venue,text=jobText(),operationId=randomUUID()){
 return machine().execute('translation-submit',envelopeOf(v.submit(text,operationId)),text) as Promise<{version:1;jobId:string;state:string;total:number}>;
}
const act=(v:Venue,action:Action,body:unknown)=>machine().execute(action,v.proof(action,body,randomUUID(),v.lease));
async function finish(jobId:string,state='done',reason:string|null=null){
 await db.pool.query('UPDATE translation_jobs SET state=$2,reason=$3,finished_at=clock_timestamp() WHERE id=$1',[jobId,state,reason]);
}
async function outcomes(jobId:string,batches:unknown){await db.pool.query('UPDATE translation_job_bodies SET batch_results=$2 WHERE job_id=$1',[jobId,JSON.stringify(batches)]);}
const result=(ref:string)=>({ref,names:{ca:'Cafè',es:'Café'},placeholder:false,corrections:[{field:'internal',wrong:'CAFE',right:'CAFÉ'}]});

// These checks catch parsing an unsigned body or applying submit gates before a retry lookup.
test('fingerprint precedes job parsing, while a valid fingerprint still requires a valid job',async()=>{
 const v=await venue(),signed=v.submit('not json');
 await assert.rejects(machine().execute('translation-submit',envelopeOf(signed),'not json!'),code('invalid_proof'));
 await assert.rejects(machine().execute('translation-submit',envelopeOf(signed),'not json'),code('invalid_request'));
 await assert.rejects(machine().execute('translation-submit',envelopeOf(v.submit(jobText()))),code('invalid_proof'));
 assert.equal(await jobs(v),0);
});
test('submit counts only written items and keeps UTF-8 text intact',async()=>{
 const v=await venue(),body=JSON.parse(jobText());
 body.items=[{...item('head'),staffName:'Cigaló',existing:{ca:'Cigaló',es:'Carajillo'},missing:[]},
  {...item('variant'),kind:'variant',family:'head'}];
 const text=JSON.stringify(body),reply=await submit(v,text);
 assert.deepEqual(reply,{version:1,jobId:reply.jobId,state:'queued',total:1});
 const stored=(await db.pool.query('SELECT body FROM translation_job_bodies WHERE job_id=$1',[reply.jobId])).rows[0];
 assert.equal(stored.body,text);assert.equal(await jobs(v),1);
});
test('retry returns the current job before entitlement, open-job and spending checks; changed input conflicts',async()=>{
 const v=await venue(),text=jobText(),op=randomUUID(),first=await submit(v,text,op);
 await finish(first.jobId);
 await submit(v,jobText(['product:2']));
 await setService(v,'unconfigured');
 await db.pool.query('DELETE FROM translation_policy');
 try{
  assert.deepEqual(await submit(v,text,op),{...first,state:'done'});
  await assert.rejects(submit(v,jobText(['product:3']),op),code('conflict'));
  await assert.rejects(submit(v,jobText(['product:3'])),code('permission_denied'));
 }finally{await db.pool.query('INSERT INTO translation_policy VALUES(true,5000000,146)');}
 assert.equal(await jobs(v),2);
});
test('missing or unready entitlement refuses a new submit before creating a job',async()=>{
 const v=await venue();
 await db.pool.query("DELETE FROM installation_services WHERE installation_id=$1 AND service='content_translation'",[v.installationId]);
 await assert.rejects(submit(v),code('permission_denied'));
 await readyForTranslation(db,v);await setService(v,'unconfigured');
 await assert.rejects(submit(v),code('permission_denied'));assert.equal(await jobs(v),0);
});
test('concurrent retries create one job, while competing operations receive job_running',async()=>{
 const v=await venue(),op=randomUUID();
 const replies=await Promise.all(Array.from({length:6},()=>submit(v,jobText(),op)));
 for(const reply of replies)assert.deepEqual(reply,replies[0]);assert.equal(await jobs(v),1);
 const w=await venue(),attempts=await Promise.allSettled(Array.from({length:6},()=>submit(w)));
 assert.equal(attempts.filter(a=>a.status==='fulfilled').length,1);
 for(const a of attempts)if(a.status==='rejected')assert(code('job_running')(a.reason),String(a.reason));
 assert.equal(await jobs(w),1);
});
test('open-job refusal precedes the cap and a cap refusal creates no body or job',async()=>{
 const v=await venue(),first=await submit(v);
 await db.pool.query('UPDATE translation_jobs SET cost_micro_usd=4999000 WHERE id=$1',[first.jobId]);
 await assert.rejects(submit(v),code('job_running'));
 await finish(first.jobId);
 await assert.rejects(submit(v,jobText(Array.from({length:7},(_,i)=>`product:${i}`))),
  (e:unknown)=>e instanceof TranslationError&&e.code==='limit_reached'&&e.fits===6);
 assert.equal(await jobs(v),1);
 assert.equal((await db.pool.query('SELECT count(*)::integer AS n FROM translation_job_bodies b JOIN translation_jobs j ON j.id=b.job_id WHERE j.venue_id=$1',[v.venueId])).rows[0].n,1);
});

// Removing proof, revocation or any lease binding must permit an otherwise refused operation.
test('preliminary authentication checks signatures and action without creating work; execute checks again',async()=>{
 const v=await venue(),e=envelopeOf(v.submit(jobText())),claims=await machine().authenticate('translation-submit',e);
 assert.equal(claims.installationId,v.installationId);assert.equal(await jobs(v),0);
 await assert.rejects(machine().authenticate('translation-status',e),code('invalid_proof'));
 await assert.rejects(machine().authenticate('translation-submit',{...e,signature:'A'.repeat(86)}),code('invalid_proof'));
 await db.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[v.installationId]);
 await assert.rejects(machine().execute('translation-submit',e,jobText()),code('revoked'));
 assert.equal(await jobs(v),0);
});
test('execute refuses forged signatures, wrong action/origin, stale proof and unknown installation',async()=>{
 const v=await venue(),text=jobText(),body=JSON.stringify({version:1,...jobFingerprint(text)});
 const proofs=[{...envelopeOf(v.submit(text)),signature:'A'.repeat(86)},
  v.proof('translation-status',undefined,randomUUID(),v.lease,body),
  v.proof('translation-submit',undefined,randomUUID(),v.lease,body,Date.now(),{origin:'https://other.example.test'}),
  v.submit(text,randomUUID(),Date.now()-61000),
  v.proof('translation-submit',undefined,randomUUID(),v.lease,body,Date.now(),{installationId:randomUUID()})];
 for(const e of proofs)await assert.rejects(machine().execute('translation-submit',envelopeOf(e),text),code('invalid_proof'));
 assert.equal(await jobs(v),0);
});
function lease(v:Venue,overrides:Partial<LeaseInput>={},signer=issuer){
 const now=Date.now();return signer.issue({origin,leaseId:randomUUID(),installationId:v.installationId,venueId:v.venueId,
  environment:'test',publicKey:v.installationKey,issuedAt:now,expiresAt:now+3600000,...overrides});
}
for(const binding of ['installationId','venueId','environment','publicKey','expiry','issuer','origin'] as const){
 test(`execute refuses a lease with the wrong ${binding}`,async()=>{
  const v=await venue(),w=await venue(),text=jobText(),now=Date.now();
  const overrides=binding==='installationId'?{installationId:w.installationId}:binding==='venueId'?{venueId:w.venueId}:
   binding==='environment'?{environment:'production' as const}:binding==='publicKey'?{publicKey:w.installationKey}:
   binding==='expiry'?{issuedAt:now-7200000,expiresAt:now-3600000}:binding==='origin'?{origin:'https://other.example.test'}:{};
  const invalidLease=lease(v,overrides,binding==='issuer'?newIssuer():issuer);
  const e=v.proof('translation-submit',undefined,randomUUID(),invalidLease,JSON.stringify({version:1,...jobFingerprint(text)}));
  await assert.rejects(machine().execute('translation-submit',e,text),code('invalid_proof'));assert.equal(await jobs(v),0);
 });
}
test('a configured preceding lease issuer is accepted, while malformed and noncompact lease envelopes are refused',async()=>{
 const v=await venue(),old=newIssuer(),text=jobText(),oldLease=lease(v,{},old);
 const trusted=new Map([[issuer.keyId,issuer.publicKey],[old.keyId,old.publicKey]]);
 const e=v.proof('translation-submit',undefined,randomUUID(),oldLease,JSON.stringify({version:1,...jobFingerprint(text)}));
 assert.equal((await new TranslationMachine(db.pool,issuer,origin,trusted).execute('translation-submit',e,text)).state,'queued');
 for(const raw of ['', 'not json','null','{}',JSON.stringify(v.lease,null,1)]){
  const proof=v.proof('translation-status',{version:1,jobId:randomUUID()},randomUUID(),v.lease,undefined,Date.now(),{lease:raw});
  await assert.rejects(machine().execute('translation-status',proof),code('invalid_proof'),raw);
 }
});
test('revocation committed while execute waits is rechecked under the installation lock',async()=>{
 const v=await venue(),text=jobText(),e=envelopeOf(v.submit(text));await machine().authenticate('translation-submit',e);
 const blocker=await db.secondPool.connect();let pending:Promise<unknown>|undefined;
 try{
  await blocker.query('BEGIN');const pid=(await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  await blocker.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[v.installationId]);
  pending=machine().execute('translation-submit',e,text);const rejected=assert.rejects(pending,code('revoked'));
  const deadline=Date.now()+5000;let blocked=false;
  while(Date.now()<deadline){
   blocked=(await db.secondPool.query('SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked',[pid])).rows[0].blocked;
   if(blocked)break;await delay(10);
  }
  assert.equal(blocked,true,'execute must wait for installation revocation');await blocker.query('COMMIT');await rejected;
 }finally{await blocker.query('ROLLBACK');blocker.release();await pending?.catch(()=>{});}
 assert.equal(await jobs(v),0);
});

for(const action of ['translation-status','translation-collect','translation-release'] as const){
 test(`${action} validates exact action fields and lowercase UUID before the job read`,async()=>{
  const v=await venue(),{jobId}=await submit(v);
  for(const body of [null,[],{}, {version:1,jobId,extra:1},{version:2,jobId},{version:'1',jobId},{jobId},
   {version:1},{version:1,jobId:17},{version:1,jobId:jobId.toUpperCase()},{version:1,jobId:'not-a-uuid'},
   ...(action==='translation-collect'?[]:[{version:1,jobId,cursor:0}])]){
   await assert.rejects(act(v,action,body),code('invalid_request'),JSON.stringify(body));
  }
  await assert.rejects(machine().execute(action,v.proof(action,{},randomUUID(),v.lease,'not json')),code('invalid_request'));
 });
 test(`${action} conceals foreign and unknown jobs even when the service is no longer ready`,async()=>{
  const a=await venue(),b=await venue(),{jobId}=await submit(a);await setService(b,'unconfigured');
  for(const id of [jobId,randomUUID()])await assert.rejects(act(b,action,{version:1,jobId:id}),code('job_not_found'));
 });
}
test('status keeps reason and counts, and existing work is readable after entitlement is removed',async()=>{
 const v=await venue(),{jobId}=await submit(v,jobText(['a','b']));await setService(v,'unconfigured');
 assert.deepEqual(await act(v,'translation-status',{version:1,jobId}),{version:1,jobId,state:'queued',total:2,done:0,failed:0});
 await db.pool.query('UPDATE translation_jobs SET done=1,failed=1 WHERE id=$1',[jobId]);await finish(jobId,'partly_done','provider_failed');
 assert.deepEqual(await act(v,'translation-status',{version:1,jobId}),{version:1,jobId,state:'partly_done',total:2,done:1,failed:1,reason:'provider_failed'});
});
test('collect checks installation ownership before cursor validity, then cursor before state',async()=>{
 const a=await venue(),b=await venue(),{jobId}=await submit(a,jobText(['a','b']));
 for(const cursor of [-1,0.5,Number.MAX_SAFE_INTEGER+1,'0',null,true,[0],{cursor:1,version:1},'"version":2,"jobId":"x"','":',2,3]){
  await assert.rejects(act(a,'translation-collect',{version:1,jobId,cursor}),code('invalid_request'),JSON.stringify(cursor));
  for(const id of [jobId,randomUUID()])await assert.rejects(act(b,'translation-collect',{version:1,jobId:id,cursor}),code('job_not_found'));
 }
 await assert.rejects(act(a,'translation-collect',{version:1,jobId,cursor:0}),code('not_ready'));
 await finish(jobId,'expired');
 await assert.rejects(act(a,'translation-collect',{version:1,jobId,cursor:-1}),code('invalid_request'));
 await assert.rejects(act(a,'translation-collect',{version:1,jobId}),code('expired'));
});
test('signed collect cursors preserve filtered submit order, text, repeats, and retained bodies',async()=>{
 const v=await venue(),body=JSON.parse(jobText());
 body.items=[{...item('head'),existing:{ca:'Cap',es:'Cabeza'},missing:[]},
  {...item('a'),kind:'variant',family:'head'},item('b'),item('c'),item('d')];
 const {jobId}=await submit(v,JSON.stringify(body));
 const a=result('a'),c={ref:'c',names:{},placeholder:true,corrections:[]},d=result('d');
 await outcomes(jobId,{9:{results:[d,c],failed:[]},2:{results:[a],failed:['b']}});
 await db.pool.query('UPDATE translation_jobs SET done=3,failed=1 WHERE id=$1',[jobId]);await finish(jobId,'partly_done','provider_failed');
 const first={version:1,jobId,state:'partly_done',results:[a,c,d],failed:['b'],nextCursor:null};
 assert.deepEqual(await act(v,'translation-collect',{version:1,jobId}),first);
 assert.deepEqual(await act(v,'translation-collect',{version:1,jobId,cursor:0}),first);
 assert.deepEqual(await act(v,'translation-collect',{version:1,jobId,cursor:1}),{...first,results:[c,d]});
 assert.deepEqual(await act(v,'translation-collect',{version:1,jobId,cursor:3}),{...first,results:[d],failed:[]});
 assert.equal((await db.pool.query('SELECT count(*)::integer AS n FROM translation_job_bodies WHERE job_id=$1',[jobId])).rows[0].n,1);
 assert.equal((await act(v,'translation-status',{version:1,jobId})).state,'partly_done');
});
test('machine collection walks more than 16 MiB using signed continuations without deleting unseen items',async()=>{
 const v=await venue(),languages=['en','es','ca','fr','de','it','pt','nl','sv','da','fi','pl','cs','sk','hu','ro','el','tr','ja','zh'],body=JSON.parse(jobText());body.languages={default:'en',enabled:languages};
 body.items=Array.from({length:400},(_,i)=>({...item(`ref:${i}`),missing:languages}));
 const text=JSON.stringify(body);assert(Buffer.byteLength(text)<=1048576);
 const {jobId}=await submit(v,text);
 const results:ItemResult[]=body.items.map((i:{ref:string})=>({ref:i.ref,names:Object.fromEntries(languages.map(tag=>[tag,'\u0000'.repeat(500)])),placeholder:false,
  corrections:Array.from({length:10},()=>({field:'internal',wrong:'\\'.repeat(500),right:'\ud800'.repeat(500)}))}));
 await outcomes(jobId,{0:{results,failed:[]}});await finish(jobId);
 let cursor:number|null=0,pages=0;const refs:string[]=[];
 do{
  const page=await act(v,'translation-collect',{version:1,jobId,cursor}) as {results:typeof results;nextCursor:number|null};
  assert(Buffer.byteLength(JSON.stringify(page))<=maxCollectBytes);assert(page.results.length>0);
  assert.deepEqual(page.results,results.slice(refs.length,refs.length+page.results.length));
  refs.push(...page.results.map(i=>i.ref));cursor=page.nextCursor;pages++;
  if(pages===1){assert.notEqual(cursor,null);assert.deepEqual(await act(v,'translation-collect',{version:1,jobId,cursor:0}),page);}
 }while(cursor!==null);
 assert(pages>1);assert.deepEqual(refs,Array.from({length:400},(_,i)=>`ref:${i}`));
 assert.equal((await db.pool.query('SELECT count(*)::integer AS n FROM translation_job_bodies WHERE job_id=$1',[jobId])).rows[0].n,1);
});
test('collect and release preserve state refusals, repeated release, deletion and failed-job release',async()=>{
 const v=await venue(),{jobId}=await submit(v);
 for(const state of ['queued','running','failed']){
  if(state==='failed')await finish(jobId,state,'provider_unavailable');else await db.pool.query('UPDATE translation_jobs SET state=$2 WHERE id=$1',[jobId,state]);
  await assert.rejects(act(v,'translation-collect',{version:1,jobId}),code('not_ready'));
  if(state!=='failed')await assert.rejects(act(v,'translation-release',{version:1,jobId}),code('not_ready'));
 }
 const released={version:1,jobId,state:'collected'};
 assert.deepEqual(await act(v,'translation-release',{version:1,jobId}),released);
 assert.deepEqual(await act(v,'translation-release',{version:1,jobId}),released);
 assert.equal((await db.pool.query('SELECT count(*)::integer AS n FROM translation_job_bodies WHERE job_id=$1',[jobId])).rows[0].n,0);
 await assert.rejects(act(v,'translation-collect',{version:1,jobId}),code('expired'));
 await finish(jobId,'expired');await assert.rejects(act(v,'translation-release',{version:1,jobId}),code('expired'));
});

test('other machine action names cannot fall through to translation release',async()=>{
 const v=await venue(),{jobId}=await submit(v);await finish(jobId);
 const action='renew' as TranslationAction,e=v.proof(action,{version:1,jobId},randomUUID(),v.lease);
 await assert.rejects(machine().execute(action,e),code('invalid_proof'));
 await assert.rejects(machine().authenticate(action,e),code('invalid_proof'));
 assert.equal((await act(v,'translation-status',{version:1,jobId})).state,'done');
});

test('action bodies reject repeated fields and alternate version spellings without reading a different job',async()=>{
 const v=await venue(),w=await venue(),{jobId}=await submit(v,jobText(['a','b'])),foreign=await submit(w);
 await outcomes(jobId,{0:{results:[result('a'),result('b')],failed:[]}});await finish(jobId);
 for(const action of ['translation-status','translation-collect','translation-release'] as const){
  const bodies=[`{"version":2,"version":1,"jobId":"${jobId}"}`,
   `{"version":1,"jobId":"${foreign.jobId}","jobId":"${jobId}"}`,
   String.raw`{"version":1,"\u0076ersion":1,"jobId":"${jobId}"}`,
   ...['1.0','1e0','0.1e1'].map(version=>`{"version":${version},"jobId":"${jobId}"}`),
   ...(action==='translation-collect'?[`{"version":1,"jobId":"${jobId}","cursor":5,"cursor":1}`]:[])];
  for(const raw of bodies)await assert.rejects(machine().execute(action,v.proof(action,{},randomUUID(),v.lease,raw)),code('invalid_request'),raw);
 }
 assert.equal((await act(v,'translation-status',{version:1,jobId})).state,'done');
 for(const cursor of ['1.0','1e0']){
  const raw=`{ "jobId" : "${jobId}", "cursor":${cursor}, "version" : 1 }`;
  assert.deepEqual(await machine().execute('translation-collect',v.proof('translation-collect',{},randomUUID(),v.lease,raw)),
   {version:1,jobId,state:'done',results:[result('b')],failed:[],nextCursor:null});
 }
});
test('a failed body insert rolls back the written job and permits the same operation to retry',async()=>{
 const v=await venue(),op=randomUUID();
 await db.pool.query(`CREATE FUNCTION refuse_translation_body() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM translation_jobs WHERE id=NEW.job_id) THEN RAISE EXCEPTION 'job_was_not_written'; END IF;
  RAISE EXCEPTION 'translation_body_refused'; END $$;
  CREATE TRIGGER refuse_translation_body BEFORE INSERT ON translation_job_bodies FOR EACH ROW EXECUTE FUNCTION refuse_translation_body()`);
 try{
  await assert.rejects(submit(v,jobText(),op),(e:unknown)=>!!e&&typeof e==='object'&&'code' in e&&e.code==='P0001'&&'message' in e&&e.message==='translation_body_refused');
  assert.equal(await jobs(v),0);
  assert.equal((await db.pool.query('SELECT count(*)::integer AS n FROM translation_job_bodies b JOIN translation_jobs j ON j.id=b.job_id WHERE j.installation_id=$1',[v.installationId])).rows[0].n,0);
 }finally{await db.pool.query('DROP TRIGGER refuse_translation_body ON translation_job_bodies; DROP FUNCTION refuse_translation_body()');}
 const retry=await submit(v,jobText(),op);assert.equal(retry.state,'queued');assert.equal(await jobs(v),1);
});
