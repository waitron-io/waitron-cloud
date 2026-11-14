import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {request,type ClientRequest} from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {startAccountServer} from '../src/server.ts';
import type {HttpBindings} from '@hono/node-server';
import {guestMenuFixture} from '../../remote-access/test/fixtures/guest-menu.ts';
import {createLeaseIssuer,transaction} from '@waitron-cloud/registration';
import {readGuestMenu,setGuestMenuBlocked} from '@waitron-cloud/remote-access/guest-menu';
import {connectedVenue,database} from '../../translation/test/fixtures.ts';
import {createAccountApp} from '../src/app.ts';
import {completeEmailProof,emailLoginPolicy} from './fixtures.ts';

test('only the venue owner with exact Origin and CSRF can stop and re-enable guest sharing',async()=>{
 const f=await guestMenuFixture(),origin='https://cloud.example.test',guestOrigin='https://menus.example.test';
 try{
  await f.seed();
  const app=createAccountApp({pool:f.db.pool,outbox:f.db.outbox,guestOrigin,factor:{keys:null,policy:emailLoginPolicy},config:{portalOrigin:origin,production:true,rateKey:f.db.rateKey,trustedProxyIps:[],requireEnrollment:false}});
  const bindings={incoming:{socket:{remoteAddress:'192.0.2.1'}}} as HttpBindings;
  const loginHeaders={origin,'content-type':'application/json'};
  const login=await completeEmailProof(f.db,await app.request(origin+'/api/account/login',{method:'POST',headers:loginHeaders,body:JSON.stringify({email:f.email,password:f.password})},bindings),body=>app.request(origin+'/api/account/login/email',{method:'POST',headers:loginHeaders,body:JSON.stringify(body)},bindings));
  assert.equal(login.status,200);
  const cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),csrf=/__Host-cloud_csrf=([^;]+)/.exec(cookie)![1]!;
  const send=(action:string,body:Record<string,string>={venueId:f.venueId},extra:Record<string,string>={})=>app.request(origin+'/api/account/guest-menu/'+action,{method:'POST',headers:{...loginHeaders,cookie,'x-csrf-token':csrf,...extra},body:JSON.stringify(body)},bindings);
  assert.equal((await send('takedown',{venueId:randomUUID()})).status,403);
  assert.equal((await send('takedown',undefined,{origin:'https://foreign.example.test'})).status,403);
  assert.equal((await send('takedown',undefined,{'x-csrf-token':'wrong'})).status,403);
  assert.equal((await send('takedown',{venueId:f.venueId,unexpected:'field'})).status,400);
  assert.equal((await send('invalid')).status,404);
  const stopped=await send('takedown');assert.equal(stopped.status,200);
  const value=await stopped.json();assert.equal(value.state,'blocked');assert.equal(value.url,guestOrigin+'/m/'+f.venueId);
  assert.deepEqual(await (await send('takedown')).json(),value);
  const enabled=await send('enable');assert.equal(enabled.status,200);assert.equal((await enabled.json()).state,'off');
  await f.db.pool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1',[f.owner.accountId]);
  assert.equal((await send('takedown')).status,403);
  await f.db.pool.query("UPDATE cloud_sessions SET absolute_expires_at=clock_timestamp()-interval '1 second'");
  assert.equal((await send('takedown')).status,401);
 }finally{await f.db.close();}
});

const cloudOrigin='https://cloud.example.test',menuOrigin='https://menus.example.test';
async function deliveryFixture(){
 const db=await database();
 const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url'));
 const box=await connectedVenue(db,issuer,cloudOrigin);
 const options={pool:db.pool,outbox:db.outbox,leaseIssuer:issuer,guestOrigin:menuOrigin,planMode:'test-venue-levels' as const,config:{portalOrigin:cloudOrigin,production:true,rateKey:db.rateKey,trustedProxyIps:[]}};
 const app=createAccountApp(options),bindings={incoming:{socket:{remoteAddress:'192.0.2.91'}}} as HttpBindings;
 const send=(action:string,envelope:unknown,headers:Record<string,string>={},method='POST')=>app.request(cloudOrigin+'/api/installations/guest-menu-'+action,{method,headers:{'content-type':'application/json',...headers},...(method==='GET'?{}:{body:JSON.stringify(envelope)})},bindings);
 const proof=(action:string,body:unknown={version:1})=>box.proof('guest-menu-'+action,body,randomUUID(),box.lease);
 const publish=(body:string,expectedRevision=0)=>({...proof('publish',{version:1,expectedRevision,bodySha256:createHash('sha256').update(body).digest('hex'),bodyBytes:Buffer.byteLength(body)}),body});
 return {db,issuer,box,options,app,send,proof,publish};
}

