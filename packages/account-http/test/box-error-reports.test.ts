import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {test} from 'node:test';
import type {HttpBindings} from '@hono/node-server';
import {createLeaseIssuer} from '@waitron-cloud/registration';
import {connectedVenue,database} from '../../translation/test/fixtures.ts';
import {createAccountApp} from '../src/app.ts';

const origin='https://cloud.example.test';
const source='packages/storage/src/archive.ts#write';
const report=(version='1.0.0',code='storage.disk_full',count=1)=>({code,source,version,time:1700000000000,count,logs:[{level:'error',code,source}]});
async function fixture(){
 const db=await database();try{
  const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
  const box=await connectedVenue(db,issuer,origin);
  const options={pool:db.pool,outbox:db.outbox,leaseIssuer:issuer,planMode:'test-free-paid' as const,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]}};
  const app=createAccountApp(options);
  const request=(action:string,proof:unknown,headers:Record<string,string>={},method='POST')=>app.request(origin+'/api/installations/'+action,{method,headers:{'content-type':'application/json',...headers},...(method==='GET'?{}:{body:JSON.stringify(proof)})},{incoming:{socket:{remoteAddress:'203.0.113.61'}}} as HttpBindings);
  const send=(body:unknown,who=box,operationId=randomUUID())=>request('error-report',who.proof('error-report',body,operationId,who.lease));
  const held=async(version:string,who=box)=>{const r=await request('release-held',who.proof('release-held',{version},randomUUID(),who.lease));assert.equal(r.status,200,await r.clone().text());return r.json();};
  return {db,issuer,box,options,app,request,send,held};
 }catch(error){await db.close();throw error;}
}

test('a free registered box submits through the real signed route without usage or contact writes',async()=>{
 const f=await fixture();try{
  const before=(await f.db.pool.query('SELECT last_contact_at FROM installations WHERE id=$1',[f.box.installationId])).rows[0];
  const operations=(await f.db.pool.query('SELECT count(*) FROM installation_operations')).rows[0].count;
  const body=report(),r=await f.send(body);assert.equal(r.status,200,await r.clone().text());assert.deepEqual(await r.json(),{accepted:true});
  assert.deepEqual((await f.db.pool.query('SELECT code,source,occurrences::text AS count,logs FROM installation_error_reports')).rows,[{code:body.code,source,count:'1',logs:body.logs}]);
  assert.deepEqual(await f.held('1.0.0'),{version:'1.0.0',held:false});
  assert.deepEqual((await f.db.pool.query('SELECT last_contact_at FROM installations WHERE id=$1',[f.box.installationId])).rows[0],before);
  assert.equal((await f.db.pool.query('SELECT count(*) FROM installation_operations')).rows[0].count,operations);
  assert.equal(r.headers.get('cache-control'),'no-store');
 }finally{await f.db.close();}
});

test('new errors need five occurrences and two boxes; a lone invented predecessor cannot hide the hold',async()=>{
 const f=await fixture();try{
  const b=await connectedVenue(f.db,f.issuer,origin);
  for(const who of [f.box,b])assert.equal((await f.send(report('1.9.0','network.unavailable',2),who)).status,200);
  assert.equal((await f.send(report('1.10.0','storage.disk_full',4))).status,200);
  assert.deepEqual(await f.held('1.10.0'),{version:'1.10.0',held:false});
  assert.equal((await f.send(report('1.10.0','storage.disk_full',1),b)).status,200);
  assert.deepEqual(await f.held('1.10.0'),{version:'1.10.0',held:true});
  assert.equal((await f.send(report('1.9.999','storage.disk_full',100))).status,200);
  assert.deepEqual(await f.held('1.10.0'),{version:'1.10.0',held:true});
  assert.deepEqual(await f.held('9.0.0'),{version:'9.0.0',held:false});
  assert.deepEqual(await f.held('1.9.0'),{version:'1.9.0',held:false});
 }finally{await f.db.close();}
});

