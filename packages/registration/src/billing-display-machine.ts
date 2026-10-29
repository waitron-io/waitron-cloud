import type {Pool,PoolClient} from 'pg';
import {BillingError,type BillingScope,type TrialView} from './billing-types.ts';
import {readFrozenCharge} from './billing-payments.ts';
import {readBillingPrice} from './billing-config.ts';
import {readBillingVenue} from './billing-venues.ts';
import {billingDisplayDay,projectBillingDisplay,type BillingDisplayV1,type BillingDisplayFacts} from './billing-display.ts';
import {InstallationStore} from './installations.ts';
import {createLeaseTrust,InstallationError,readMachineClaims,verifyMachine,verifyLease,type LeaseIssuer,type MachineClaims} from './installation-proof.ts';
import {transaction} from './transaction.ts';

export class BillingDisplayError extends Error{
 readonly code:'invalid_request'|'unsupported_billing_version'|'temporarily_unavailable';
 constructor(code:BillingDisplayError['code']){super(code);this.name='BillingDisplayError';this.code=code;}
}
function invalid():never{throw new InstallationError('invalid_proof');}
function unavailable(error:unknown):never{
 if(error instanceof InstallationError||error instanceof BillingDisplayError)throw error;
 throw new BillingDisplayError('temporarily_unavailable');
}
function body(text:string):void{
 if(text==='{"version":1}')return;
 let value:unknown;try{value=JSON.parse(text);}catch{throw new BillingDisplayError('invalid_request');}
 if(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===1&&'version' in value&&Number.isSafeInteger(value.version)&&JSON.stringify(value)===text)
  throw new BillingDisplayError('unsupported_billing_version');
 throw new BillingDisplayError('invalid_request');
}
function accountOrigin(value:string):boolean{
 try{
  const url=new URL(value);
  return url.origin===value&&(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)));
 }catch{return false;}
}

async function facts(client:PoolClient,scope:BillingScope,venueId:string):Promise<BillingDisplayFacts>{
 const context={client,scope},args=[scope.organisationId,scope.legalBusinessId,venueId];
 const venue=await readBillingVenue(context,venueId);
 const trials=(await client.query(`SELECT level,started_on::text,ends_on::text,extended,state FROM billing_trials
  WHERE organisation_id=$1 AND legal_business_id=$2 AND venue_id=$3 ORDER BY level`,args)).rows.map(row=>({
   level:row.level,startedOn:row.started_on,endsOn:row.ends_on,extended:row.extended,state:row.state,
  } as TrialView));
 const ids=await client.query(`SELECT c.id FROM billing_charges c WHERE c.organisation_id=$1 AND c.legal_business_id=$2 AND (
  EXISTS(SELECT 1 FROM billing_charge_lines l WHERE (l.organisation_id,l.legal_business_id,l.charge_id)=(c.organisation_id,c.legal_business_id,c.id) AND l.venue_id=$3 AND l.kind='connected_month') OR
  EXISTS(SELECT 1 FROM billing_hosted_days d WHERE (d.organisation_id,d.legal_business_id,d.consumed_by_charge_id)=(c.organisation_id,c.legal_business_id,c.id) AND d.venue_id=$3))
  ORDER BY c.renewal_date,c.id`,args);
 const charges:BillingDisplayFacts['charges']=[];
 for(const {id} of ids.rows){
  const charge=await readFrozenCharge(context,id);
  charge.lines=charge.lines.filter(line=>line.venueId===venueId);
  const attempts=(await client.query(`SELECT state,succeeded_at FROM billing_payment_attempts
   WHERE organisation_id=$1 AND legal_business_id=$2 AND charge_id=$3 ORDER BY id`,[scope.organisationId,scope.legalBusinessId,id])).rows.map(row=>({state:row.state,succeededAt:row.succeeded_at?.toISOString()??null}));
  const hostedDays=(await client.query(`SELECT venue_id,on_date::text FROM billing_hosted_days
   WHERE organisation_id=$1 AND legal_business_id=$2 AND venue_id=$3 AND consumed_by_charge_id=$4 ORDER BY on_date`,[...args,id])).rows.map(row=>({venueId:row.venue_id,on:row.on_date}));
  charges.push({charge,attempts,hostedDays});
 }
 return {venue,trials,charges};
}

