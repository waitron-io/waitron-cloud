import type {PoolClient} from 'pg';
import {lockAllowanceInstallation,lockAllowanceScope,requireAllowanceTransaction} from './billing-allowances.ts';
import {readBillingVenue,readVenueHistory} from './billing-venues.ts';
import {effectiveVenueLevel} from './venue-service-rules.ts';
import type {CivilDate} from './billing-calendar.ts';

type SpendLimit={freeSuggestions:number;freeValidations:number;limitMicros:number};
type QuantityLimit={suggestions:number;validations:number};
export type AddressLookupPolicy={suggestionMicros:number;validationMicros:number;
 cloudDay:SpendLimit;cloudMonth:SpendLimit;freeDay:SpendLimit;freeMonth:SpendLimit;
 paidVenueMonth:QuantityLimit;freeAccountMonth:QuantityLimit};
type AddressScope={accountId:string;venueId:string;installationId:string};
type CallKind='suggest'|'validate';
type LookupRequest={kind:'available'}|{kind:CallKind;workflowId:string;operationId:string};
type UsageBucket='own_month'|'cloud_month'|'cloud_day'|'free_month'|'free_day';
type UsageRow={kind:CallKind}&Record<UsageBucket,string>;

export class AddressLookupAdmissionError extends Error {
 readonly code:'forbidden'|'conflict'|'expired'|'limit';
 constructor(code:AddressLookupAdmissionError['code']){super(code);this.code=code;}
}

async function counts(client:PoolClient,now:Date,tier:'paid'|'free',box:AddressScope){
 return (await client.query<UsageRow>(`WITH periods AS (
  SELECT date_trunc('day',$1::timestamptz,'America/Los_Angeles') AS day_start,
   date_trunc('month',$1::timestamptz,'America/Los_Angeles') AS month_start
 ) SELECT kind,
  count(*) FILTER (WHERE class=$2 AND CASE WHEN $2='paid' THEN venue_id=$3 ELSE account_id=$4 END) AS own_month,
  count(*) AS cloud_month,
  count(*) FILTER (WHERE admitted_at>=day_start) AS cloud_day,
  count(*) FILTER (WHERE class='free') AS free_month,
  count(*) FILTER (WHERE class='free' AND admitted_at>=day_start) AS free_day
 FROM address_lookup_calls CROSS JOIN periods WHERE admitted_at>=month_start AND admitted_at<=$1 GROUP BY kind`,
 [now,tier,box.venueId,box.accountId])).rows;
}

function checkLimits(usage:UsageRow[],tier:'paid'|'free',kind:LookupRequest['kind'],policy:AddressLookupPolicy){
 const suggestions=usage.find(row=>row.kind==='suggest'),validations=usage.find(row=>row.kind==='validate');
 // Search and availability must leave room for one validation across every applicable cap.
 const searches=(bucket:UsageBucket)=>BigInt(suggestions?.[bucket]??0)+(kind==='validate'?0n:1n);
 const choices=(bucket:UsageBucket)=>BigInt(validations?.[bucket]??0)+1n;
 const own=tier==='paid'?policy.paidVenueMonth:policy.freeAccountMonth;
 if(choices('own_month')>BigInt(own.validations)||searches('own_month')>BigInt(own.suggestions))throw new AddressLookupAdmissionError('limit');
 const checkSpend=(bucket:UsageBucket,limit:SpendLimit)=>{
  const searchExcess=searches(bucket)-BigInt(limit.freeSuggestions),choiceExcess=choices(bucket)-BigInt(limit.freeValidations);
  const cost=(searchExcess>0n?searchExcess*BigInt(policy.suggestionMicros):0n)
   +(choiceExcess>0n?choiceExcess*BigInt(policy.validationMicros):0n);
  if(cost>BigInt(limit.limitMicros))throw new AddressLookupAdmissionError('limit');
 };
 checkSpend('cloud_day',policy.cloudDay);
 checkSpend('cloud_month',policy.cloudMonth);
 if(tier==='free'){
  checkSpend('free_day',policy.freeDay);
  checkSpend('free_month',policy.freeMonth);
 }
}

export async function admitAddressLookup(client:PoolClient,box:AddressScope,request:LookupRequest,policy:AddressLookupPolicy){
 await requireAllowanceTransaction(client);
 // Both the count and its debit are committed before the next admission checks the same budget.
 await client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext('address-lookup:google'))");
 const {scope,business}=await lockAllowanceScope(client,box,{allowMissingBusiness:true});
 await lockAllowanceInstallation(client,box);
 if((await client.query('SELECT 1 FROM address_lookup_stopped_venues WHERE venue_id=$1',[box.venueId])).rowCount)
  throw new AddressLookupAdmissionError('forbidden');
 const {now,day}=(await client.query<{now:Date;day:CivilDate}>(`SELECT now,(now AT TIME ZONE 'America/Los_Angeles')::date::text AS day
  FROM (SELECT clock_timestamp() AS now) AS time`)).rows[0]!;
 let tier:'paid'|'free'='free';
 if(business){
  const context={client,scope},base=(await readBillingVenue(context,box.venueId)).level;
  if(base!=='registered')tier='paid';
  else if(business.current_method_id!==null){
   const card=await client.query("SELECT 1 FROM billing_payment_methods WHERE organisation_id=$1 AND legal_business_id=$2 AND id=$3 AND kind='card'",
    [scope.organisationId,scope.legalBusinessId,business.current_method_id]);
   if(card.rowCount&&effectiveVenueLevel(base,(await readVenueHistory(context,box.venueId)).trials,day)!=='registered')tier='paid';
  }
 }
 if(request.kind==='available'){
  checkLimits(await counts(client,now,tier,box),tier,request.kind,policy);
  return null;
 }
 const prior=(await client.query<{account_id:string;venue_id:string;admitted_at:Date}>(`SELECT account_id,venue_id,admitted_at
  FROM address_lookup_calls WHERE installation_id=$1 AND workflow_id=$2 ORDER BY admitted_at LIMIT 1`,[box.installationId,request.workflowId])).rows[0];
 if((!prior&&request.kind==='validate')||(prior&&(prior.account_id!==box.accountId||prior.venue_id!==box.venueId)))
  throw new AddressLookupAdmissionError('conflict');
 const expiresAt=new Date((prior?.admitted_at??now).getTime()+900_000);
 if(expiresAt<=now)throw new AddressLookupAdmissionError('expired');
 const replay=await client.query(`SELECT 1 FROM address_lookup_calls WHERE installation_id=$1
  AND (operation_id=$2 OR (workflow_id=$3 AND kind='validate')) LIMIT 1`,[box.installationId,request.operationId,request.workflowId]);
 if(replay.rowCount)throw new AddressLookupAdmissionError('conflict');
 checkLimits(await counts(client,now,tier,box),tier,request.kind,policy);
 await client.query(`INSERT INTO address_lookup_calls(installation_id,operation_id,workflow_id,venue_id,account_id,class,kind,admitted_at)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[box.installationId,request.operationId,request.workflowId,box.venueId,box.accountId,tier,request.kind,now]);
 return {expiresAt,day};
}