test('duplicate concurrent deliveries count once and changed bodies conflict',async()=>{
 const f=await fixture();try{
  const id=randomUUID(),body=report(),responses=await Promise.all([f.send(body,f.box,id),f.send(body,f.box,id)]);
  for(const r of responses)assert.equal(r.status,200,await r.clone().text());
  assert.equal((await f.db.pool.query('SELECT sum(occurrences)::text AS n FROM installation_error_reports')).rows[0].n,'1');
  const r=await f.send({...body,count:2},f.box,id);assert.equal(r.status,409);assert.deepEqual(await r.json(),{error:'conflict'});
  assert.equal((await f.send({...body,source:'packages/storage/src/other.ts#write',time:body.time+1000,count:3})).status,200);
  assert.deepEqual((await f.db.pool.query("SELECT code,concat_ws('.',version_major,version_minor,version_patch) AS version,sum(occurrences)::text AS count,min(reported_at) AS first,max(reported_at) AS last FROM installation_error_reports GROUP BY code,version_major,version_minor,version_patch")).rows,[{code:body.code,version:'1.0.0',count:'4',first:new Date(body.time),last:new Date(body.time+1000)}]);
 }finally{await f.db.close();}
});

test('only bounded code references cross the report body boundary',async()=>{
 const f=await fixture();try{
  const base=report(),bad=[{...base,venueName:'private'}, {...base,code:'typed words'}, {...base,source:'/private/file.ts'}, {...base,source:'../file.ts'},
   {...base,version:'1.0.0-beta'}, {...base,version:'01.0.0'}, {...base,version:'2147483648.0.0'}, {...base,time:-1}, {...base,time:Date.now()+120000},
   {...base,count:0}, {...base,count:1.5}, {...base,count:1000001}, {...base,logs:['private text']}, {...base,logs:[{...base.logs[0],text:'private'}]},
   {...base,logs:[{...base.logs[0],details:{email:'private'}}]}, {...base,logs:[{...base.logs[0],level:'fatal'}]}, {...base,logs:Array(9).fill(base.logs[0])},
   {...base,code:'a'.repeat(129)}, {...base,source:'a'.repeat(161)}, {...base,source:'https://example.test/file'}, {...base,source:'file\\name'}, {...base,source:'file/./name'}];
  for(const body of bad){await f.db.pool.query('DELETE FROM account_rate_limits');const r=await f.send(body);assert.equal(r.status,400,JSON.stringify(body)+':'+await r.clone().text());}
  for(const raw of ['{"version":"1.0.0","version":"1.0.1"}',' {"version":"1.0.0"}']){
   await f.db.pool.query('DELETE FROM account_rate_limits');assert.equal((await f.request('release-held',f.box.proof('release-held',{},randomUUID(),f.box.lease,raw))).status,400);
  }
  assert.equal((await f.db.pool.query('SELECT count(*) FROM installation_error_reports')).rows[0].count,'0');
 }finally{await f.db.close();}
});

test('proof, lease, revocation and browser boundaries protect both report actions',async()=>{
 const f=await fixture();try{
  const other=await connectedVenue(f.db,f.issuer,origin),body=report();
  assert.equal((await f.request('error-report',{...f.box.proof('error-report',body,randomUUID(),f.box.lease),signature:'a'.repeat(86)})).status,401);
  const valid=f.box.proof('error-report',body,randomUUID(),f.box.lease);
  assert.equal((await f.request('error-report',{...valid,signature:sign(null,Buffer.from(valid.payload,'base64url'),generateKeyPairSync('ed25519').privateKey).toString('base64url')})).status,401);
  const forgedLease={...f.box.lease,signature:sign(null,Buffer.from(f.box.lease.payload,'base64url'),generateKeyPairSync('ed25519').privateKey).toString('base64url')};
  assert.equal((await f.request('error-report',f.box.proof('error-report',body,randomUUID(),forgedLease))).status,401);
  assert.equal((await f.request('error-report',f.box.proof('report',body,randomUUID(),f.box.lease))).status,401);
  assert.equal((await f.request('error-report',f.box.proof('error-report',body,randomUUID(),other.lease))).status,401);
  assert.equal((await f.request('error-report',f.box.proof('error-report',body,randomUUID()))).status,401);
  assert.equal((await f.request('error-report',f.box.proof('error-report',body,randomUUID(),f.box.lease,undefined,Date.now()-60001))).status,401);
  assert.equal((await f.request('error-report',f.box.proof('error-report',body,randomUUID(),f.box.lease,undefined,Date.now(),{origin:'https://elsewhere.example.test'}))).status,401);
  assert.equal((await f.request('error-report',{}, {origin})).status,403);
  assert.equal((await f.request('release-held',{}, {},'GET')).status,405);
  await f.db.pool.query('DELETE FROM account_rate_limits');
  await f.db.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[f.box.installationId]);
  assert.equal((await f.send(body)).status,403);
  assert.equal((await f.request('release-held',f.box.proof('release-held',{version:'1.0.0'},randomUUID(),f.box.lease))).status,403);
  assert.equal((await f.db.pool.query('SELECT count(*) FROM installation_error_reports')).rows[0].count,'0');
 }finally{await f.db.close();}
});

