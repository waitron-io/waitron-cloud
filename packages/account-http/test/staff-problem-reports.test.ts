import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {request as httpRequest} from 'node:http';
import {test} from 'node:test';
import {serve} from '@hono/node-server';
import type {HttpBindings} from '@hono/node-server';
import {createLeaseIssuer} from '@waitron-cloud/registration';
import {connectedVenue,database} from '../../translation/test/fixtures.ts';
import {createAccountApp} from '../src/app.ts';
import {staffProblemReports} from '../../operations/src/staff-problem-reports.ts';

const origin='https://cloud.example.test',source='packages/storage/src/archive.ts#write';
const log={level:'error',code:'storage.disk_full',source};
const report=()=>({version:'1.2.3',time:1700000000000,logs:[log],details:{device:'till',equipment:['printer'],upgradedAt:null,hosting:'unknown'}});
async function fixture(){
 const db=await database();try{
  const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
  const box=await connectedVenue(db,issuer,origin);
  const app=createAccountApp({pool:db.pool,outbox:db.outbox,leaseIssuer:issuer,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]}});
  const request=(action:string,body:unknown,headers:Record<string,string>={},method='POST')=>app.request(origin+'/api/installations/'+action,{method,headers:{'content-type':'application/json',...headers},...(method==='GET'?{}:{body:JSON.stringify(body)})},{incoming:{socket:{remoteAddress:'203.0.113.62'}}} as HttpBindings);
  const signed=(action:string,value:unknown,who=box,id=randomUUID(),raw=JSON.stringify(value))=>({
   ...who.proof(action,{version:1,bodySha256:createHash('sha256').update(raw).digest('hex'),bodyBytes:Buffer.byteLength(raw)},id,who.lease),body:raw,
  });
  const send=(value:unknown=report(),who=box,id=randomUUID())=>request('staff-report',signed('staff-report',value,who,id));
  const describe=(reportId:string,description:string,who=box,id=randomUUID())=>request('staff-description',signed('staff-description',{reportId,description},who,id));
  const reset=()=>db.pool.query('DELETE FROM account_rate_limits');
  return {db,issuer,box,app,request,signed,send,describe,reset};
 }catch(error){await db.close();throw error;}
}

test('signed staff attachments are received in the shared venue report without automatic opt-in or usage writes',async()=>{
 const f=await fixture();try{
  const id=randomUUID(),body=report(),contact=(await f.db.pool.query('SELECT last_contact_at FROM installations WHERE id=$1',[f.box.installationId])).rows;
  const operations=(await f.db.pool.query('SELECT count(*) FROM installation_operations')).rows;
  const r=await f.send(body,f.box,id);assert.equal(r.status,200,await r.clone().text());assert.deepEqual(await r.json(),{received:true});
  assert.equal(r.headers.get('cache-control'),'no-store');
  assert.deepEqual((await f.db.pool.query(`SELECT r.kind,r.operation_id,r.logs,r.details,r.description,r.code,r.occurrences,i.venue_id
   FROM installation_error_reports r JOIN installations i ON i.id=r.installation_id`)).rows,
  [{kind:'staff',operation_id:id,logs:body.logs,details:body.details,description:null,code:null,occurrences:null,venue_id:f.box.venueId}]);
  assert.deepEqual((await f.db.pool.query('SELECT last_contact_at FROM installations WHERE id=$1',[f.box.installationId])).rows,contact);
  assert.deepEqual((await f.db.pool.query('SELECT count(*) FROM installation_operations')).rows,operations);
 }finally{await f.db.close();}
});

