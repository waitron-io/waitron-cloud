import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import type {HttpBindings} from '@hono/node-server';
import {guestMenuFixture} from '../../remote-access/test/fixtures/guest-menu.ts';
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