test('a moved source stays the same error and the doubled count boundary is inclusive',async()=>{
 const f=await fixture();try{
  const b=await connectedVenue(f.db,f.issuer,origin);
  for(const who of [f.box,b])assert.equal((await f.send(report('2.0.0','storage.disk_full',3),who)).status,200);
  assert.equal((await f.send({...report('2.1.0','storage.disk_full',5),source:'packages/storage/src/new.ts#write'})).status,200);
  assert.equal((await f.send({...report('2.1.0','storage.disk_full',6),source:'packages/storage/src/new.ts#write'},b)).status,200);
  assert.deepEqual(await f.held('2.1.0'),{version:'2.1.0',held:false});
  assert.equal((await f.send(report('2.1.0','storage.disk_full',1))).status,200);
  assert.deepEqual(await f.held('2.1.0'),{version:'2.1.0',held:true});
 }finally{await f.db.close();}
});

test('new error count floor still applies when two boxes reported it',async()=>{
 const f=await fixture();try{
  const b=await connectedVenue(f.db,f.issuer,origin);
  for(const who of [f.box,b])assert.equal((await f.send(report('3.0.0','network.unavailable',1),who)).status,200);
  assert.equal((await f.send(report('3.1.0','storage.disk_full',3))).status,200);
  assert.equal((await f.send(report('3.1.0','storage.disk_full',1),b)).status,200);
  assert.deepEqual(await f.held('3.1.0'),{version:'3.1.0',held:false});
  assert.equal((await f.send(report('3.1.0','storage.disk_full',1))).status,200);
  assert.deepEqual(await f.held('3.1.0'),{version:'3.1.0',held:true});
 }finally{await f.db.close();}
});

test('a test version never supplies a production predecessor; late predecessors recompute the read',async()=>{
 const f=await fixture();try{
  const b=await connectedVenue(f.db,f.issuer,origin);
  for(const who of [f.box,b])assert.equal((await f.send(report('4.1.0','storage.disk_full',3),who)).status,200);
  assert.deepEqual(await f.held('4.1.0'),{version:'4.1.0',held:false});
  for(const who of [f.box,b])assert.equal((await f.send(report('4.0.0','network.unavailable',1),who)).status,200);
  assert.deepEqual(await f.held('4.1.0'),{version:'4.1.0',held:true});
  const p=await connectedVenue(f.db,f.issuer,origin);
  await f.db.pool.query("UPDATE venues SET environment='production' WHERE id=$1",[p.venueId]);
  const pub=(await f.db.pool.query('SELECT public_key FROM installations WHERE id=$1',[p.installationId])).rows[0].public_key,now=Date.now();
  const lease=f.issuer.issue({origin,leaseId:randomUUID(),installationId:p.installationId,venueId:p.venueId,environment:'production',publicKey:pub,issuedAt:now,expiresAt:now+3600000});
  const r=await f.request('release-held',p.proof('release-held',{version:'4.1.0'},randomUUID(),lease));assert.equal(r.status,200);assert.deepEqual(await r.json(),{version:'4.1.0',held:false});
 }finally{await f.db.close();}
});