test('a box sends a report and its description over loopback HTTP and the owner reads the matching group',async()=>{
 const f=await fixture(),server=serve({fetch:f.app.fetch,hostname:'127.0.0.1',port:0});
 try{
  if(!server.listening)await once(server,'listening');const address=server.address();assert(address&&typeof address!=='string');
  const id=randomUUID();
  const send=async(action:string,body:unknown)=>new Promise<{status:number|undefined;body:string}>((resolve,reject)=>{
   const text=JSON.stringify(f.signed(action,body,f.box,action==='staff-report'?id:randomUUID()));
   const req=httpRequest({hostname:'127.0.0.1',port:address.port,path:'/api/installations/'+action,method:'POST',headers:{host:'cloud.example.test','content-type':'application/json','content-length':Buffer.byteLength(text),connection:'close'}},res=>{
    let received='';res.on('data',chunk=>{received+=chunk;});res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,body:received}));
   });req.on('error',reject);req.end(text);
  });
  for(const [action,body] of [['staff-report',report()],['staff-description',{reportId:id,description:'Synthetic printer stopped'}]] as const){
   const r=await send(action,body);assert.equal(r.status,200,r.body);assert.deepEqual(JSON.parse(r.body),{received:true});
  }
  const automatic={code:log.code,source,version:'1.2.3',time:1700000000000,count:3,logs:[]};
  assert.equal((await f.request('error-report',f.box.proof('error-report',automatic,randomUUID(),f.box.lease))).status,200);
  const view=await staffProblemReports(f.db.pool,'test');assert.equal(view.reports[0]!.description,'Synthetic printer stopped');
  assert.deepEqual(view.groups,[{code:'storage.disk_full',version:'1.2.3',automaticOccurrences:'3',staffReports:1}]);
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await f.db.close();}
});

test('staff request reading enforces actual byte and five-second stream limits',async()=>{
 const f=await fixture();try{
  const url=origin+'/api/installations/staff-report',bindings={incoming:{socket:{remoteAddress:'203.0.113.62'}}} as HttpBindings;
  const oversized=await f.app.request(url,{method:'POST',headers:{'content-type':'application/json'},body:'x'.repeat(65537)},bindings);assert.equal(oversized.status,413);
  let cancelled=false;
  const stream=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(Buffer.from('{'));},cancel(){cancelled=true;}});
  const slow=await f.app.request(new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:stream,duplex:'half'} as RequestInit),undefined,bindings);
  assert.equal(slow.status,408);assert.equal(cancelled,true);
  assert.equal((await f.db.pool.query('SELECT count(*) FROM installation_error_reports')).rows[0].count,'0');
 }finally{await f.db.close();}
});

test('missing and foreign descriptions retry without inserting, then a late description is immutable and replayable',async()=>{
 const f=await fixture();try{
  const id=randomUUID(),descriptionId=randomUUID(),text='Printer stopped.\nPlease check\ttray.',other=await connectedVenue(f.db,f.issuer,origin);
  const early=await f.describe(id,text,f.box,descriptionId);assert.equal(early.status,404);assert.deepEqual(await early.json(),{error:'report_not_found'});
  assert.equal((await f.db.pool.query('SELECT count(*) FROM installation_error_reports')).rows[0].count,'0');
  assert.equal((await f.send(report(),f.box,id)).status,200);
  const foreign=await f.describe(id,text,other);assert.equal(foreign.status,404);assert.deepEqual(await foreign.json(),{error:'report_not_found'});
  const replies=await Promise.all([f.describe(id,text,f.box,descriptionId),f.describe(id,text,f.box,descriptionId)]);
  for(const r of replies){assert.equal(r.status,200,await r.clone().text());assert.deepEqual(await r.json(),{received:true});}
  assert.equal((await f.describe(id,'Changed',f.box,descriptionId)).status,409);
  assert.equal((await f.describe(id,'Changed')).status,409);
  assert.deepEqual((await f.db.pool.query('SELECT description,description_operation_id FROM installation_error_reports')).rows,[{description:text,description_operation_id:descriptionId}]);
  await f.reset();assert.equal((await f.send({...report(),description:'Admin sent initially'})).status,200);
  assert.equal((await f.describe(id,'Admin sent initially')).status,409);
 }finally{await f.db.close();}
});

