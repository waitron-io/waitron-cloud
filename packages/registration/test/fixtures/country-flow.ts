import {beforeEach} from 'node:test';
import type {PoolClient} from 'pg';
import {lifecycleFixture} from './data-lifecycle.ts';
import type {CountryPolicy,FlowRequest} from '../../src/country-policy.ts';

export const request:FlowRequest={country:'ES',policyRevision:1,serviceId:'venue-backup-home',supplierId:'test-supplier',
 accountId:'test-account',endpoint:'https://backup.example.test/',dataClass:'backup',region:'eu-south-2'};
export const policy:CountryPolicy={country:'ES',revision:1,homeRegion:'eu-south-2',backupRegions:['eu-west-3'],flows:[{
 serviceId:request.serviceId,supplierId:request.supplierId,accountId:request.accountId,endpoint:request.endpoint,
 dataClasses:['backup'],regions:[request.region],evidenceId:'test-evidence',qualified:true}]};

export async function storePolicy(client:Pick<PoolClient,'query'>,definition:CountryPolicy){
 await client.query('INSERT INTO country_policy_versions VALUES($1,$2,$3)',[definition.country,definition.revision,definition]);
}
export async function storeBinding(client:Pick<PoolClient,'query'>,venueId:string,placement:number,flow:FlowRequest){
 await client.query('INSERT INTO venue_country_bindings VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[
  venueId,flow.serviceId,placement,flow.country,flow.policyRevision,flow.supplierId,flow.accountId,flow.endpoint,flow.dataClass,flow.region]);
}
export function countryFixture(){
 const f=lifecycleFixture('country_flow');
 beforeEach(async()=>{
  await storePolicy(f.pool,policy);
  await f.pool.query('INSERT INTO country_policy_heads VALUES($1,$2)',[policy.country,policy.revision]);
  await storeBinding(f.pool,f.venueId,1,request);
  await f.pool.query('INSERT INTO venue_country_binding_heads VALUES($1,$2,1)',[f.venueId,request.serviceId]);
  await f.pool.query("INSERT INTO data_lifecycles(venue_id,revision,state,requested_at) VALUES($1,1,'active',clock_timestamp())",[f.venueId]);
 });
 return {...f,input:()=>({...request,venueId:f.venueId,revision:1,placementRevision:1})};
}
