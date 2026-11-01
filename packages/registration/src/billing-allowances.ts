import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {transaction} from './transaction.ts';
import {AllowanceError,allowanceLimit,allowanceMonth,validateAllowanceVersion,type AllowanceService,type AllowanceVersion} from './billing-allowance-rules.ts';
import {readBillingVenue,readVenueHistory} from './billing-venues.ts';
import {effectiveVenueLevel} from './venue-service-rules.ts';
import type {CivilDate} from './billing-calendar.ts';

export type AllowanceReservation={id:string;month:CivilDate;revision:number;units:string;state:'held'|'spent'|'released'};
type Input={accountId:string;venueId:string;installationId:string;service:AllowanceService;operationId:string;binding:string;units:bigint};
type Saved=AllowanceReservation&{account_id:string;venue_id:string;installation_id:string;service:AllowanceService;operation_id:string;binding:string;attempted_at:Date|null};
const levels=['registered','connected','hosted'] as const;
const services=['transactional_email','address_lookup','sms','content_translation','rota_solver'] as const;
const columns=levels.flatMap(level=>services.map(service=>level+'_'+service)).concat(['trial_content_translation','trial_rota_solver']);
function fail(code:ConstructorParameters<typeof AllowanceError>[0]):never{throw new AllowanceError(code);}
function uuid(value:unknown):value is string{return typeof value==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value);}
function rowVersion(row:Record<string,unknown>):AllowanceVersion{
 const limits={} as AllowanceVersion['limits'];
 for(const level of levels){limits[level]={} as AllowanceVersion['limits']['registered'];for(const service of services)limits[level][service]=String(row[level+'_'+service]);}
 return validateAllowanceVersion({revision:Number(row.revision),effectiveFrom:row.effective_from,limits,unpaidTrial:{content_translation:String(row.trial_content_translation),rota_solver:String(row.trial_rota_solver)}});
}
const versionSelect='SELECT *,effective_from::text FROM billing_allowance_versions';
export async function readAllowanceVersion(client:PoolClient,month:CivilDate):Promise<AllowanceVersion>{
 if(allowanceMonth(month).from!==month)fail('invalid_allowance_input');
 const row=(await client.query(versionSelect+' WHERE effective_from<=$1::date ORDER BY revision DESC LIMIT 1',[month])).rows[0];
 if(!row)fail('allowance_unavailable');return rowVersion(row);
}
export class AllowanceConfigStore{
 private readonly pool:Pool;
 constructor(pool:Pool){this.pool=pool;}
 async publish(input:AllowanceVersion):Promise<AllowanceVersion>{
  const value=validateAllowanceVersion(input);
  return transaction(this.pool,async client=>{
   await client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext('billing_allowance_versions'))");
   const prior=(await client.query(versionSelect+' WHERE revision=$1',[value.revision])).rows[0];
   if(prior){const saved=rowVersion(prior);if(JSON.stringify(saved)!==JSON.stringify(value))fail('allowance_conflict');return saved;}
   const latest=(await client.query(versionSelect+' ORDER BY revision DESC LIMIT 1')).rows[0];
   if(latest&&(value.revision<=Number(latest.revision)||value.effectiveFrom<=latest.effective_from))fail('allowance_conflict');
   const quantities=levels.flatMap(level=>services.map(service=>value.limits[level][service])).concat([value.unpaidTrial.content_translation,value.unpaidTrial.rota_solver]);
   await client.query(`INSERT INTO billing_allowance_versions(revision,effective_from,${columns.join(',')}) VALUES(${[value.revision,value.effectiveFrom,...quantities].map((_,i)=>'$'+(i+1)).join(',')})`,[value.revision,value.effectiveFrom,...quantities]);
   return value;
  });
 }
 async effective(month:CivilDate):Promise<AllowanceVersion>{return transaction(this.pool,client=>readAllowanceVersion(client,month));}
}
async function requireTransaction(client:PoolClient):Promise<void>{
 try{await client.query('SAVEPOINT billing_allowance_transaction');}catch(error){if((error as {code?:string}).code==='25P01')fail('invalid_allowance_input');throw error;}
 await client.query('RELEASE SAVEPOINT billing_allowance_transaction');
}
function validateInput(input:Input):void{
 if(!input||!uuid(input.accountId)||!uuid(input.venueId)||!uuid(input.installationId)||!uuid(input.operationId)||!services.includes(input.service)
  ||typeof input.binding!=='string'||!/^[\x20-\x7e]{1,256}$/.test(input.binding)||typeof input.units!=='bigint'||input.units<1n||input.units>9223372036854775807n)fail('invalid_allowance_input');
}
function receipt(row:AllowanceReservation):AllowanceReservation{return {id:row.id,month:row.month,revision:Number(row.revision),units:String(row.units),state:row.state};}
const reservationSelect='SELECT *,month::text FROM billing_allowance_reservations';
async function lock(client:PoolClient,key:string):Promise<void>{await client.query('SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext($1))',[key]);}
async function day(client:PoolClient):Promise<CivilDate>{return (await client.query("SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS day")).rows[0].day;}