test('concurrent report retries keep one row and operation IDs cannot switch report kinds or description targets',async()=>{
 const f=await fixture();try{
  const id=randomUUID(),body=report(),replies=await Promise.all([f.send(body,f.box,id),f.send(body,f.box,id)]);
  for(const r of replies)assert.equal(r.status,200,await r.clone().text());
  assert.equal((await f.send({...body,time:body.time+1},f.box,id)).status,409);
  const automatic={code:log.code,source,version:'1.2.3',time:body.time,count:1,logs:[log]},autoId=randomUUID();
  assert.equal((await f.request('error-report',f.box.proof('error-report',automatic,id,f.box.lease))).status,409);
  assert.equal((await f.request('error-report',f.box.proof('error-report',automatic,autoId,f.box.lease))).status,200);
  assert.equal((await f.send(body,f.box,autoId)).status,409);
  const automaticDescription=await f.describe(autoId,'Text');assert.equal(automaticDescription.status,404);assert.deepEqual(await automaticDescription.json(),{error:'report_not_found'});
  assert.equal((await f.describe(id,'Text',f.box,autoId)).status,409);
  await f.reset();const descId=randomUUID();assert.equal((await f.describe(id,'Text',f.box,descId)).status,200);
  assert.equal((await f.send(body,f.box,descId)).status,409);
  assert.equal((await f.request('error-report',f.box.proof('error-report',automatic,descId,f.box.lease))).status,409);
  const second=randomUUID();assert.equal((await f.send({...body,logs:[]},f.box,second)).status,200);
  assert.equal((await f.describe(second,'Text',f.box,descId)).status,409);
  assert.equal((await f.db.pool.query('SELECT count(*) FROM installation_error_reports')).rows[0].count,'3');
 }finally{await f.db.close();}
});

test('staff bodies reject private extra metadata, malformed Unicode, controls and every attachment or description bound',async()=>{
 const f=await fixture();try{
  const b=report(),bad=[{...b,venueName:'Private name'},{...b,logs:[{...log,text:'Private log'}]},{...b,logs:Array(9).fill(log)},
   {...b,logs:[{...log,code:'private text'}]},{...b,logs:[{...log,source:'../secret'}]},{...b,logs:[{...log,level:'fatal'}]},
   {...b,version:'1.0.0-beta'},{...b,version:'2147483648.0.0'},{...b,time:-1},{...b,time:Date.now()+120000},
   {...b,details:{...b.details,name:'Private printer'}},{...b,details:{...b.details,device:'Private till'}},
   {...b,details:{...b.details,equipment:Array(17).fill('printer')}},{...b,details:{...b.details,equipment:['serial123']}},
   {...b,details:{...b.details,hosting:'paid'}},{...b,details:{...b.details,upgradedAt:-1}},
   {...b,description:'x'.repeat(2001)},{...b,description:'😀'.repeat(2001)},{...b,description:'\ud800'},
   {...b,description:'bad\u0000text'},{...b,description:'bad\u0085text'},{...b,description:''}];
  for(const body of bad){await f.reset();const r=await f.send(body);assert.equal(r.status,400,JSON.stringify(body)+':'+await r.clone().text());}
  assert.equal((await f.db.pool.query('SELECT count(*) FROM installation_error_reports')).rows[0].count,'0');
  for(const description of ['x'.repeat(2000),'😀'.repeat(2000)]){await f.reset();const r=await f.send({...b,description});assert.equal(r.status,200,await r.clone().text());}
  await f.reset();assert.equal((await f.send({...b,logs:Array(8).fill(log),details:{device:'unknown',equipment:Array(16).fill('other'),upgradedAt:1700000000000,hosting:'hosted'}})).status,200);
 }finally{await f.db.close();}
});

test('external staff bodies are fingerprint-bound and keep the shared signed envelope limits',async()=>{
 const f=await fixture();try{
  const good=f.signed('staff-report',report()),changed={...good,body:JSON.stringify({...report(),description:'Unsigned'})};
  assert.equal((await f.request('staff-report',changed)).status,401);
  const short=f.box.proof('staff-report',{version:1,bodySha256:'0'.repeat(64),bodyBytes:10},randomUUID(),f.box.lease);
  assert.equal((await f.request('staff-report',{...short,body:good.body})).status,401);
  assert.equal((await f.request('staff-report',{...good,signature:'a'.repeat(86)})).status,401);
  assert.equal((await f.request('staff-report',f.signed('staff-description',report()))).status,401);
  const raw=' '.repeat(16385);assert.equal((await f.request('staff-report',f.signed('staff-report',{},f.box,randomUUID(),raw))).status,400);
  assert.equal((await f.request('staff-report',{...good,extra:'private'})).status,400);
  assert.equal((await f.request('staff-report',good,{'content-length':'65537'})).status,413);
  assert.equal((await f.request('staff-report',good,{origin})).status,403);
  assert.equal((await f.request('staff-description',good,{},'GET')).status,405);
  assert.equal((await f.db.pool.query('SELECT count(*) FROM installation_error_reports')).rows[0].count,'0');
 }finally{await f.db.close();}
});

