import {addDays} from './billing-calendar.ts';
import {chargeTotals,renewalLines} from './billing-charges.ts';
import {billingDate,billingWhole,readBillingPrice} from './billing-config.ts';
import {readRenewalViews} from './billing-venues.ts';
import {BillingError,type BillingCommand,type BillingContext,type BillingEvent,type BillingValue,type FrozenCharge,type PaymentView} from './billing-types.ts';

type ReadContext=Pick<BillingContext,'client'|'scope'>;
type PaymentContext=BillingContext&{source:BillingEvent['source']};
export type PaymentCommand=Extract<BillingCommand,{type:'freeze_charge'|'begin_attempt'|'observe_payment'}>;
function args(context:ReadContext):string[]{return [context.scope.organisationId,context.scope.legalBusinessId];}
export async function readFrozenCharge(context:ReadContext,chargeId:string):Promise<FrozenCharge>{
 const {client}=context,scope=args(context);
 const row=(await client.query(`SELECT *,renewal_date::text,connected_until::text,hosted_from::text,hosted_through::text,price_effective_from::text
  FROM billing_charges WHERE organisation_id=$1 AND legal_business_id=$2 AND id=$3`,[...scope,chargeId])).rows[0];
 if(!row)throw new BillingError('billing_scope_not_found');
 const lines=await client.query('SELECT venue_id,kind,quantity,cents FROM billing_charge_lines WHERE organisation_id=$1 AND legal_business_id=$2 AND charge_id=$3 ORDER BY venue_id,kind',[...scope,chargeId]);
 return {...context.scope,id:row.id,kind:row.kind,renewalDate:row.renewal_date,connectedUntil:row.connected_until,window:{from:row.hosted_from,through:row.hosted_through},
  price:{revision:Number(row.price_revision),effectiveFrom:row.price_effective_from,currency:row.currency,prices:{connectedMonthlyCents:Number(row.connected_monthly_cents),hostedMonthlyCents:Number(row.hosted_monthly_cents)},vatRateBasisPoints:Number(row.vat_rate_basis_points)},
  lines:lines.rows.map(l=>({venueId:l.venue_id,kind:l.kind,quantity:Number(l.quantity),cents:Number(l.cents)})),
  totals:{netCents:Number(row.net_cents),vatCents:Number(row.vat_cents),grossCents:Number(row.gross_cents)}};
}
async function payment(context:ReadContext,attemptId:string):Promise<PaymentView>{
 const {client}=context,scope=args(context);
 const row=(await client.query(`SELECT a.id AS attempt_id,a.charge_id,a.request_key,a.provider_payment_id,a.state,a.revision,a.succeeded_at,
  m.id AS method_id,m.kind,m.provider,m.provider_account_id,m.customer_id,m.method_id AS provider_method_id,m.mandate_id
  FROM billing_payment_attempts a JOIN billing_payment_methods m
   ON (m.organisation_id,m.legal_business_id,m.id)=(a.organisation_id,a.legal_business_id,a.method_id)
  WHERE a.organisation_id=$1 AND a.legal_business_id=$2 AND a.id=$3`,[...scope,attemptId])).rows[0];
 if(!row)throw new BillingError('billing_scope_not_found');
 const history=await client.query('SELECT event_id,state,occurred_at FROM billing_payment_observations WHERE organisation_id=$1 AND legal_business_id=$2 AND attempt_id=$3 ORDER BY occurred_at,event_id',[...scope,attemptId]);
 return {attemptId:row.attempt_id,chargeId:row.charge_id,requestKey:row.request_key,providerPaymentId:row.provider_payment_id,state:row.state,revision:Number(row.revision),succeededAt:row.succeeded_at?.toISOString()??null,
  method:{id:row.method_id,kind:row.kind,provider:row.provider,providerAccountId:row.provider_account_id,customerId:row.customer_id,methodId:row.provider_method_id,mandateId:row.mandate_id},
  observations:history.rows.map(o=>({eventId:o.event_id,state:o.state,occurredAt:o.occurred_at.toISOString()}))};
}
export async function readChargePayments(context:ReadContext,chargeId:string):Promise<PaymentView[]>{
 await readFrozenCharge(context,chargeId);
 const rows=await context.client.query('SELECT id FROM billing_payment_attempts WHERE organisation_id=$1 AND legal_business_id=$2 AND charge_id=$3 ORDER BY id',[...args(context),chargeId]);
 return Promise.all(rows.rows.map(r=>payment(context,r.id)));
}
async function freeze(context:BillingContext,command:Extract<PaymentCommand,{type:'freeze_charge'}>):Promise<FrozenCharge>{
 const {client}=context,scope=args(context);
 const duplicate=await client.query("SELECT id FROM billing_charges WHERE organisation_id=$1 AND legal_business_id=$2 AND (id=$3 OR (kind='renewal' AND $4='renewal' AND renewal_date=$5::date))",[...scope,command.chargeId,command.kind,command.renewalDate]);
 if(duplicate.rowCount)throw new BillingError('billing_charge_conflict');
 const price=await readBillingPrice(client,{on:command.renewalDate});
 if(price.revision!==command.priceRevision)throw new BillingError('billing_price_conflict');
 const views=await readRenewalViews(context,command.window);
 // B uses Number arithmetic; refuse before any intermediate loses whole-cent precision.
 for(const view of views){
  const hosted=billingWhole(view.hostedDays*price.prices.hostedMonthlyCents);
  const covered=billingWhole(view.hostedDaysCoveredByConnected*price.prices.connectedMonthlyCents);
  if(!Number.isSafeInteger(hosted-covered+15))throw new BillingError('invalid_billing_input');
 }
 const lines=renewalLines(command.renewalDate,price.prices,command.kind==='renewal'?views:views.map(v=>({...v,connectedFrom:null})));
 const net=billingWhole(lines.reduce((sum,l)=>billingWhole(sum+l.cents),0));
 billingWhole(net*price.vatRateBasisPoints+5000);
 const totals=chargeTotals(lines,price.vatRateBasisPoints);billingWhole(totals.grossCents);
 if(totals.grossCents===0)throw new BillingError('billing_charge_conflict');
 await client.query(`INSERT INTO billing_charges(organisation_id,legal_business_id,id,kind,renewal_date,connected_until,hosted_from,hosted_through,price_revision,price_effective_from,currency,connected_monthly_cents,hosted_monthly_cents,vat_rate_basis_points,net_cents,vat_cents,gross_cents,event_id)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,[...scope,command.chargeId,command.kind,command.renewalDate,command.connectedUntil,command.window.from,command.window.through,price.revision,price.effectiveFrom,price.currency,price.prices.connectedMonthlyCents,price.prices.hostedMonthlyCents,price.vatRateBasisPoints,totals.netCents,totals.vatCents,totals.grossCents,context.eventId]);
 // Even days whose rounded line is omitted are allocated once to this frozen bill.
 await client.query('UPDATE billing_hosted_days SET consumed_by_charge_id=$5 WHERE organisation_id=$1 AND legal_business_id=$2 AND on_date>=$3::date AND on_date<=$4::date AND consumed_by_charge_id IS NULL',[...scope,command.window.from,command.window.through,command.chargeId]);
 for(const line of lines)await client.query('INSERT INTO billing_charge_lines(organisation_id,legal_business_id,charge_id,venue_id,kind,quantity,cents) VALUES($1,$2,$3,$4,$5,$6,$7)',[...scope,command.chargeId,line.venueId,line.kind,line.quantity,line.cents]);
 return readFrozenCharge(context,command.chargeId);
}
async function begin(context:BillingContext,command:Extract<PaymentCommand,{type:'begin_attempt'}>):Promise<PaymentView>{
 const {client}=context,scope=args(context);
 await readFrozenCharge(context,command.chargeId);
 const saved=(await client.query('SELECT provider,provider_account_id FROM billing_payment_methods WHERE organisation_id=$1 AND legal_business_id=$2 AND id=$3',[...scope,command.methodId])).rows[0];
 if(!saved)throw new BillingError('billing_scope_not_found');
 await client.query(`INSERT INTO billing_payment_attempts(organisation_id,legal_business_id,id,charge_id,method_id,provider,provider_account_id,request_key,event_id)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[...scope,command.attemptId,command.chargeId,command.methodId,saved.provider,saved.provider_account_id,command.requestKey,context.eventId]);
 return payment(context,command.attemptId);
}
async function paidPeriods(context:BillingContext,attempt:PaymentView):Promise<void>{
 const {client}=context,scope=args(context),charge=await readFrozenCharge(context,attempt.chargeId);
 for(const line of charge.lines){
  let from=charge.renewalDate,until=charge.connectedUntil;
  const level=line.kind==='connected_month'?'connected':'hosted';
  if(level==='hosted'){
   const days=(await client.query('SELECT min(on_date)::text AS first,max(on_date)::text AS last FROM billing_hosted_days WHERE organisation_id=$1 AND legal_business_id=$2 AND consumed_by_charge_id=$3 AND venue_id=$4',[...scope,charge.id,line.venueId])).rows[0];
   if(!days.first||!days.last)throw new BillingError('billing_charge_conflict');
   from=days.first;until=billingDate(addDays(days.last,1));
  }
  if(until===null)throw new BillingError('billing_charge_conflict');
  await client.query(`INSERT INTO billing_paid_periods(organisation_id,legal_business_id,venue_id,level,charge_id,attempt_id,from_date,until_date)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,[...scope,line.venueId,level,charge.id,attempt.attemptId,from,until]);
 }
}
async function observe(context:PaymentContext,command:Extract<PaymentCommand,{type:'observe_payment'}>):Promise<PaymentView>{
 const {client}=context,scope=args(context),before=await payment(context,command.attemptId);
 if(context.source.kind==='provider'&&(context.source.provider!==before.method.provider||context.source.accountId!==before.method.providerAccountId))throw new BillingError('billing_state_conflict');
 if(before.providerPaymentId!==null&&before.providerPaymentId!==command.providerPaymentId)throw new BillingError('billing_state_conflict');
 if(command.expectedRevision!==null){
  const same=before.state===command.state;
  const allowed=same||(before.state==='pending'&&(command.state==='succeeded'||command.state==='failed'))||(before.state==='failed'&&command.state==='succeeded')||(before.state==='succeeded'&&command.state==='refunded');
  if(command.expectedRevision!==before.revision||!allowed)throw new BillingError('billing_state_conflict');
  const accepted=await client.query('UPDATE billing_payment_attempts SET provider_payment_id=$4,state=$5,revision=revision+1,succeeded_at=$6 WHERE organisation_id=$1 AND legal_business_id=$2 AND id=$3 AND revision=$7 RETURNING id',[...scope,command.attemptId,command.providerPaymentId,command.state,before.succeededAt??(command.state==='succeeded'?context.occurredAt:null),command.expectedRevision]);
  if(!accepted.rowCount)throw new BillingError('billing_state_conflict');
  if(before.succeededAt===null&&command.state==='succeeded')await paidPeriods(context,before);
 }else{
  await client.query('UPDATE billing_payment_attempts SET provider_payment_id=$4 WHERE organisation_id=$1 AND legal_business_id=$2 AND id=$3',[...scope,command.attemptId,command.providerPaymentId]);
 }
 await client.query('INSERT INTO billing_payment_observations(organisation_id,legal_business_id,attempt_id,event_id,state,occurred_at) VALUES($1,$2,$3,$4,$5,$6)',[...scope,command.attemptId,context.eventId,command.state,context.occurredAt]);
 return payment(context,command.attemptId);
}
export async function applyPaymentCommand(context:PaymentContext,command:PaymentCommand):Promise<BillingValue>{
 try{
  if(command.type==='freeze_charge')return await freeze(context,command);
  if(command.type==='begin_attempt')return await begin(context,command);
  return await observe(context,command);
 }catch(error){
  if((error as {code?:string}).code==='23505')throw new BillingError(command.type==='freeze_charge'?'billing_charge_conflict':'billing_state_conflict');
  throw error;
 }
}
