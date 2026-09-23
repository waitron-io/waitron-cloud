export interface PairingBusiness {organisationId:string;legalBusinessId:string;organisationName:string;legalBusinessName:string;countryCode:string;}
export interface PairingView {requestId:string;localVenueId:string;environment:'test'|'production';expiresAt:string;
  state:'awaiting_cloud'|'awaiting_local'|'complete';organisationId?:string;legalBusinessId?:string;organisationName?:string;legalBusinessName?:string;}
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const name=(v:unknown)=>typeof v==='string'&&v.trim().length>0&&v.length<=200;
function binding(data:Record<string,unknown>){return uuid(data.organisationId)&&uuid(data.legalBusinessId)&&name(data.organisationName)&&name(data.legalBusinessName);}
export function validBusinesses(value:unknown):boolean {
  return Array.isArray(value)&&value.every(v=>v&&typeof v==='object'&&binding(v)&&typeof v.countryCode==='string'&&/^[A-Z]{2}$/.test(v.countryCode));
}
export function validPairingView(data:Record<string,unknown>):boolean {
  return uuid(data.requestId)&&uuid(data.localVenueId)&&['test','production'].includes(String(data.environment))
    &&typeof data.expiresAt==='string'&&Number.isFinite(Date.parse(data.expiresAt))
    &&(data.state==='awaiting_cloud'||(['awaiting_local','complete'].includes(String(data.state))&&binding(data)));
}
