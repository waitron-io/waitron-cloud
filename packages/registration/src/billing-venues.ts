import {addDays} from './billing-calendar.ts';
import {billingDate,billingWhole} from './billing-config.ts';
import type {VenueChargeView} from './billing-charges.ts';
import {mayStartTrial,trialEnd,TRIAL_EXTENSION_DAYS} from './billing-trials.ts';
import {BillingError,type BillingCommand,type BillingContext,type BillingValue,type HostedWindow,type TrialView,type VenueBillingHistory,type VenueBillingView} from './billing-types.ts';

type ReadContext=Pick<BillingContext,'client'|'scope'>;
export type VenueCommand=Extract<BillingCommand,{type:'set_venue'|'start_trial'|'extend_trial'|'end_trial'|'hosted_day'}>;
function scopeArgs(context:ReadContext):string[]{return [context.scope.organisationId,context.scope.legalBusinessId];}
async function ownedVenue(context:ReadContext,venueId:string):Promise<void>{
 const found=await context.client.query('SELECT id FROM venues WHERE organisation_id=$1 AND legal_business_id=$2 AND id=$3 FOR KEY SHARE',[...scopeArgs(context),venueId]);
 if(!found.rowCount)throw new BillingError('billing_scope_not_found');
}
export async function readBillingVenue(context:ReadContext,venueId:string):Promise<VenueBillingView>{
 await ownedVenue(context,venueId);
 const row=(await context.client.query('SELECT level,revision,connected_from::text,lapsed_on::text,scheduled_level,scheduled_on::text FROM billing_venues WHERE organisation_id=$1 AND legal_business_id=$2 AND venue_id=$3',[...scopeArgs(context),venueId])).rows[0];
 return {...context.scope,venueId,level:row?.level??'registered',revision:Number(row?.revision??0),connectedFrom:row?.connected_from??null,lapsedOn:row?.lapsed_on??null,scheduledLevel:row?.scheduled_level??null,scheduledOn:row?.scheduled_on??null};
}
function trialRow(row:Record<string,unknown>):TrialView{
 return {level:row.level as TrialView['level'],startedOn:row.started_on as string,endsOn:row.ends_on as string,extended:row.extended as boolean,state:row.state as TrialView['state']};
}
export async function readVenueHistory(context:ReadContext,venueId:string):Promise<VenueBillingHistory>{
 await ownedVenue(context,venueId);
 const args=[...scopeArgs(context),venueId];
 const trials=await context.client.query('SELECT level,started_on::text,ends_on::text,extended,state FROM billing_trials WHERE organisation_id=$1 AND legal_business_id=$2 AND venue_id=$3 ORDER BY level',args);
 // A paid fact remains historical after a refund; failed attempts confer no trial eligibility loss.
 const paid=await context.client.query(`SELECT p.level,p.charge_id,p.attempt_id,p.from_date::text,p.until_date::text FROM billing_paid_periods p
  JOIN billing_payment_attempts a ON (a.organisation_id,a.legal_business_id,a.id,a.charge_id)=(p.organisation_id,p.legal_business_id,p.attempt_id,p.charge_id)
  WHERE p.organisation_id=$1 AND p.legal_business_id=$2 AND p.venue_id=$3 AND a.succeeded_at IS NOT NULL AND a.state IN ('succeeded','refunded')
  ORDER BY p.from_date,p.level,p.charge_id`,args);
 return {trials:trials.rows.map(trialRow),paid:paid.rows.map(row=>({level:row.level,chargeId:row.charge_id,attemptId:row.attempt_id,from:row.from_date,until:row.until_date}))};
}
export async function readRenewalViews(context:ReadContext,window:HostedWindow):Promise<VenueChargeView[]>{
 const rows=await context.client.query(`WITH days AS (
  SELECT venue_id,count(*) AS hosted,count(*) FILTER(WHERE covered_by_charge_id IS NOT NULL) AS covered FROM billing_hosted_days
  WHERE organisation_id=$1 AND legal_business_id=$2 AND on_date>=$3::date AND on_date<=$4::date AND consumed_by_charge_id IS NULL GROUP BY venue_id
 ) SELECT v.id,b.connected_from::text,coalesce(d.hosted,0) AS hosted,coalesce(d.covered,0) AS covered FROM venues v
 LEFT JOIN billing_venues b ON (b.organisation_id,b.legal_business_id,b.venue_id)=(v.organisation_id,v.legal_business_id,v.id)
 LEFT JOIN days d ON d.venue_id=v.id WHERE v.organisation_id=$1 AND v.legal_business_id=$2 ORDER BY v.id`,[...scopeArgs(context),window.from,window.through]);
 return rows.rows.map(row=>({venueId:row.id,connectedFrom:row.connected_from,hostedDays:billingWhole(Number(row.hosted)),hostedDaysCoveredByConnected:billingWhole(Number(row.covered))}));
}
async function hostedDay(context:BillingContext,command:Extract<VenueCommand,{type:'hosted_day'}>):Promise<BillingValue>{
 const args=[...scopeArgs(context),command.venueId,command.on];
 const old=(await context.client.query('SELECT covered_by_charge_id,consumed_by_charge_id FROM billing_hosted_days WHERE organisation_id=$1 AND legal_business_id=$2 AND venue_id=$3 AND on_date=$4 FOR UPDATE',args)).rows[0];
 const value={venueId:command.venueId,on:command.on,coveredByChargeId:command.coveredByChargeId};
 if(old){
  if(old.covered_by_charge_id===command.coveredByChargeId)return value;
  if(old.covered_by_charge_id!==null||old.consumed_by_charge_id!==null)throw new BillingError('billing_charge_conflict');
 }
 if(command.coveredByChargeId!==null){
  // The first success owns history; any still-paid attempt can cover the same charge.
  const coverage=await context.client.query(`SELECT p.charge_id FROM billing_paid_periods p
   JOIN billing_payment_attempts a ON (a.organisation_id,a.legal_business_id,a.charge_id)=(p.organisation_id,p.legal_business_id,p.charge_id)
   JOIN billing_charge_lines l ON (l.organisation_id,l.legal_business_id,l.charge_id,l.venue_id,l.kind)=(p.organisation_id,p.legal_business_id,p.charge_id,p.venue_id,'connected_month')
   WHERE p.organisation_id=$1 AND p.legal_business_id=$2 AND p.venue_id=$3 AND p.charge_id=$5 AND p.level='connected'
    AND p.from_date<=$4::date AND p.until_date>$4::date AND a.state='succeeded' AND a.succeeded_at IS NOT NULL`,[...args,command.coveredByChargeId]);
  if(!coverage.rowCount)throw new BillingError('billing_charge_conflict');
 }
 if(old)await context.client.query('UPDATE billing_hosted_days SET covered_by_charge_id=$5 WHERE organisation_id=$1 AND legal_business_id=$2 AND venue_id=$3 AND on_date=$4',[...args,command.coveredByChargeId]);
 else await context.client.query('INSERT INTO billing_hosted_days(organisation_id,legal_business_id,venue_id,on_date,covered_by_charge_id,event_id) VALUES($1,$2,$3,$4,$5,$6)',[...args,command.coveredByChargeId,context.eventId]);
 return value;
}
export async function applyVenueCommand(context:BillingContext,command:VenueCommand):Promise<BillingValue>{
 const {client}=context,args=[...scopeArgs(context),command.venueId];
 const venue=await readBillingVenue(context,command.venueId);
 await client.query('INSERT INTO billing_venues(organisation_id,legal_business_id,venue_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',args);
 if(command.type==='set_venue'){
  if(venue.revision!==command.expectedRevision)throw new BillingError('billing_state_conflict');
  const v=command.value;
  await client.query('UPDATE billing_venues SET level=$4,connected_from=$5,lapsed_on=$6,scheduled_level=$7,scheduled_on=$8,revision=revision+1 WHERE organisation_id=$1 AND legal_business_id=$2 AND venue_id=$3',[...args,v.level,v.connectedFrom,v.lapsedOn,v.scheduledLevel,v.scheduledOn]);
  return readBillingVenue(context,command.venueId);
 }
 if(command.type==='hosted_day')return hostedDay(context,command);
 if(command.type==='start_trial'){
  const history=await readVenueHistory(context,command.venueId);
  if(!mayStartTrial(command.level,{trialled:history.trials.map(t=>t.level),paid:history.paid.map(p=>p.level)}))throw new BillingError('billing_trial_unavailable');
  const endsOn=billingDate(trialEnd(command.on));
  await client.query('INSERT INTO billing_trials(organisation_id,legal_business_id,venue_id,level,started_on,ends_on,event_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[...args,command.level,command.on,endsOn,context.eventId]);
  return {level:command.level,startedOn:command.on,endsOn,extended:false,state:'active'};
 }
 const row=(await client.query('SELECT level,started_on::text,ends_on::text,extended,state FROM billing_trials WHERE organisation_id=$1 AND legal_business_id=$2 AND venue_id=$3 AND level=$4 FOR UPDATE',[...args,command.level])).rows[0];
 if(!row||row.state!=='active'||(command.type==='extend_trial'&&row.extended))throw new BillingError('billing_trial_unavailable');
 if(row.ends_on!==command.expectedEnd)throw new BillingError('billing_state_conflict');
 if(command.type==='extend_trial'){
  const endsOn=billingDate(addDays(row.ends_on,TRIAL_EXTENSION_DAYS));
  await client.query('UPDATE billing_trials SET ends_on=$5,extended=true WHERE organisation_id=$1 AND legal_business_id=$2 AND venue_id=$3 AND level=$4',[...args,command.level,endsOn]);
  return {...trialRow(row),endsOn,extended:true};
 }
 await client.query('UPDATE billing_trials SET state=$5 WHERE organisation_id=$1 AND legal_business_id=$2 AND venue_id=$3 AND level=$4',[...args,command.level,command.outcome]);
 return {...trialRow(row),state:command.outcome};
}
