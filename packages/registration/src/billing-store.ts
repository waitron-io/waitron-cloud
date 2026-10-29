import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {billingDate,billingRecord,billingWhole} from './billing-config.ts';
import {BillingError,type BillingCommand,type BillingEvent,type BillingReceipt,type BillingScope,type BusinessBillingView,type ProviderMethod} from './billing-types.ts';
import {transaction} from './transaction.ts';
import type {VenueChargeView} from './billing-charges.ts';
import {applyVenueCommand,readBillingVenue,readVenueHistory,readRenewalViews,type VenueCommand} from './billing-venues.ts';
import type {HostedWindow,VenueBillingView,VenueBillingHistory} from './billing-types.ts';
import {applyPaymentCommand,readFrozenCharge,readChargePayments,type PaymentCommand} from './billing-payments.ts';
import type {FrozenCharge,PaymentView} from './billing-types.ts';

type BusinessCommand=Extract<BillingCommand,{type:'ensure_business'|'set_method'|'anchor'}>;
function invalid():never{throw new BillingError('invalid_billing_input');}
function uuid(value:unknown):string{
 if(typeof value!=='string'||!/^([0-9a-f]{8}-)([0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value))invalid();
 return value;
}
function reference(value:unknown):string{
 if(typeof value!=='string'||!/^[\x20-\x7e]{1,256}$/.test(value))invalid();
 return value;
}
function scopeInput(input:unknown):BillingScope{
 const s=billingRecord(input,['organisationId','legalBusinessId']);
 return {organisationId:uuid(s.organisationId),legalBusinessId:uuid(s.legalBusinessId)};
}
function eventInput(input:unknown):BillingEvent{
 const e=billingRecord(input,['key','occurredAt','source']);
 if(typeof e.occurredAt!=='string'||e.occurredAt.length!==24)invalid();
 const date=new Date(e.occurredAt);
 if(!Number.isFinite(date.getTime())||date.toISOString()!==e.occurredAt)invalid();
 billingDate(e.occurredAt.slice(0,10));
 const source=e.source as Record<string,unknown>|null;
 if(source?.kind==='internal'){
  billingRecord(source,['kind']);return {key:reference(e.key),occurredAt:e.occurredAt,source:{kind:'internal'}};
 }
 const p=billingRecord(source,['kind','provider','accountId']);
 if(p.kind!=='provider'||(p.provider!=='sumup'&&p.provider!=='stripe'))invalid();
 return {key:reference(e.key),occurredAt:e.occurredAt,source:{kind:'provider',provider:p.provider,accountId:reference(p.accountId)}};
}
function methodInput(input:unknown):ProviderMethod|null{
 if(input===null)return null;
 const m=billingRecord(input,['id','kind','provider','providerAccountId','customerId','methodId','mandateId']);
 if((m.kind!=='card'&&m.kind!=='direct_debit')||(m.provider!=='sumup'&&m.provider!=='stripe'))invalid();
 if(m.kind==='card'&&m.mandateId!==null)invalid();
 if(m.kind==='direct_debit'&&(m.provider!=='stripe'||m.mandateId===null))invalid();
 return {id:uuid(m.id),kind:m.kind,provider:m.provider,providerAccountId:reference(m.providerAccountId),customerId:reference(m.customerId),methodId:reference(m.methodId),mandateId:m.mandateId===null?null:reference(m.mandateId)};
}
function commandInput(input:unknown):BusinessCommand|VenueCommand|PaymentCommand{
 const c=input as Record<string,unknown>|null;
 switch(c?.type){
 case 'ensure_business':billingRecord(c,['type']);return {type:'ensure_business'};
 case 'set_method':billingRecord(c,['type','method']);return {type:'set_method',method:methodInput(c.method)};
 case 'anchor':{
  billingRecord(c,['type','on','mode','expectedRevision']);
  if(c.mode!=='initial'&&c.mode!=='comeback')invalid();
  return {type:'anchor',on:billingDate(c.on),mode:c.mode,expectedRevision:billingWhole(c.expectedRevision)};
 }
 case 'set_venue':{
  billingRecord(c,['type','venueId','expectedRevision','value']);
  const v=billingRecord(c.value,['level','connectedFrom','lapsedOn','scheduledLevel','scheduledOn']);
  if(v.level!=='registered'&&v.level!=='connected'&&v.level!=='hosted')invalid();
  if(v.scheduledLevel!==null&&v.scheduledLevel!=='registered'&&v.scheduledLevel!=='connected')invalid();
  if((v.scheduledLevel===null)!==(v.scheduledOn===null))invalid();
  return {type:'set_venue',venueId:uuid(c.venueId),expectedRevision:billingWhole(c.expectedRevision),value:{level:v.level,connectedFrom:v.connectedFrom===null?null:billingDate(v.connectedFrom),lapsedOn:v.lapsedOn===null?null:billingDate(v.lapsedOn),scheduledLevel:v.scheduledLevel,scheduledOn:v.scheduledOn===null?null:billingDate(v.scheduledOn)}};
 }
 case 'start_trial':{
  billingRecord(c,['type','venueId','level','on']);
  if(c.level!=='connected'&&c.level!=='hosted')invalid();
  return {type:'start_trial',venueId:uuid(c.venueId),level:c.level,on:billingDate(c.on)};
 }
 case 'extend_trial':{
  billingRecord(c,['type','venueId','level','expectedEnd']);
  if(c.level!=='connected')invalid();
  return {type:'extend_trial',venueId:uuid(c.venueId),level:'connected',expectedEnd:billingDate(c.expectedEnd)};
 }
 case 'end_trial':{
  billingRecord(c,['type','venueId','level','expectedEnd','outcome']);
  if((c.level!=='connected'&&c.level!=='hosted')||(c.outcome!=='converted'&&c.outcome!=='lapsed'))invalid();
  return {type:'end_trial',venueId:uuid(c.venueId),level:c.level,expectedEnd:billingDate(c.expectedEnd),outcome:c.outcome};
 }
 case 'hosted_day':
  billingRecord(c,['type','venueId','on','coveredByChargeId']);
  return {type:'hosted_day',venueId:uuid(c.venueId),on:billingDate(c.on),coveredByChargeId:c.coveredByChargeId===null?null:uuid(c.coveredByChargeId)};
 case 'freeze_charge':{
  billingRecord(c,['type','chargeId','kind','renewalDate','connectedUntil','window','priceRevision']);
  if(c.kind!=='renewal'&&c.kind!=='hosted_comeback')invalid();
  const renewalDate=billingDate(c.renewalDate),connectedUntil=c.connectedUntil===null?null:billingDate(c.connectedUntil);
  if(c.kind==='renewal'?(connectedUntil===null||connectedUntil<=renewalDate):connectedUntil!==null)invalid();
  return {type:'freeze_charge',chargeId:uuid(c.chargeId),kind:c.kind,renewalDate,connectedUntil,window:hostedWindow(c.window),priceRevision:billingWhole(c.priceRevision,1)};
 }
 case 'begin_attempt':
  billingRecord(c,['type','chargeId','attemptId','methodId','requestKey']);
  return {type:'begin_attempt',chargeId:uuid(c.chargeId),attemptId:uuid(c.attemptId),methodId:uuid(c.methodId),requestKey:reference(c.requestKey)};
 case 'observe_payment':
  billingRecord(c,['type','attemptId','providerPaymentId','state','expectedRevision']);
  if(c.state!=='pending'&&c.state!=='failed'&&c.state!=='succeeded'&&c.state!=='refunded')invalid();
  return {type:'observe_payment',attemptId:uuid(c.attemptId),providerPaymentId:reference(c.providerPaymentId),state:c.state,expectedRevision:c.expectedRevision===null?null:billingWhole(c.expectedRevision)};
 default:return invalid();
 }
}
function hostedWindow(input:unknown):HostedWindow{
 const w=billingRecord(input,['from','through']),from=billingDate(w.from),through=billingDate(w.through);
 if(from>through)invalid();
 return {from,through};
}
function canonical(value:unknown):string{
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value!==null&&typeof value==='object'){
  const record=value as Record<string,unknown>;
  return '{'+Object.keys(record).sort().map(key=>JSON.stringify(key)+':'+canonical(record[key])).join(',')+'}';
 }
 return JSON.stringify(value);
}
async function lockScope(client:PoolClient,scope:BillingScope):Promise<void>{
 const org=await client.query('SELECT id FROM organisations WHERE id=$1 FOR SHARE',[scope.organisationId]);
 if(!org.rowCount)throw new BillingError('billing_scope_not_found');
 const business=await client.query('SELECT id FROM legal_businesses WHERE organisation_id=$1 AND id=$2 FOR NO KEY UPDATE',[scope.organisationId,scope.legalBusinessId]);
 if(!business.rowCount)throw new BillingError('billing_scope_not_found');
}
function methodRow(row:Record<string,unknown>):ProviderMethod{
 return {id:row.id as string,kind:row.kind as ProviderMethod['kind'],provider:row.provider as ProviderMethod['provider'],providerAccountId:row.provider_account_id as string,customerId:row.customer_id as string,methodId:row.method_id as string,mandateId:row.mandate_id as string|null};
}
async function readBusiness(client:PoolClient,scope:BillingScope,lock:'SHARE'|'NO KEY UPDATE'):Promise<BusinessBillingView>{
 const row=(await client.query(`SELECT b.anchor_date::text,b.anchor_day,b.revision,m.id,m.kind,m.provider,m.provider_account_id,m.customer_id,m.method_id,m.mandate_id
  FROM billing_businesses b LEFT JOIN billing_payment_methods m ON (m.organisation_id,m.legal_business_id,m.id)=(b.organisation_id,b.legal_business_id,b.current_method_id)
  WHERE b.organisation_id=$1 AND b.legal_business_id=$2 FOR ${lock} OF b`,[scope.organisationId,scope.legalBusinessId])).rows[0];
 if(!row)throw new BillingError('billing_scope_not_found');
 return {...scope,anchorDate:row.anchor_date,anchorDay:row.anchor_day===null?null:Number(row.anchor_day),revision:Number(row.revision),paymentMethod:row.id?methodRow(row):null};
}
async function applyBusiness(client:PoolClient,scope:BillingScope,eventId:string,command:BusinessCommand,business:BusinessBillingView):Promise<BusinessBillingView>{
 const args=[scope.organisationId,scope.legalBusinessId];
 if(command.type==='set_method'){
  const method=command.method;
  if(method){
   await client.query(`INSERT INTO billing_payment_methods(organisation_id,legal_business_id,id,kind,provider,provider_account_id,customer_id,method_id,mandate_id,event_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING`,[...args,method.id,method.kind,method.provider,method.providerAccountId,method.customerId,method.methodId,method.mandateId,eventId]);
   const saved=(await client.query('SELECT * FROM billing_payment_methods WHERE organisation_id=$1 AND legal_business_id=$2 AND id=$3',[...args,method.id])).rows[0];
   if(!saved||canonical(methodRow(saved))!==canonical(method))throw new BillingError('billing_state_conflict');
  }
  if((business.paymentMethod?.id??null)!==(method?.id??null)){
   await client.query('UPDATE billing_businesses SET current_method_id=$3,revision=revision+1 WHERE organisation_id=$1 AND legal_business_id=$2',[...args,method?.id??null]);
  }
 }else if(command.type==='anchor'){
  // Initial requests join the winning anchor, including those queued with revision zero.
  if(command.mode==='initial'&&business.anchorDate!==null)return business;
  if(business.revision!==command.expectedRevision)throw new BillingError('billing_state_conflict');
  await client.query('UPDATE billing_businesses SET anchor_date=$3,anchor_day=$4,revision=revision+1 WHERE organisation_id=$1 AND legal_business_id=$2',[...args,command.on,Number(command.on.slice(8))]);
 }
 return readBusiness(client,scope,'NO KEY UPDATE');
}
export class BillingStore{
 private readonly pool:Pool;
 constructor(pool:Pool){this.pool=pool;}
 async business(input:BillingScope):Promise<BusinessBillingView>{
  const scope=scopeInput(input);
  return transaction(this.pool,async client=>{await lockScope(client,scope);return readBusiness(client,scope,'SHARE');});
 }
 async venue(input:BillingScope,inputVenueId:string):Promise<VenueBillingView>{
  const scope=scopeInput(input),venueId=uuid(inputVenueId);
  return transaction(this.pool,async client=>{await lockScope(client,scope);return readBillingVenue({client,scope},venueId);});
 }
 async history(input:BillingScope,inputVenueId:string):Promise<VenueBillingHistory>{
  const scope=scopeInput(input),venueId=uuid(inputVenueId);
  return transaction(this.pool,async client=>{await lockScope(client,scope);return readVenueHistory({client,scope},venueId);});
 }
 async renewalViews(input:BillingScope,inputWindow:HostedWindow):Promise<VenueChargeView[]>{
  const scope=scopeInput(input),window=hostedWindow(inputWindow);
  return transaction(this.pool,async client=>{await lockScope(client,scope);return readRenewalViews({client,scope},window);});
 }
 async charge(input:BillingScope,inputChargeId:string):Promise<FrozenCharge>{
  const scope=scopeInput(input),chargeId=uuid(inputChargeId);
  return transaction(this.pool,async client=>{await lockScope(client,scope);return readFrozenCharge({client,scope},chargeId);});
 }
 async payments(input:BillingScope,inputChargeId:string):Promise<PaymentView[]>{
  const scope=scopeInput(input),chargeId=uuid(inputChargeId);
  return transaction(this.pool,async client=>{await lockScope(client,scope);return readChargePayments({client,scope},chargeId);});
 }
 async execute(inputScope:BillingScope,inputEvent:BillingEvent,inputCommand:BillingCommand):Promise<BillingReceipt>{
  const scope=scopeInput(inputScope),event=eventInput(inputEvent),command=commandInput(inputCommand);
  if(event.source.kind!=='internal'&&command.type!=='observe_payment')invalid();
  return transaction(this.pool,async client=>{
   await lockScope(client,scope);
   const args=[scope.organisationId,scope.legalBusinessId];
   if(command.type==='ensure_business')await client.query('INSERT INTO billing_businesses(organisation_id,legal_business_id) VALUES($1,$2) ON CONFLICT DO NOTHING',args);
   const business=await readBusiness(client,scope,'NO KEY UPDATE');
   // Parent locking serialises first state creation before event identity is inspected.
   const source=event.source;
   const identity=source.kind==='internal'?['billing_internal',...args,event.key]:['billing_provider',source.provider,source.accountId,event.key];
   await client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext($1))",[canonical(identity)]);
   const previous=(await client.query(source.kind==='internal'
    ?"SELECT * FROM billing_events WHERE source='internal' AND organisation_id=$1 AND legal_business_id=$2 AND event_key=$3"
    :"SELECT * FROM billing_events WHERE source='provider' AND provider=$1 AND provider_account_id=$2 AND event_key=$3",
    source.kind==='internal'?[...args,event.key]:[source.provider,source.accountId,event.key])).rows[0];
   if(previous){
    if(previous.organisation_id!==scope.organisationId||previous.legal_business_id!==scope.legalBusinessId||previous.occurred_at.toISOString()!==event.occurredAt||canonical(previous.command)!==canonical(command))throw new BillingError('billing_event_conflict');
    return {eventId:previous.id,value:previous.result};
   }
   const eventId=randomUUID();
   const value=command.type==='ensure_business'||command.type==='set_method'||command.type==='anchor'
    ?await applyBusiness(client,scope,eventId,command,business)
    :command.type==='freeze_charge'||command.type==='begin_attempt'||command.type==='observe_payment'
    ?await applyPaymentCommand({client,scope,eventId,occurredAt:event.occurredAt,source},command)
    :await applyVenueCommand({client,scope,eventId,occurredAt:event.occurredAt},command);
   const inserted=await client.query(`INSERT INTO billing_events(id,organisation_id,legal_business_id,source,provider,provider_account_id,event_key,occurred_at,command,result)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING RETURNING id`,[eventId,...args,source.kind,source.kind==='provider'?source.provider:null,source.kind==='provider'?source.accountId:null,event.key,event.occurredAt,command,value]);
   if(!inserted.rowCount)throw new BillingError('billing_event_conflict');
   return {eventId,value};
  });
 }
}