test('a free connected box delivers a durable copy and confirms the permanent link through signed routes',async()=>{
 const f=await deliveryFixture();try{
  const body=JSON.stringify({defaultLanguage:'es',pages:{es:'<h1>Menú</h1>'}});
  const r=await f.send('publish',f.publish(body));assert.equal(r.status,200,await r.clone().text());
  const value=await r.json();assert.equal(value.url,menuOrigin+'/m/'+f.box.venueId);assert.equal(value.revision,1);assert.equal(value.state,'current');
  assert.equal(value.publication.bodySha256,createHash('sha256').update(body).digest('hex'));
  assert.equal((await readGuestMenu(f.db.pool,f.box.venueId))?.html,'<h1>Menú</h1>');
  assert.deepEqual(await (await f.send('status',f.proof('status'))).json(),value);
  assert.equal(r.headers.get('cache-control'),'no-store');
  const withdrawn=await f.send('withdraw',f.proof('withdraw'));assert.equal(withdrawn.status,200);assert.equal((await withdrawn.json()).state,'off');
  assert.equal(await readGuestMenu(f.db.pool,f.box.venueId),null);
 }finally{await f.db.close();}
});

test('delivery routes expose bounded, non-browser errors without changing the stored copy',async()=>{
 const f=await deliveryFixture();try{
  const error=async(r:Response)=>[r.status,await r.json()];
  assert.deepEqual(await error(await f.send('publish',{}, {origin:cloudOrigin})),[403,{error:'forbidden'}]);
  assert.equal((await f.send('status',{}, {},'GET')).status,405);
  assert.deepEqual(await error(await f.send('status',{payload:'x',signature:'y'})),[403,{error:'forbidden'}]);
  assert.deepEqual(await error(await f.send('publish',{payload:'x',signature:'y'})),[400,{error:'invalid_input'}]);
  assert.deepEqual(await error(await f.send('publish',{}, {'content-length':String(12*1048576+16385)})),[413,{error:'too_large'}]);
  assert.deepEqual(await error(await f.send('status',{payload:'x'.repeat(16385),signature:'y'})),[413,{error:'too_large'}]);
  assert.deepEqual(await error(await f.send('status',f.proof('status',{}))),[400,{error:'invalid_input'}]);
  const body=JSON.stringify({defaultLanguage:'en',pages:{en:'<h1>Menu</h1>'}});
  assert.equal((await f.send('publish',f.publish(body))).status,200);
  assert.deepEqual(await error(await f.send('publish',f.publish(body+' '))),[409,{error:'conflict'}]);
  await transaction(f.db.pool,c=>setGuestMenuBlocked(c,f.box.venueId,true,menuOrigin));
  assert.deepEqual(await error(await f.send('publish',f.publish(body,2))),[423,{error:'blocked'}]);
  const unconfigured=createAccountApp({...f.options,leaseIssuer:undefined});
  const r=await unconfigured.request(cloudOrigin+'/api/installations/guest-menu-status',{method:'POST',headers:{'content-type':'application/json'},body:'{}'},{incoming:{socket:{remoteAddress:'192.0.2.91'}}} as HttpBindings);
  assert.deepEqual(await error(r),[503,{error:'unavailable'}]);
 }finally{await f.db.close();}
});

function wire(port:number,path:string,body:string,end=true,from?:string){
 let req:ClientRequest;
 const result=new Promise<{status:number;body:string}>((resolve,reject)=>{
  req=request({host:'127.0.0.1',port,path,method:'POST',headers:{host:'localhost','content-type':'application/json',...(from?{'x-forwarded-for':from}:{})}},r=>{
   let text='';r.on('data',c=>text+=c);r.on('end',()=>resolve({status:r.statusCode!,body:text}));r.on('error',reject);
  });req.on('error',reject);req.write(body);if(end)req.end();
 });void result.catch(()=>{});
 return {result,finish:(body:string)=>req.end(body),abort:()=>req.destroy()};
}