export class BillingDisplayMachine{
 readonly #pool:Pool;readonly #issuer:LeaseIssuer;readonly #origin:string;readonly #calendarTimeZone:string;readonly #trusted:ReadonlyMap<string,string>;
 constructor(pool:Pool,issuer:LeaseIssuer,origin:string,options:{countryCode:'ES';calendarTimeZone:string},trusted=createLeaseTrust(issuer)){
  try{
   if(!accountOrigin(origin)||options?.countryCode!=='ES')throw new Error();
   billingDisplayDay(new Date().toISOString(),options.calendarTimeZone);
  }catch{throw new BillingDisplayError('temporarily_unavailable');}
  this.#pool=pool;this.#issuer=issuer;this.#origin=origin;this.#calendarTimeZone=options.calendarTimeZone;this.#trusted=trusted;
 }
 async authenticate(envelope:unknown):Promise<MachineClaims>{
  try{return await new InstallationStore(this.#pool,this.#issuer,this.#origin,this.#trusted).authenticate('billing-display',envelope);}
  catch(error){return unavailable(error);}
 }
 async read(envelope:unknown):Promise<BillingDisplayV1>{
  const routing=readMachineClaims(envelope);
  try{return await transaction(this.#pool,async client=>{
   const initial=(await client.query(`SELECT i.public_key,i.venue_id,v.organisation_id,v.legal_business_id FROM installations i
    JOIN venues v ON v.id=i.venue_id WHERE i.id=$1`,[routing.installationId])).rows[0];
   if(!initial)invalid();
   const preliminary=verifyMachine(envelope,initial.public_key,this.#origin,'billing-display');body(preliminary.body);
   // Shared parents admit display readers and exclude billing writes before child rows exist.
   if(!(await client.query('SELECT id FROM organisations WHERE id=$1 FOR SHARE',[initial.organisation_id])).rowCount)invalid();
   if(!(await client.query('SELECT id FROM legal_businesses WHERE organisation_id=$1 AND id=$2 FOR SHARE',[initial.organisation_id,initial.legal_business_id])).rowCount)invalid();
   await client.query('SELECT legal_business_id FROM billing_businesses WHERE organisation_id=$1 AND legal_business_id=$2 FOR SHARE',[initial.organisation_id,initial.legal_business_id]);
   if(!(await client.query('SELECT id FROM venues WHERE id=$1 FOR SHARE',[initial.venue_id])).rowCount)invalid();
   const row=(await client.query(`SELECT i.*,v.environment,v.organisation_id,v.legal_business_id FROM installations i
    JOIN venues v ON v.id=i.venue_id WHERE i.id=$1 FOR SHARE OF i`,[routing.installationId])).rows[0];
   if(!row||row.venue_id!==initial.venue_id||row.organisation_id!==initial.organisation_id||row.legal_business_id!==initial.legal_business_id)invalid();
   // One instant after every lock wait binds the proof, lease and displayed country day.
   const now=Date.now(),claims=verifyMachine(envelope,row.public_key,this.#origin,'billing-display',now);
   if(row.revoked_at||row.superseded_by)throw new InstallationError('revoked');
   let encoded:unknown;try{encoded=JSON.parse(claims.lease);}catch{return invalid();}
   if(JSON.stringify(encoded)!==claims.lease)invalid();
   const lease=verifyLease(encoded,this.#trusted,this.#origin,now);
   if(lease.installationId!==row.id||lease.venueId!==row.venue_id||lease.publicKey!==row.public_key||lease.environment!==row.environment)invalid();
   const asOf=new Date(now).toISOString(),today=billingDisplayDay(asOf,this.#calendarTimeZone);
   const scope={organisationId:row.organisation_id as string,legalBusinessId:row.legal_business_id as string};
   const displayFacts=await facts(client,scope,row.venue_id);
   let prices:BillingDisplayV1['prices'];
   try{
    const price=await readBillingPrice(client,{on:today});
    prices={status:'published',revision:price.revision,effectiveFrom:price.effectiveFrom,currency:'EUR',taxExclusive:true,vatRateBasisPoints:price.vatRateBasisPoints,registeredMonthlyCents:0,...price.prices,hostedDayDivisor:30};
   }catch(error){
    if(!(error instanceof BillingError)||error.code!=='billing_price_unavailable')throw error;
    prices={status:'unavailable',reason:'not_published'};
   }
   return {version:1,installationId:row.id,venueId:row.venue_id,countryCode:'ES',calendarTimeZone:this.#calendarTimeZone,asOf,
    billing:projectBillingDisplay(displayFacts,today),prices,accountUrl:this.#origin+'/account'};
  });}catch(error){return unavailable(error);}
 }
}
