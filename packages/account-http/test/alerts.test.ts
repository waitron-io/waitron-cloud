import {resetSchema} from '../../registration/test/fixtures/reset-schema.ts';
import assert from 'node:assert/strict';
import {before,after,beforeEach,test} from 'node:test';
import type {HttpBindings} from '@hono/node-server';
import {SignupStore} from '@waitron-cloud/registration';
import {createAccountApp} from '../src/app.ts';
import {database} from './fixtures.ts';
const origin='https://cloud.example.test',password='A sufficiently long test password';
const bindings={incoming:{socket:{remoteAddress:'192.0.2.1'}}} as HttpBindings;
let db:Awaited<ReturnType<typeof database>>,app:ReturnType<typeof createAccountApp>,cookie:string,csrf:string;
before(async()=>{db=await database();});after(async()=>db?.close());
async function account(email:string){
 const signup=new SignupStore(db.pool,db.outbox);await signup.request(email);const mail=db.outbox.open((await db.pool.query('SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT 1')).rows[0]);assert('token' in mail);
 await signup.complete(mail.token,{password,organisationName:'Sol',legalBusinessName:'Sol SL',countryCode:'ES'});
 const login=await app.request(origin+'/api/account/login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email,password})},bindings);assert.equal(login.status,200);
 cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');csrf=/__Host-cloud_csrf=([^;]+)/.exec(cookie)![1]!;
}
beforeEach(async()=>{
 await resetSchema(db.pool);
 app=createAccountApp({pool:db.pool,outbox:db.outbox,config:{portalOrigin:origin,production:true,rateKey:db.rateKey,trustedProxyIps:[]}});await account('alerts@example.test');
});
function request(body?:unknown,headers:Record<string,string>={}){return app.request(origin+'/api/account/alerts',{method:body===undefined?'GET':'POST',headers:{origin,cookie,'x-csrf-token':csrf,'content-type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})},bindings);}
test('preferences default off, persist per account and do not renew passive sessions',async()=>{
 const before=(await db.pool.query('SELECT last_seen_at FROM cloud_sessions')).rows;
 assert.deepEqual(await(await request()).json(),{enabled:false,locale:'en'});
 assert.equal((await request({enabled:'on',locale:'es'})).status,200);assert.deepEqual(await(await request()).json(),{enabled:true,locale:'es'});
 assert.deepEqual((await db.pool.query('SELECT last_seen_at FROM cloud_sessions')).rows,before);
 await account('other@example.test');assert.deepEqual(await(await request()).json(),{enabled:false,locale:'en'});
});
test('preference writes enforce browser proof, live sessions and a strict body',async()=>{
 assert.equal((await request(undefined,{cookie:''})).status,401);
 const body={enabled:'on',locale:'es'};
 assert.equal((await request(body,{origin:'https://wrong.test'})).status,403);
 assert.equal((await request(body,{'x-csrf-token':'wrong'})).status,403);
 for(const bad of [{...body,enabled:true},{...body,enabled:'yes'},{...body,locale:'fr'},{...body,accountId:'other'}])assert.equal((await request(bad)).status,400);
 assert.equal((await db.pool.query('SELECT count(*) FROM account_alert_preferences')).rows[0].count,'0');
 await db.pool.query('UPDATE cloud_accounts SET disabled_at=clock_timestamp()');assert.equal((await request(body)).status,401);
});
test('preference reads and writes share a bounded account allowance',async()=>{
 for(let n=0;n<30;n++)assert.equal((await request()).status,200);
 const limited=await request({enabled:'on',locale:'en'});assert.equal(limited.status,429);assert(limited.headers.get('retry-after'));
});
test('session expiry while a preference write waits rolls the change back',async()=>{
 assert.equal((await request({enabled:'off',locale:'en'})).status,200);
 const block=await db.secondPool.connect();await block.query('BEGIN');await block.query('SELECT account_id FROM account_alert_preferences FOR UPDATE');
 await db.pool.query("UPDATE cloud_sessions SET absolute_expires_at=clock_timestamp()+interval '1 second'");
 const pending=request({enabled:'on',locale:'es'});let waiting=false;
 try{
  for(let n=0;n<100;n++){if((await db.secondPool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE 'INSERT INTO account_alert_preferences%'",[db.schema])).rowCount){waiting=true;break;}await new Promise(r=>setTimeout(r,10));}
  await new Promise(r=>setTimeout(r,1100));
 }finally{await block.query('COMMIT');block.release();}
 assert(waiting);assert.equal((await pending).status,401);assert.deepEqual((await db.pool.query('SELECT enabled,locale FROM account_alert_preferences')).rows,[{enabled:false,locale:'en'}]);
});
