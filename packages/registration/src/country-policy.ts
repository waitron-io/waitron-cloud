export interface CountryFlow {
  readonly serviceId:string;
  readonly supplierId:string;
  readonly accountId:string;
  readonly endpoint:string;
  readonly dataClasses:readonly string[];
  readonly regions:readonly string[];
  readonly evidenceId:string;
  readonly qualified:boolean;
}
export interface CountryPolicy {
  readonly country:string;
  readonly revision:number;
  readonly homeRegion:string;
  readonly backupRegions:readonly string[];
  readonly flows:readonly CountryFlow[];
}
export interface FlowRequest {
  readonly country:string;
  readonly policyRevision:number;
  readonly serviceId:string;
  readonly supplierId:string;
  readonly accountId:string;
  readonly dataClass:string;
  readonly endpoint:string;
  readonly region:string;
}
export type CountryFlowDecision={allowed:true;policyRevision:number;evidenceId:string}
  |{allowed:false;reason:'unknown_policy'|'stale_policy'|'unqualified_flow'|'destination_denied'};

// Intended locations do not qualify a supplier, account, purpose or processing destination.
export const spainCountryPolicy:CountryPolicy=Object.freeze({country:'ES',revision:1,homeRegion:'eu-south-2',
  backupRegions:Object.freeze(['eu-west-3']),flows:Object.freeze([])});

function text(value:string):boolean{
  return typeof value==='string'&&value.length>0&&value.trim()===value&&!/[\u0000-\u001f\u007f]/.test(value);
}
function endpoint(value:string):boolean{
  try{
    const url=new URL(value);
    return url.protocol==='https:'&&!url.username&&!url.password&&!value.includes('?')&&!value.includes('#')&&url.href===value;
  }catch{return false;}
}

/** Evaluate a trusted policy snapshot; qualification evidence must be accepted separately. */
export function decideCountryFlow(policy:CountryPolicy|undefined,request:FlowRequest):CountryFlowDecision{
  if(!policy||!text(policy.country)||policy.country!==request.country)return {allowed:false,reason:'unknown_policy'};
  if(!Number.isSafeInteger(policy.revision)||policy.revision<1||request.policyRevision!==policy.revision){
    return {allowed:false,reason:'stale_policy'};
  }
  if(![request.serviceId,request.supplierId,request.accountId,request.dataClass,request.endpoint,request.region].every(text)
    ||!endpoint(request.endpoint))return {allowed:false,reason:'destination_denied'};
  const flows=policy.flows.filter(flow=>flow.serviceId===request.serviceId&&flow.dataClasses.includes(request.dataClass)
    &&flow.qualified===true&&text(flow.evidenceId));
  if(flows.length===0)return {allowed:false,reason:'unqualified_flow'};
  // Keep all destination attributes on the same evidence record; never combine partial matches.
  const flow=flows.find(flow=>flow.supplierId===request.supplierId&&flow.accountId===request.accountId
    &&flow.endpoint===request.endpoint&&flow.regions.includes(request.region));
  return flow?{allowed:true,policyRevision:policy.revision,evidenceId:flow.evidenceId}:{allowed:false,reason:'destination_denied'};
}