test('staff rows never affect automatic version hold denominators or predecessors',async()=>{
 const f=await fixture();try{
  const b=await connectedVenue(f.db,f.issuer,origin),c=await connectedVenue(f.db,f.issuer,origin);
  const automatic=(version:string,code:string,count:number)=>({code,source,version,time:1700000000000,count,logs:[]});
  for(const who of [f.box,b])for(const [version,code,count] of [['1.0.0','storage.disk_full',3],['1.2.3','storage.disk_full',6]] as const){
   assert.equal((await f.request('error-report',who.proof('error-report',automatic(version,code,count),randomUUID(),who.lease))).status,200);
  }
  const held=async()=>{const r=await f.request('release-held',f.box.proof('release-held',{version:'1.2.3'},randomUUID(),f.box.lease));assert.equal(r.status,200);return r.json();};
  assert.deepEqual(await held(),{version:'1.2.3',held:true});
  for(const who of [f.box,b,c])for(const version of ['1.2.3','1.1.0'])assert.equal((await f.send({...report(),version},who)).status,200);
  assert.deepEqual(await held(),{version:'1.2.3',held:true});
 }finally{await f.db.close();}
});

test('staff attachments cannot invent a closer automatic predecessor or turn a stable error into a hold',async()=>{
 const f=await fixture();try{
  const b=await connectedVenue(f.db,f.issuer,origin);
  for(const who of [f.box,b])for(const version of ['1.0.0','1.2.3']){
   const body={code:log.code,source,version,time:1700000000000,count:3,logs:[]};
   assert.equal((await f.request('error-report',who.proof('error-report',body,randomUUID(),who.lease))).status,200);
  }
  const held=async()=>{const r=await f.request('release-held',f.box.proof('release-held',{version:'1.2.3'},randomUUID(),f.box.lease));assert.equal(r.status,200);return r.json();};
  assert.deepEqual(await held(),{version:'1.2.3',held:false});
  for(const who of [f.box,b])assert.equal((await f.send({...report(),version:'1.1.0'},who)).status,200);
  assert.deepEqual(await held(),{version:'1.2.3',held:false});
 }finally{await f.db.close();}
});

test('staff enum values are strings and a report retry cannot cross its retained environment',async()=>{
 const f=await fixture();try{
  const b=report();
  for(const body of [{...b,logs:[{...log,level:['error']}]},{...b,details:{...b.details,device:['till']}},{...b,details:{...b.details,hosting:['hosted']}}]){
   const r=await f.send(body);assert.equal(r.status,400,await r.clone().text());
  }
  const id=randomUUID();assert.equal((await f.send(b,f.box,id)).status,200);
  await f.db.pool.query("UPDATE venues SET environment='production' WHERE id=$1",[f.box.venueId]);
  const now=Date.now(),lease=f.issuer.issue({origin,leaseId:randomUUID(),installationId:f.box.installationId,venueId:f.box.venueId,environment:'production',publicKey:f.box.installationKey,issuedAt:now,expiresAt:now+3600000});
  const moved={...f.box,lease};
  const absent=await f.describe(id,'Private description',moved);assert.equal(absent.status,404);assert.deepEqual(await absent.json(),{error:'report_not_found'});
  assert.equal((await f.send(b,moved,id)).status,409);
  assert.equal((await f.db.pool.query('SELECT description FROM installation_error_reports WHERE operation_id=$1',[id])).rows[0].description,null);
 }finally{await f.db.close();}
});

