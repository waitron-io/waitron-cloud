import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {before,after,test} from 'node:test';
import {createSession} from '@waitron-cloud/identity';
import {transaction} from '@waitron-cloud/registration';
import {createAccountApp} from '../src/app.ts';
import {portalResponse} from '../src/portal.ts';
import {database} from './fixtures.ts';

let db:Awaited<ReturnType<typeof database>>;
before(async()=>{db=await database();});after(async()=>db?.close());
const origin='https://cloud.example.test';
test('country catalogue route requires a valid configured session and remains read-only',async()=>{
 const operator=randomUUID(),other=randomUUID();await db.pool.query('INSERT INTO cloud_accounts(id) VALUES($1),($2)',[operator,other]);
 const actor=await transaction(db.pool,c=>createSession(c,operator)),customer=await transaction(db.pool,c=>createSession(c,other));
 const app=createAccountApp({pool:db.pool,outbox:db.outbox,operatorAccountId:operator,
  config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]}});
 const get=(token?:string,method='GET',path='/api/account/operator/actions')=>app.request(origin+path,{method,
  headers:{cookie:token?`__Host-cloud_session=${token}`:''}}, {incoming:{socket:{remoteAddress:'192.0.2.11'}}} as any);
 const response=await get(actor.token);assert.equal(response.status,200);
 const view=await response.json() as {actions:{id:string;policy:string;available:boolean}[]};
 assert.equal(view.actions.length,16);assert.ok(view.actions.every(a=>!a.available));
 assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal((await get(customer.token)).status,403);assert.equal((await get()).status,401);
 assert.equal((await get(actor.token,'POST')).status,405);
 assert.equal((await get(actor.token,'GET','/api/account/operator/actions?account='+operator)).status,400);
 assert.equal((await app.request('https://wrong.example.test/api/account/operator/actions')).status,403);
 await db.pool.query('UPDATE cloud_sessions SET ended_at=clock_timestamp() WHERE account_id=$1',[operator]);
 assert.equal((await get(actor.token)).status,401);
});

test('direct operator navigation serves the portal document',async()=>{
 const assets=new Map([['/index.html',{body:Buffer.from('<title>Cloud</title>'),contentType:'text/html'}]]);
 assert.equal(portalResponse(new Request(origin+'/operator/actions'),assets).status,200);
});


test('a bad operator setting explains the startup refusal',()=>{
 const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('options',`-c search_path=${db.schema}`);
 const result=spawnSync(process.execPath,['src/server-cli.ts'],{cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:10000,
  env:{...process.env,NODE_ENV:'test',DATABASE_URL:url.toString(),CLOUD_PORTAL_ORIGIN:origin,CLOUD_HTTP_RATE_KEY:db.rateKey,
   CLOUD_EMAIL_ACTIVE_KEY_ID:'test',CLOUD_EMAIL_KEYS:JSON.stringify(db.keys),CLOUD_OPERATOR_ACCOUNT_ID:'not-an-id'}});
 assert.equal(result.status,1);assert.match(result.stderr,/requires a lowercase UUID in CLOUD_OPERATOR_ACCOUNT_ID/);
});