test('doubling normalizes by all reporting boxes and needs two boxes seeing the error',async()=>{
 const f=await fixture();try{
  const b=await connectedVenue(f.db,f.issuer,origin),c=await connectedVenue(f.db,f.issuer,origin),d=await connectedVenue(f.db,f.issuer,origin);
  for(const who of [f.box,b])assert.equal((await f.send(report('5.0.0','storage.disk_full',3),who)).status,200);
  for(const who of [f.box,b])assert.equal((await f.send(report('5.1.0','storage.disk_full',6),who)).status,200);
  for(const who of [c,d])assert.equal((await f.send(report('5.1.0','network.unavailable',1),who)).status,200);
  assert.deepEqual(await f.held('5.1.0'),{version:'5.1.0',held:false});
  assert.equal((await f.send(report('5.1.0','storage.disk_full',12))).status,200);
  assert.deepEqual(await f.held('5.1.0'),{version:'5.1.0',held:true});
  assert.equal((await f.send(report('5.2.0','storage.disk_full',100))).status,200);
  assert.deepEqual(await f.held('5.2.0'),{version:'5.2.0',held:false});
  assert.equal((await f.send(report('5.2.0','storage.disk_full',1),b)).status,200);
  assert.deepEqual(await f.held('5.2.0'),{version:'5.2.0',held:true});
 }finally{await f.db.close();}
});

test('an error flood uses its own key allowance and still permits credential renewal',async()=>{
 const f=await fixture();try{
  for(let i=0;i<10;i++)assert.equal((await f.send(report())).status,200);
  const refused=await f.send(report());assert.equal(refused.status,429);assert(Number(refused.headers.get('retry-after'))>0);
  assert.deepEqual(await f.held('1.0.0'),{version:'1.0.0',held:false});
  const renewed=await f.request('renew',f.box.proof('renew',{}));assert.equal(renewed.status,200,await renewed.clone().text());
  for(let i=0;i<29;i++)assert.deepEqual(await f.held('1.0.0'),{version:'1.0.0',held:false});
  assert.equal((await f.request('release-held',f.box.proof('release-held',{version:'1.0.0'},randomUUID(),f.box.lease))).status,429);
 }finally{await f.db.close();}
});

for(const mode of ['revocation','key rotation','lease expiry','proof expiry','proof expiry after insert wait'] as const)test('report rechecks '+mode+' under real PostgreSQL contention',async()=>{
 const f=await fixture(),lock=await f.db.secondPool.connect();let pending:Promise<Response>|undefined;
 try{
  const now=Date.now(),issuedAt=mode.startsWith('proof expiry')?now-58000:now,expiresAt=now+1000;
  const lease=mode==='lease expiry'?f.issuer.issue({origin,leaseId:randomUUID(),installationId:f.box.installationId,venueId:f.box.venueId,environment:'test',publicKey:f.box.installationKey,issuedAt:now-1000,expiresAt}):f.box.lease;
  await lock.query('BEGIN');
  if(mode.endsWith('insert wait'))await lock.query('LOCK TABLE installation_error_reports IN SHARE MODE');
  else await lock.query('SELECT id FROM installations WHERE id=$1 FOR UPDATE',[f.box.installationId]);
  pending=Promise.resolve(f.request('error-report',f.box.proof('error-report',report(),randomUUID(),lease,undefined,issuedAt)));
  const pattern=mode.endsWith('insert wait')?'INSERT INTO installation_error_reports%':'SELECT public_key,venue_id,revoked_at%';
  let waiting=false;const deadline=Date.now()+5000;
  while(Date.now()<deadline){
   if((await f.db.pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE $2",[f.db.schema,pattern])).rowCount){waiting=true;break;}
   await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.equal(waiting,true,'the real report query must reach the held lock');
  if(mode==='revocation')await lock.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[f.box.installationId]);
  else if(mode==='key rotation')await lock.query('UPDATE installations SET public_key=$2 WHERE id=$1',[f.box.installationId,generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url')]);
  else await new Promise(resolve=>setTimeout(resolve,Math.max(0,(mode==='lease expiry'?expiresAt:issuedAt+60001)-Date.now()+10)));
  await lock.query('COMMIT');const r=await pending;assert.equal(r.status,mode==='revocation'?403:401,await r.clone().text());
  assert.equal((await f.db.pool.query('SELECT count(*) FROM installation_error_reports')).rows[0].count,'0');
 }finally{await lock.query('ROLLBACK');lock.release();await pending;await f.db.close();}
});