// The caller keeps these locks through the service write; no allowance is customer authority.
export async function reserveAllowance(client:PoolClient,input:Input):Promise<AllowanceReservation>{
 validateInput(input);await requireTransaction(client);
 if(!(await client.query('SELECT id FROM cloud_accounts WHERE id=$1 AND disabled_at IS NULL FOR SHARE',[input.accountId])).rowCount)fail('allowance_scope_not_found');
 if(!(await client.query('SELECT account_id FROM cloud_credentials WHERE account_id=$1 AND email_verified_at IS NOT NULL FOR SHARE',[input.accountId])).rowCount)fail('allowance_scope_not_found');
 const candidate=(await client.query('SELECT organisation_id,legal_business_id FROM venues WHERE id=$1',[input.venueId])).rows[0];
 if(!candidate)fail('allowance_scope_not_found');
 const args=[candidate.organisation_id,candidate.legal_business_id];
 if(!(await client.query('SELECT account_id FROM organisation_memberships WHERE account_id=$1 AND organisation_id=$2 AND is_owner FOR SHARE',[input.accountId,args[0]])).rowCount)fail('allowance_scope_not_found');
 await client.query('SELECT id FROM organisations WHERE id=$1 FOR SHARE',[args[0]]);
 if(!(await client.query('SELECT id FROM legal_businesses WHERE organisation_id=$1 AND id=$2 FOR SHARE',args)).rowCount)fail('allowance_scope_not_found');
 const business=(await client.query('SELECT current_method_id FROM billing_businesses WHERE organisation_id=$1 AND legal_business_id=$2 FOR SHARE',args)).rows[0];
 if(!business)fail('allowance_scope_not_found');
 const venue=(await client.query("SELECT id FROM venues WHERE id=$1 AND organisation_id=$2 AND legal_business_id=$3 AND environment='test' FOR NO KEY UPDATE",[input.venueId,...args])).rows[0];
 if(!venue)fail('allowance_scope_not_found');
 await client.query('SELECT venue_id FROM billing_service_authority WHERE venue_id=$1 FOR SHARE',[input.venueId]);
 if(!(await client.query('SELECT id FROM installations WHERE id=$1 AND venue_id=$2 AND revoked_at IS NULL FOR SHARE',[input.installationId,input.venueId])).rowCount)fail('allowance_scope_not_found');
 await lock(client,'allowance-operation:'+input.service+':'+input.installationId+':'+input.operationId);
 const saved=(await client.query<Saved>(reservationSelect+' WHERE service=$1 AND installation_id=$2 AND operation_id=$3 FOR UPDATE',[input.service,input.installationId,input.operationId])).rows[0];
 if(saved){
  if(saved.account_id!==input.accountId||saved.venue_id!==input.venueId||saved.binding!==input.binding||BigInt(saved.units)!==input.units)fail('allowance_conflict');
  return receipt(saved);
 }
 if(input.service==='transactional_email'&&input.units!==1n)fail('invalid_allowance_input');
 const scope={organisationId:args[0],legalBusinessId:args[1]},context={client,scope};
 const base=(await readBillingVenue(context,input.venueId)).level,trials=(await readVenueHistory(context,input.venueId)).trials;
 let today=await day(client),month=allowanceMonth(today).from;
 // Re-read time after bucket waits so crossing midnight cannot spend an earlier month's pot.
 for(;;){
  await lock(client,'allowance-account:'+input.accountId+':'+input.service+':'+month);
  await lock(client,'allowance-venue:'+input.venueId+':'+input.service+':'+month);
  today=await day(client);const current=allowanceMonth(today).from;if(current===month)break;month=current;
 }
 const version=await readAllowanceVersion(client,month);
 const limit=allowanceLimit(version,{base,trials,day:today,hasPaymentMethod:business.current_method_id!==null,service:input.service});
 const accountScope=effectiveVenueLevel(base,trials,today)==='registered'&&['transactional_email','sms','address_lookup'].includes(input.service);
 const used=BigInt((await client.query(`SELECT coalesce(sum(units),0)::text AS used FROM billing_allowance_reservations WHERE service=$1 AND month=$2::date AND state IN ('held','spent') AND ${accountScope?'account_id':'venue_id'}=$3`,[input.service,month,accountScope?input.accountId:input.venueId])).rows[0].used);
 if(used+input.units>limit)fail('allowance_exhausted');
 const row=(await client.query<AllowanceReservation>(`INSERT INTO billing_allowance_reservations(id,account_id,organisation_id,legal_business_id,venue_id,installation_id,service,operation_id,binding,units,month,revision,state)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'held') RETURNING id,month::text,revision,units,state`,[randomUUID(),input.accountId,...args,input.venueId,input.installationId,input.service,input.operationId,input.binding,input.units.toString(),month,version.revision])).rows[0]!;
 return receipt(row);
}

