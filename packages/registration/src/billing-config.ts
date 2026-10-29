import type {Pool,PoolClient} from 'pg';
import type {CivilDate} from './billing-calendar.ts';
import {BillingError,type BillingPriceVersion} from './billing-types.ts';
import {transaction} from './transaction.ts';

export function billingRecord(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(value===null||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||!keys.every(key=>Object.hasOwn(value,key)))throw new BillingError('invalid_billing_input');
 return value as Record<string,unknown>;
}
export function billingWhole(value:unknown,minimum=0,maximum=Number.MAX_SAFE_INTEGER):number{
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<minimum||value>maximum)throw new BillingError('invalid_billing_input');
 return value;
}
export function billingDate(value:unknown):CivilDate{
 if(typeof value!=='string'||value.length!==10||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'0001-01-01'||value>'9999-12-31')throw new BillingError('invalid_billing_input');
 const date=new Date(`${value}T00:00:00Z`);
 if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)throw new BillingError('invalid_billing_input');
 return value;
}
export function validateBillingPrice(value:unknown):BillingPriceVersion{
 const v=billingRecord(value,['revision','effectiveFrom','currency','prices','vatRateBasisPoints']),p=billingRecord(v.prices,['connectedMonthlyCents','hostedMonthlyCents']);
 if(v.currency!=='EUR')throw new BillingError('invalid_billing_input');
 return {revision:billingWhole(v.revision,1),effectiveFrom:billingDate(v.effectiveFrom),currency:'EUR',prices:{
  connectedMonthlyCents:billingWhole(p.connectedMonthlyCents,0,Math.floor(Number.MAX_SAFE_INTEGER/10000)),
  hostedMonthlyCents:billingWhole(p.hostedMonthlyCents,0,Math.floor(Number.MAX_SAFE_INTEGER/10000)),
 },vatRateBasisPoints:billingWhole(v.vatRateBasisPoints,0,10000)};
}
function priceRow(row:Record<string,unknown>):BillingPriceVersion{
 return validateBillingPrice({revision:Number(row.revision),effectiveFrom:row.effective_from,currency:row.currency,prices:{connectedMonthlyCents:Number(row.connected_monthly_cents),hostedMonthlyCents:Number(row.hosted_monthly_cents)},vatRateBasisPoints:Number(row.vat_rate_basis_points)});
}
export async function readBillingPrice(client:PoolClient,selector:{revision:number}|{on:CivilDate}):Promise<BillingPriceVersion>{
 const byRevision='revision' in selector;
 const value=byRevision?billingWhole(selector.revision,1):billingDate(selector.on);
 const result=await client.query(`SELECT revision,effective_from::text,currency,connected_monthly_cents,hosted_monthly_cents,vat_rate_basis_points FROM billing_prices WHERE ${byRevision?'revision=$1':'effective_from<=$1::date'} ORDER BY revision DESC LIMIT 1`,[value]);
 if(!result.rowCount)throw new BillingError('billing_price_unavailable');
 return priceRow(result.rows[0]);
}
export class BillingPriceStore{
 private readonly pool:Pool;
 constructor(pool:Pool){this.pool=pool;}
 async publish(input:BillingPriceVersion):Promise<BillingPriceVersion>{
  const value=validateBillingPrice(input);
  return transaction(this.pool,async client=>{
   await client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext('billing_prices'))");
   const prior=await client.query('SELECT revision,effective_from::text,currency,connected_monthly_cents,hosted_monthly_cents,vat_rate_basis_points FROM billing_prices WHERE revision=$1',[value.revision]);
   if(prior.rowCount){
    const saved=priceRow(prior.rows[0]);
    if(JSON.stringify(saved)!==JSON.stringify(value))throw new BillingError('billing_price_conflict');
    return saved;
   }
   const latest=await client.query('SELECT revision,effective_from::text FROM billing_prices ORDER BY revision DESC LIMIT 1');
   if(latest.rowCount&&(value.revision<=Number(latest.rows[0].revision)||value.effectiveFrom<=latest.rows[0].effective_from))throw new BillingError('billing_price_conflict');
   await client.query('INSERT INTO billing_prices(revision,effective_from,currency,connected_monthly_cents,hosted_monthly_cents,vat_rate_basis_points) VALUES($1,$2,$3,$4,$5,$6)',[value.revision,value.effectiveFrom,value.currency,value.prices.connectedMonthlyCents,value.prices.hostedMonthlyCents,value.vatRateBasisPoints]);
   return value;
  });
 }
 async effective(on:CivilDate):Promise<BillingPriceVersion>{return transaction(this.pool,client=>readBillingPrice(client,{on}));}
 async revision(revision:number):Promise<BillingPriceVersion>{return transaction(this.pool,client=>readBillingPrice(client,{revision}));}
}
