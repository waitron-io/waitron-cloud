export type BillingLevel='registered'|'connected'|'hosted';
export interface BillingVenue{
 venueId:string;level:BillingLevel;canStartTrial:boolean;
 trial:{level:'connected';startedOn:string;endsOn:string;state:'active';extended:boolean}|null;
 paymentMethods?:{selected:'card'|'direct_debit'|null;setup:{kind:'card'|'direct_debit';state:'pending'|'failed'|'verified'}|null};
}
export interface BillingView{venues:BillingVenue[]}
export type MethodPresentation={checkoutId:string}|{url:string};
export type MethodState='pending'|'failed'|'verified';
export function stripeCheckoutUrl(value:unknown):value is string{
 if(typeof value!=='string')return false;
 try{const url=new URL(value);return url.origin==='https://checkout.stripe.com'&&!url.username&&!url.password;}catch{return false;}
}
export function validMethodPresentation(value:unknown):value is MethodPresentation{
 return object(value)&&(exact(value,['checkoutId'])&&typeof value.checkoutId==='string'&&/^[\x21-\x7e]{1,255}$/.test(value.checkoutId)
  ||exact(value,['url'])&&stripeCheckoutUrl(value.url));
}
export function validMethodResult(value:unknown):value is {state:MethodState}{
 return object(value)&&exact(value,['state'])&&typeof value.state==='string'&&['pending','failed','verified'].includes(value.state);
}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:Record<string,unknown>,keys:string[])=>Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const date=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
function validMethods(value:unknown):boolean{
 if(!object(value)||!exact(value,['selected','setup'])||value.selected!==null&&(typeof value.selected!=='string'||!['card','direct_debit'].includes(value.selected)))return false;
 const setup=value.setup;
 return setup===null||object(setup)&&exact(setup,['kind','state'])&&typeof setup.kind==='string'&&['card','direct_debit'].includes(setup.kind)&&typeof setup.state==='string'&&['pending','failed','verified'].includes(setup.state);
}
export function validBillingView(value:unknown):value is BillingView{
 if(!object(value)||!exact(value,['venues'])||!Array.isArray(value.venues))return false;
 const seen=new Set<string>();
 return value.venues.every(venue=>{
  if(!object(venue)||!exact(venue,['venueId','level','trial','canStartTrial',...(Object.hasOwn(venue,'paymentMethods')?['paymentMethods']:[])])||Object.hasOwn(venue,'paymentMethods')&&!validMethods(venue.paymentMethods)||typeof venue.venueId!=='string'||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(venue.venueId)||seen.has(venue.venueId)||!['registered','connected','hosted'].includes(String(venue.level))||typeof venue.canStartTrial!=='boolean')return false;
  seen.add(venue.venueId);const trial=venue.trial;
  return trial===null||(object(trial)&&exact(trial,['level','startedOn','endsOn','state','extended'])&&trial.level==='connected'&&trial.state==='active'&&typeof trial.extended==='boolean'&&date(trial.startedOn)&&date(trial.endsOn)&&trial.startedOn<trial.endsOn);
 });
}