test('four publish slots keep one per source, including encoded aliases, while a slow source leaves another box free',async()=>{
 const f=await deliveryFixture(),origin='http://localhost',running=await startAccountServer({...f.options,config:{...f.options.config,portalOrigin:origin,production:false,trustedProxyIps:['127.0.0.1']},port:0});
 const address=running.server.address();assert(address&&typeof address!=='string');
 const held=[wire(address.port,'/api/installations/guest-menu-publish','{',false,'192.0.2.10')];
 try{
  const deadline=Date.now()+5000,attempts=async()=>Number((await f.db.pool.query('SELECT COALESCE(sum(attempts),0) AS n FROM account_rate_limits')).rows[0].n);
  while(await attempts()<1){assert(Date.now()<deadline);await delay(10);}
  assert.deepEqual(await wire(address.port,'/api/installations/guest-menu-publish','{}',true,'192.0.2.10').result,{status:503,body:'{"error":"unavailable"}'});
  assert.equal((await wire(address.port,'/api/installations/guest-menu-%70ublish','{}',true,'192.0.2.10').result).status,503);
  const body=JSON.stringify({defaultLanguage:'en',pages:{en:'<h1>Menu</h1>'}}),now=Date.now();
  const lease=f.issuer.issue({origin,leaseId:randomUUID(),installationId:f.box.installationId,venueId:f.box.venueId,publicKey:f.box.installationKey,environment:'test',issuedAt:now,expiresAt:now+3600000});
  const proof=f.box.proof('guest-menu-publish',{version:1,expectedRevision:0,bodySha256:createHash('sha256').update(body).digest('hex'),bodyBytes:Buffer.byteLength(body)},randomUUID(),lease,undefined,now,{origin});
  assert.equal((await wire(address.port,'/api/installations/guest-menu-publish',JSON.stringify({...proof,body}),true,'192.0.2.20').result).status,200);
  for(const ip of ['192.0.2.11','192.0.2.12','192.0.2.13'])held.push(wire(address.port,'/api/installations/guest-menu-publish','{',false,ip));
  while(await attempts()<5){assert(Date.now()<deadline);await delay(10);}
  assert.equal((await wire(address.port,'/api/installations/guest-menu-publish','{}',true,'192.0.2.30').result).status,503);
  assert.equal((await wire(address.port,'/api/installations/guest-menu-status','{"payload":"x","signature":"y"}',true,'192.0.2.40').result).status,403);
  held[0]!.abort();
  let answer=503;
  while(answer===503){assert(Date.now()<deadline);await delay(10);answer=(await wire(address.port,'/api/installations/guest-menu-publish','{}',true,'192.0.2.10').result).status;}
  assert.equal(answer,400);
 }finally{for(const h of held)h.abort();await running.close();await f.db.close();}
});

test('a publish arriving after the general five-second body window is still read',async()=>{
 const f=await deliveryFixture(),running=await startAccountServer({...f.options,config:{...f.options.config,portalOrigin:'http://localhost',production:false},port:0});
 const address=running.server.address();assert(address&&typeof address!=='string');
 const pending=wire(address.port,'/api/installations/guest-menu-publish','{',false);
 try{await delay(6100);pending.finish('}');assert.equal((await pending.result).status,400);}
 finally{pending.abort();await running.close();await f.db.close();}
});


test('the signed HTTP route accepts an exact 2 MiB escaped publication and refuses larger bodies',async()=>{
 const f=await deliveryFixture();try{
  const empty=JSON.stringify({defaultLanguage:'en',pages:{en:'<h1></h1>'}}),quotes='"'.repeat(Math.floor((2097152-Buffer.byteLength(empty))/2));
  let body=JSON.stringify({defaultLanguage:'en',pages:{en:'<h1>'+quotes+'</h1>'}});body+=' '.repeat(2097152-Buffer.byteLength(body));
  assert.equal(Buffer.byteLength(body),2097152);assert(Buffer.byteLength(JSON.stringify(f.publish(body)))>3*1048576);
  const accepted=await f.send('publish',f.publish(body));assert.equal(accepted.status,200,await accepted.clone().text());
  assert.equal((await readGuestMenu(f.db.pool,f.box.venueId))?.html,'<h1>'+quotes+'</h1>');
  const oversized=await f.send('publish',f.publish(body+' ',1));assert.equal(oversized.status,413);assert.deepEqual(await oversized.json(),{error:'too_large'});
  assert.equal((await f.send('publish',{body:' '.repeat(12*1048576+16385),payload:'x',signature:'y'})).status,413);
 }finally{await f.db.close();}
});
