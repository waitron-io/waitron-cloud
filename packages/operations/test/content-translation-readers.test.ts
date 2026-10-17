import {resetSchema} from '../../registration/test/fixtures/reset-schema.ts';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {after,before,beforeEach,test} from 'node:test';
import {database} from '../../account-http/test/fixtures.ts';
import {operationsStatus} from '../src/status.ts';
let db:Awaited<ReturnType<typeof database>>;
before(async()=>{db=await database();});after(async()=>db?.close());
beforeEach(async()=>{await resetSchema(db.pool);await db.pool.query('UPDATE usage_reconciliation_sources SET last_attempted_at=clock_timestamp(),caught_up_at=clock_timestamp()');});
test('a venue with only translation ready is not a monitoring target',async()=>{
 const organisation=randomUUID(),business=randomUUID(),venue=randomUUID(),installation=randomUUID();
 await db.pool.query("INSERT INTO organisations(id,name) VALUES($1,'Sol')",[organisation]);
 await db.pool.query("INSERT INTO legal_businesses(id,organisation_id,name,country_code) VALUES($1,$2,'Sol SL','ES')",[business,organisation]);
 await db.pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$4,'test')",[venue,organisation,business,randomUUID()]);
 await db.pool.query("INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,'readers-key')",[installation,venue]);
 await db.pool.query(`INSERT INTO installation_services(installation_id,service,state) VALUES($1,'continuous_backup','unconfigured'),($1,'remote_access','unconfigured'),
  ($1,'retained_snapshots','unconfigured'),($1,'content_translation','ready')`,[installation]);
 const server=createServer((request,response)=>{response.setHeader('content-type','application/json');
  response.end(request.url==='/api/health/live'?'{"status":"live"}':'{"status":"ready"}');});
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>resolve());});
 const address=server.address();assert.ok(address&&typeof address!=='string');
 try{
  const snapshot=await operationsStatus(db.pool,{controlApiUrl:`http://127.0.0.1:${address.port}`});
  assert.deepEqual([snapshot.components.monitoring.state,snapshot.components.monitoring.code],['ready','no_targets']);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