async function savedReservation(client:PoolClient,id:string):Promise<Saved>{
 if(!uuid(id))fail('invalid_allowance_input');await requireTransaction(client);
 const row=(await client.query<Saved>(reservationSelect+' WHERE id=$1 FOR UPDATE',[id])).rows[0];
 if(!row)fail('allowance_scope_not_found');return row;
}
export async function spendAllowance(client:PoolClient,id:string):Promise<AllowanceReservation>{
 const row=await savedReservation(client,id);if(row.state==='released')fail('allowance_conflict');
 if(row.state==='held')await client.query("UPDATE billing_allowance_reservations SET state='spent' WHERE id=$1",[id]);
 return {...receipt(row),state:'spent'};
}
export async function recordAllowanceAttempt(client:PoolClient,id:string,attemptStartedAt:string):Promise<void>{
 if(typeof attemptStartedAt!=='string'||attemptStartedAt.length!==24||!Number.isFinite(Date.parse(attemptStartedAt))||new Date(attemptStartedAt).toISOString()!==attemptStartedAt)fail('invalid_allowance_input');
 const row=await savedReservation(client,id);if(row.state!=='spent')fail('allowance_conflict');
 await client.query('UPDATE billing_allowance_reservations SET attempted_at=coalesce(attempted_at,$2::timestamptz) WHERE id=$1',[id,attemptStartedAt]);
}
export async function releaseUnstartedAllowance(client:PoolClient,id:string):Promise<AllowanceReservation>{
 const row=await savedReservation(client,id);
 if(row.state==='released')return receipt(row);
 if(row.state!=='held'||row.attempted_at!==null||row.service!=='content_translation')fail('allowance_conflict');
 const job=(await client.query('SELECT total,started_at,lease_count,state FROM translation_jobs WHERE installation_id=$1 AND operation_id=$2 AND venue_id=$3 FOR UPDATE',[row.installation_id,row.operation_id,row.venue_id])).rows[0];
 if(!job||BigInt(job.total)!==BigInt(row.units)||job.started_at!==null||job.lease_count!==0||job.state!=='queued')fail('allowance_conflict');
 await client.query("UPDATE billing_allowance_reservations SET state='released' WHERE id=$1",[id]);return {...receipt(row),state:'released'};
}