test('a database write failure acknowledges nothing and the same signed report can retry',async()=>{
 const f=await fixture();try{
  await f.db.pool.query("CREATE FUNCTION refuse_staff() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic private failure'; END $$");
  await f.db.pool.query('CREATE TRIGGER refuse_staff BEFORE INSERT ON installation_error_reports FOR EACH ROW EXECUTE FUNCTION refuse_staff()');
  const id=randomUUID(),r=await f.send(report(),f.box,id);assert.equal(r.status,503);assert.deepEqual(await r.json(),{error:'temporarily_unavailable'});
  assert.equal((await f.db.pool.query('SELECT count(*) FROM installation_error_reports')).rows[0].count,'0');
  await f.db.pool.query('DROP TRIGGER refuse_staff ON installation_error_reports');
  assert.equal((await f.send(report(),f.box,id)).status,200);
 }finally{await f.db.close();}
});

for(const action of ['staff-report','staff-description'] as const)for(const mode of ['revocation','key rotation','environment','venue','lease expiry','proof expiry after write'] as const)test(action+' rechecks '+mode+' during a real database wait',async()=>{
 const f=await fixture(),lock=await f.db.secondPool.connect();let pending:Promise<Response>|undefined;
 try{
  const reportId=randomUUID();if(action==='staff-description')assert.equal((await f.send(report(),f.box,reportId)).status,200);
  const now=Date.now(),issuedAt=mode==='proof expiry after write'?now-58000:now,expiresAt=now+1200;
  const lease=mode==='lease expiry'?f.issuer.issue({origin,leaseId:randomUUID(),installationId:f.box.installationId,venueId:f.box.venueId,environment:'test',publicKey:f.box.installationKey,issuedAt:now-1000,expiresAt}):f.box.lease;
  const who={...f.box,lease},body=action==='staff-report'?report():{reportId,description:'Admin sent this'},raw=JSON.stringify(body);
  const signed={...who.proof(action,{version:1,bodySha256:createHash('sha256').update(raw).digest('hex'),bodyBytes:Buffer.byteLength(raw)},randomUUID(),who.lease,undefined,issuedAt),body:raw};
  await lock.query('BEGIN');
  if(mode==='proof expiry after write')await lock.query('LOCK TABLE installation_error_reports IN SHARE MODE');
  else if(mode==='environment')await lock.query('SELECT id FROM venues WHERE id=$1 FOR UPDATE',[f.box.venueId]);
  else await lock.query('SELECT id FROM installations WHERE id=$1 FOR UPDATE',[f.box.installationId]);
  pending=Promise.resolve(f.request(action,signed));
  const pattern=mode==='proof expiry after write'?(action==='staff-report'?'INSERT INTO installation_error_reports%':'UPDATE installation_error_reports%'):mode==='environment'?'SELECT environment FROM venues%':'SELECT public_key,venue_id,revoked_at%';
  let waiting=false;const deadline=Date.now()+5000;
  while(Date.now()<deadline){
   if((await f.db.pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE $2",[f.db.schema,pattern])).rowCount){waiting=true;break;}
   await new Promise(resolve=>setTimeout(resolve,5));
  }
  assert.equal(waiting,true,'the staff request must reach the controlled lock');
  if(mode==='revocation')await lock.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[f.box.installationId]);
  else if(mode==='key rotation')await lock.query('UPDATE installations SET public_key=$2 WHERE id=$1',[f.box.installationId,generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url')]);
  else if(mode==='environment')await lock.query("UPDATE venues SET environment='production' WHERE id=$1",[f.box.venueId]);
  else if(mode==='venue'){
   const other=await connectedVenue(f.db,f.issuer,origin);
   await lock.query('UPDATE installations SET revoked_at=clock_timestamp(),superseded_by=$2 WHERE id=$1',[other.installationId,f.box.installationId]);
   await lock.query('UPDATE installations SET venue_id=$2 WHERE id=$1',[f.box.installationId,other.venueId]);
  }else await new Promise(resolve=>setTimeout(resolve,Math.max(0,(mode==='lease expiry'?expiresAt:issuedAt+60001)-Date.now()+10)));
  await lock.query('COMMIT');const r=await pending;assert.equal(r.status,mode==='revocation'?403:401,await r.clone().text());
  const rows=(await f.db.pool.query('SELECT description FROM installation_error_reports WHERE installation_id=$1',[f.box.installationId])).rows;
  assert.deepEqual(rows,action==='staff-report'?[]:[{description:null}]);
 }finally{await lock.query('ROLLBACK');lock.release();await pending;await f.db.close();}
});
