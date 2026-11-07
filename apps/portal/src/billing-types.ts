export type BillingLevel='registered'|'connected'|'hosted';
export interface BillingVenue{
 venueId:string;level:BillingLevel;canStartTrial:boolean;
 trial:{level:'connected';startedOn:string;endsOn:string;state:'active';extended:boolean}|null;
}
export interface BillingView{venues:BillingVenue[]}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:Record<string,unknown>,keys:string[])=>Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const date=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
export function validBillingView(value:unknown):value is BillingView{
 if(!object(value)||!exact(value,['venues'])||!Array.isArray(value.venues))return false;
 const seen=new Set<string>();
 return value.venues.every(venue=>{
  if(!object(venue)||!exact(venue,['venueId','level','trial','canStartTrial'])||typeof venue.venueId!=='string'||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(venue.venueId)||seen.has(venue.venueId)||!['registered','connected','hosted'].includes(String(venue.level))||typeof venue.canStartTrial!=='boolean')return false;
  seen.add(venue.venueId);const trial=venue.trial;
  return trial===null||(object(trial)&&exact(trial,['level','startedOn','endsOn','state','extended'])&&trial.level==='connected'&&trial.state==='active'&&typeof trial.extended==='boolean'&&date(trial.startedOn)&&date(trial.endsOn)&&trial.startedOn<trial.endsOn);
 });
}
