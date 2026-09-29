import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import type {HttpBindings} from '@hono/node-server';
import {SignupStore} from '@waitron-cloud/registration';
import {pairingPayload,type PairingClaims} from '../../registration/src/pairing-proof.ts';
import {startAccountServer} from '../src/server.ts';
import {createAccountApp} from '../src/app.ts';
import {database} from './fixtures.ts';
let db:Awaited<ReturnType<typeof database>>;let app:ReturnType<typeof createAccountApp>;
let owner:{accountId:string;organisationId:string;legalBusinessId:string};let cookie:string;let csrf:string;
const origin='https://cloud.example.test',password='A long enough café password';
const settings=()=>({portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]});
function request(path:string,body?:unknown,headers:Record<string,string>={},target=app,method=body===undefined?'GET':'POST'){
  return target.request(origin+path,{method,headers:{'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)},{incoming:{socket:{remoteAddress:'192.0.2.1'}}} as HttpBindings);
}
const browser=(path:string,body?:unknown,headers:Record<string,string>={})=>request('/api/account/pairing/'+path,body,{origin,cookie,'x-csrf-token':csrf,...headers});
function machine(){const keys=generateKeyPairSync('ed25519');const c:PairingClaims={origin,action:'start',requestId:randomUUID(),publicKey:keys.publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',code:'12345678',organisationId:'',legalBusinessId:'',issuedAt:Date.now()};
  function proof(action:PairingClaims['action'],changes:Partial<PairingClaims>={}){const bytes=pairingPayload({...c,action,code:action==='start'?c.code:'',organisationId:action==='complete'?owner.organisationId:'',legalBusinessId:action==='complete'?owner.legalBusinessId:'',issuedAt:Date.now(),...changes});return {payload:bytes.toString('base64url'),signature:sign(null,bytes,keys.privateKey).toString('base64url')};}
  return {c,proof,call:(action:PairingClaims['action'],changes:Partial<PairingClaims>={})=>request('/api/pairing/'+action,proof(action,changes))};
}
const choice=(m:ReturnType<typeof machine>)=>({requestId:m.c.requestId,code:m.c.code,organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId});
before(async()=>{db=await database();});after(async()=>db?.close());
beforeEach(async()=>{
  await db.pool.query('TRUNCATE pairing_requests, account_rate_limits, signup_requests, email_outbox, organisations, cloud_accounts CASCADE');app=createAccountApp({pool:db.pool,outbox:db.outbox,config:settings()});
  const signup=new SignupStore(db.pool,db.outbox);await signup.request('owner@example.test');const mail=db.outbox.open((await db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert.ok('token' in mail);
  owner=await signup.complete(mail.token,{password,organisationName:'Café Sol',legalBusinessName:'Café Sol SL',countryCode:'ES'});
  const logged=await request('/api/account/login',{email:'owner@example.test',password},{origin});assert.equal(logged.status,200);
  cookie=logged.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');csrf=/__Host-cloud_csrf=([^;]+)/.exec(cookie)![1]!;
});
test('signed machines and browser approval link two distinct venues with durable retry',async()=>{
  const a=machine(),b=machine();assert.equal((await browser('businesses')).status,200);
  for(const m of [a,b]) {
    const started=await m.call('start');assert.equal(started.status,200);assert.equal((await started.json() as {state:string}).state,'awaiting_cloud');
    assert.equal((await m.call('complete')).status,400);
    const inspect=await browser('inspect',{requestId:m.c.requestId,code:m.c.code});assert.equal(inspect.status,200);assert.equal((await inspect.json() as {localVenueId:string}).localVenueId,m.c.localVenueId);
    assert.equal((await browser('approve',choice(m))).status,200);
  }
  assert.equal((await db.pool.query('SELECT count(*) FROM installations')).rows[0].count,'0');
  const first=await a.call('complete');assert.equal(first.status,200);const result=await first.json();
  app=createAccountApp({pool:db.secondPool,outbox:db.outbox,config:settings()});assert.deepEqual(await (await a.call('complete')).json(),result);
  assert.equal((await b.call('complete')).status,200);assert.equal((await db.pool.query('SELECT count(*) FROM installations')).rows[0].count,'2');
  assert.equal((await a.call('status',{publicKey:b.c.publicKey})).status,401);
});
test('machine and browser authority, action, origin, method and shape stay separate',async()=>{
  const m=machine();
  assert.equal((await request('/api/pairing/start',m.proof('start'),{origin})).status,403);
  assert.equal((await request('/api/pairing/start',{}, {cookie})).status,400);
  assert.equal((await request('/api/pairing/status',m.proof('start'))).status,401);
  assert.equal((await m.call('start',{origin:'https://wrong.example'})).status,401);
  assert.equal((await request('/api/pairing/start')).status,405);
  assert.equal((await request('/api/pairing/start',{...m.proof('start'),extra:'secret'})).status,400);
  assert.equal((await m.call('start')).status,200);
  for(const headers of [{origin:'https://wrong.example'},{'x-csrf-token':'wrong'},{cookie:''}] as Record<string,string>[])assert.ok([401,403].includes((await browser('approve',choice(m),headers)).status));
  assert.equal((await request('/api/account/pairing/approve',m.proof('complete'),{origin,cookie,'x-csrf-token':csrf})).status,400);
  assert.equal((await db.pool.query('SELECT count(*) FROM installations')).rows[0].count,'0');
});
test('code refusal persists and public errors never echo private input',async()=>{
  const m=machine();await m.call('start');
  for(let i=0;i<5;i++){const response=await browser('inspect',{requestId:m.c.requestId,code:'87654321'});assert.equal(response.status,400);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.equal((await response.text()).includes('87654321'),false);}
  assert.equal((await browser('approve',choice(m))).status,400);
});
test('pairing start limits persist across app workers',async()=>{
  for(let i=0;i<10;i++){const m=machine();assert.equal((await m.call('start')).status,200);app=createAccountApp({pool:i%2?db.pool:db.secondPool,outbox:db.outbox,config:settings()});}
  const response=await machine().call('start');assert.equal(response.status,429);assert.ok(Number(response.headers.get('retry-after'))>0);
});

test('real sockets retain pairing state after server restart with portal assets enabled',async()=>{
  const assets=new Map([['/index.html',{body:Buffer.from('<title>Cloud</title>'),contentType:'text/html'}]]);
  const start=()=>startAccountServer({pool:db.pool,outbox:db.outbox,config:settings(),port:0,portalAssets:assets});
  let running=await start();
  const send=(path:string,body:unknown,headers:Record<string,string>={})=>new Promise<Response>((resolve,reject)=>{
    const req=httpRequest({host:'127.0.0.1',port:(running.server.address() as {port:number}).port,path,method:'POST',headers:{host:'cloud.example.test','content-type':'application/json',...headers}},res=>{
      let text='';res.on('data',chunk=>{text+=chunk;});res.on('end',()=>resolve(new Response(text,{status:res.statusCode!})));res.on('error',reject);
    });req.on('error',reject);req.end(JSON.stringify(body));
  });
  try {
    const first=machine(),second=machine();
    for(const m of [first,second]){
      assert.equal((await send('/api/pairing/start',m.proof('start'))).status,200);
      assert.equal((await send('/api/account/pairing/approve',choice(m),{origin,cookie,'x-csrf-token':csrf})).status,200);
    }
    const response=await send('/api/pairing/complete',first.proof('complete'));assert.equal(response.status,200);await response.body?.cancel();
    await running.close();running=await start();
    const recovered=await send('/api/pairing/complete',first.proof('complete'));assert.equal(recovered.status,200);
    const a=await recovered.json() as {registration:{installationId:string}};
    const b=await (await send('/api/pairing/complete',second.proof('complete'))).json() as {registration:{installationId:string}};
    assert.notEqual(a.registration.installationId,b.registration.installationId);
    assert.equal((await db.pool.query('SELECT count(*) FROM installations')).rows[0].count,'2');
  }finally{await running.close();}
});

test('HTTP pairing requires an external key, preserves rotation overlap and never echoes secrets',async()=>{
  const old={activeKeyId:'old',keys:{old:'a'.repeat(64)}};
  app=createAccountApp({pool:db.pool,outbox:db.outbox,config:settings(),pairingCodeKeys:old});
  const a=machine();assert.equal((await a.call('start')).status,200);
  const hash=(await db.pool.query('SELECT code_hash FROM pairing_requests WHERE id=$1',[a.c.requestId])).rows[0].code_hash;
  assert.match(hash,/^v1:old:/);
  app=createAccountApp({pool:db.pool,outbox:db.outbox,config:settings(),pairingCodeKeys:null});
  const refused=await browser('approve',choice(a));assert.equal(refused.status,503);
  const text=await refused.text();assert.equal(text.includes(a.c.code),false);assert.equal(text.includes(old.keys.old),false);
  assert.equal((await db.pool.query('SELECT failed_codes FROM pairing_requests')).rows[0].failed_codes,0);
  assert.equal((await a.call('status')).status,200);
  assert.equal((await machine().call('start')).status,503);
  const wrong={activeKeyId:'old',keys:{old:'b'.repeat(64)}};
  app=createAccountApp({pool:db.pool,outbox:db.outbox,config:settings(),pairingCodeKeys:wrong});
  assert.equal((await browser('approve',choice(a))).status,400);
  app=createAccountApp({pool:db.secondPool,outbox:db.outbox,config:settings(),pairingCodeKeys:{activeKeyId:'new',keys:{...old.keys,new:'c'.repeat(64)}}});
  assert.equal((await a.call('start')).status,200);assert.equal((await browser('approve',choice(a))).status,200);
  assert.equal((await a.call('complete')).status,200);
  const dump=JSON.stringify((await db.pool.query('SELECT * FROM security_audit_events')).rows);
  for(const secret of [a.c.code,old.keys.old,wrong.keys.old])assert.equal(dump.includes(secret),false);
});

test('HTTP code checks keep request separation, concurrent attempt limits and expiry',async()=>{
 const a=machine(),b=machine();b.c.code='87654321';
 assert.equal((await a.call('start')).status,200);assert.equal((await b.call('start')).status,200);
 const guesses=await Promise.all(Array.from({length:8},()=>browser('inspect',{requestId:a.c.requestId,code:b.c.code})));
 assert.equal(guesses.every(r=>r.status===400),true);
 assert.equal((await db.pool.query('SELECT failed_codes FROM pairing_requests WHERE id=$1',[a.c.requestId])).rows[0].failed_codes,5);
 assert.equal((await browser('approve',choice(a))).status,400);
 assert.equal((await browser('approve',choice(b))).status,200);
 await db.pool.query("UPDATE pairing_requests SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[b.c.requestId]);
 assert.equal((await b.call('complete')).status,400);assert.equal((await b.call('start')).status,400);
 assert.equal((await browser('approve',choice(b))).status,400);
 assert.equal((await db.pool.query('SELECT count(*) FROM installations')).rows[0].count,'0');
});
