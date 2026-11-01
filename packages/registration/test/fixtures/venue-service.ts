import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {migrate} from '../../src/migrate.ts';
import {transaction} from '../../src/transaction.ts';
import type {BillingEvent,BillingScope} from '../../src/billing-types.ts';

export const event=():BillingEvent=>({key:randomUUID(),occurredAt:'2026-10-29T09:00:00.000Z',source:{kind:'internal'}});
export async function venueServiceFixture(){
 const schema='venue_services_'+randomUUID().replaceAll('-','');
 const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
 const pool=new Pool({connectionString:process.env.TEST_DATABASE_URL,application_name:schema,options:`-c search_path=${schema} -c statement_timeout=8000`});
 const peer=new Pool({connectionString:process.env.TEST_DATABASE_URL,application_name:schema+'_peer',options:`-c search_path=${schema} -c statement_timeout=8000`});
 try{
  await admin.query(`CREATE SCHEMA ${schema}`);await migrate(pool);
  const scope={organisationId:randomUUID(),legalBusinessId:randomUUID()};
  const other={organisationId:scope.organisationId,legalBusinessId:randomUUID()};
  const foreign={organisationId:randomUUID(),legalBusinessId:randomUUID()};
  const venues=[randomUUID(),randomUUID()].sort(),otherVenue=randomUUID(),foreignVenue=randomUUID(),production=randomUUID();
  // Seed the isolated fixture atomically so each row does not require its own durable commit.
  await transaction(pool,async client=>{
  await client.query('INSERT INTO organisations(id) VALUES($1),($2)',[scope.organisationId,foreign.organisationId]);
  for(const s of [scope,other,foreign])await client.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[s.legalBusinessId,s.organisationId]);
  for(const [s,id,environment] of [[scope,venues[0],'test'],[scope,venues[1],'test'],[other,otherVenue,'test'],[foreign,foreignVenue,'test'],[scope,production,'production']] as const){
   await client.query('INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$1,$4)',[id,s.organisationId,s.legalBusinessId,environment]);
   const current=randomUUID();
   for(let i=0;i<2;i++){
    const installation=i===0?current:randomUUID();
    if(i===0)await client.query('INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,$3)',[installation,id,installation]);
    else await client.query('INSERT INTO installations(id,venue_id,public_key,revoked_at,superseded_by) VALUES($1,$2,$3,clock_timestamp(),$4)',[installation,id,installation,current]);
    for(const service of ['continuous_backup','retained_snapshots','remote_access','content_translation'])await client.query("INSERT INTO installation_services(installation_id,service,state,configuration) VALUES($1,$2,'ready',$3)",[installation,service,{synthetic:service}]);
   }
  }
  });
  const api=await import(new URL('../../src/index.ts',import.meta.url).href),store=new api.BillingStore(pool);
  for(const s of [scope,other,foreign])await store.execute(s,event(),{type:'ensure_business'});
  const today=(await pool.query("SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS day")).rows[0].day;
  return {schema,admin,pool,peer,scope,other,foreign,venues,otherVenue,foreignVenue,production,api,store,today,
   async close(){await peer.end();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}};
 }catch(e){await peer.end();await pool.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();throw e;}
}
export type Fixture=Awaited<ReturnType<typeof venueServiceFixture>>;
export async function read(f:Fixture,id=f.venues[0]):Promise<{organisationId:string;legalBusinessId:string;venueId:string;level:string;revision:number}>{
 assert.equal(typeof f.api.readVenuePermissions,'function','the new mode needs a real authority reader');
 return transaction(f.pool,client=>f.api.readVenuePermissions(client,id,'test-venue-levels'));
}
export async function set(f:Fixture,level='connected',id=f.venues[0],enrol=true,scope:BillingScope=f.scope){
 const old=await f.store.venue(scope,id);
 const command={type:'set_venue',venueId:id,expectedRevision:old.revision,value:{level,connectedFrom:null,lapsedOn:null,scheduledLevel:null,scheduledOn:null}};
 if(enrol)assert.equal(typeof f.store.transition,'function','permission changes need the event transaction');
 return f.store[enrol?'transition':'execute'](scope,event(),command);
}
export async function rows(f:Fixture,id=f.venues[0]){
 return {installations:(await f.pool.query('SELECT to_jsonb(i) AS row FROM installations i WHERE venue_id=$1 ORDER BY id',[id])).rows,
  services:(await f.pool.query('SELECT s.* FROM installation_services s JOIN installations i ON i.id=s.installation_id WHERE i.venue_id=$1 ORDER BY installation_id,service',[id])).rows};
}
export async function snapshot(f:Fixture){
 const result:Record<string,unknown>={};
 for(const name of ['billing_events','billing_venues','billing_trials','billing_service_authority','installations','installation_services'])result[name]=(await f.pool.query(`SELECT to_jsonb(t) AS row FROM ${name} t ORDER BY to_jsonb(t)::text`)).rows;
 return result;
}
export function assertCleared(value:Awaited<ReturnType<typeof rows>>,revision:number){
 for(const i of value.installations)assert.equal(i.row.configuration_revision,revision);
 for(const s of value.services)if(s.service==='content_translation'){
  assert.equal(s.state,'ready');assert.deepEqual(s.configuration,{synthetic:'content_translation'});
 }else {assert.equal(s.state,'unconfigured');assert.deepEqual(s.configuration,{});}
}
export async function trial(f:Fixture,level='connected',on=f.today,id=f.venues[0],enrol=true){
 assert.equal(typeof f.store.transition,'function');
 return f.store[enrol?'transition':'execute'](f.scope,event(),{type:'start_trial',venueId:id,level,on});
}
export function dayOffset(day:string,offset:number){const d=new Date(day+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+offset);return d.toISOString().slice(0,10);}
