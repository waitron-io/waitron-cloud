import type {PoolClient} from 'pg';
import {decideCountryFlow} from './country-policy.ts';
import type {CountryPolicy,CountryFlow,FlowRequest} from './country-policy.ts';
import type {LifecycleRef} from './data-lifecycle.ts';

export type BoundFlow=FlowRequest & LifecycleRef & {placementRevision:number};
export type FlowPermit={policyRevision:number;evidenceId:string};
export class FlowAuthorityError extends Error {
 readonly code:'flow_unavailable'|'flow_conflict'|'flow_denied'|'transaction_required';
 constructor(code:FlowAuthorityError['code']){super(code);this.name='FlowAuthorityError';this.code=code;}
}
function fail(code:FlowAuthorityError['code']):never{throw new FlowAuthorityError(code);}
const text=(value:unknown):value is string=>typeof value==='string'&&value.length>0&&value.trim()===value&&!/[\u0000-\u001f\u007f]/.test(value);
const revision=(value:unknown):value is number=>Number.isInteger(value)&&Number(value)>0&&Number(value)<=2147483647;
function endpoint(value:unknown):value is string{
 if(!text(value))return false;
 try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!value.includes('?')&&!value.includes('#')&&url.href===value;}
 catch{return false;}
}
function record(value:unknown,keys:readonly string[],code:FlowAuthorityError['code']):Record<string,unknown>{
 if(!value||typeof value!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail(code);
 const names=Reflect.ownKeys(value);
 if(names.length!==keys.length||names.some(key=>typeof key!=='string'||!keys.includes(key)))fail(code);
 const result:Record<string,unknown>={};
 for(const key of keys){
  const property=Object.getOwnPropertyDescriptor(value,key);
  if(!property||!('value' in property))fail(code);
  result[key]=property.value;
 }
 return result;
}
const requestKeys=['country','policyRevision','serviceId','supplierId','accountId','dataClass','endpoint','region'] as const;
function snapshotInput(value:BoundFlow):BoundFlow{
 const copy=record(value,[...requestKeys,'venueId','revision','placementRevision'],'flow_denied');
 if(!requestKeys.filter(key=>key!=='policyRevision').every(key=>text(copy[key]))||!endpoint(copy.endpoint)
  ||!text(copy.venueId)||!(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i).test(copy.venueId)
  ||![copy.policyRevision,copy.revision,copy.placementRevision].every(revision))fail('flow_denied');
 return Object.freeze(copy) as unknown as BoundFlow;
}
function strings(value:unknown):readonly string[]{
 if(!Array.isArray(value)||!value.every(text))fail('flow_unavailable');
 return Object.freeze([...value]);
}
function parsePolicy(value:unknown,country:string,version:number):CountryPolicy{
 const p=record(value,['country','revision','homeRegion','backupRegions','flows'],'flow_unavailable');
 if(p.country!==country||p.revision!==version||!text(p.country)||!revision(p.revision)||!text(p.homeRegion)||!Array.isArray(p.flows))fail('flow_unavailable');
 const flows=p.flows.map(value=>{
  const flow=record(value,['serviceId','supplierId','accountId','endpoint','dataClasses','regions','evidenceId','qualified'],'flow_unavailable');
  if(!['serviceId','supplierId','accountId','evidenceId'].every(key=>text(flow[key]))||!endpoint(flow.endpoint)||typeof flow.qualified!=='boolean')fail('flow_unavailable');
  return Object.freeze({...flow,dataClasses:strings(flow.dataClasses),regions:strings(flow.regions)}) as unknown as CountryFlow;
 });
 return Object.freeze({country:p.country,revision:p.revision,homeRegion:p.homeRegion,
  backupRegions:strings(p.backupRegions),flows:Object.freeze(flows)});
}
interface Binding {
 venue_id:string;service_id:string;placement_revision:number;country:string;policy_revision:number;
 supplier_id:string;account_id:string;endpoint:string;data_class:string;region:string;
}
interface Lifecycle {revision:number;state:string;requested_at:Date;effective_end_at:Date|null;deadline_at:Date|null}
const finiteDate=(value:unknown):value is Date=>value instanceof Date&&Number.isFinite(value.getTime());

/** Internal admission only; existing service permission and installation locks come first. */
export async function authorizeFlow(client:PoolClient,input:BoundFlow):Promise<FlowPermit>{
 try{
  // Bind caller-owned values before a connection or row lock can yield control.
  try{input=snapshotInput(input);}catch{fail('flow_denied');}
  try{await client.query('SAVEPOINT country_flow_transaction');}
  catch(error){if((error as {code?:string}).code==='25P01')fail('transaction_required');throw error;}
  await client.query('RELEASE SAVEPOINT country_flow_transaction');
  // Foreign-key writes and cancellation must meet at the venue before lifecycle locks.
  if(!(await client.query('SELECT id FROM venues WHERE id=$1 FOR KEY SHARE',[input.venueId])).rowCount)fail('flow_unavailable');
  const head=(await client.query('SELECT country,revision FROM country_policy_heads WHERE country=$1 FOR SHARE',[input.country])).rows[0];
  if(!head)fail('flow_unavailable');
  if(head.revision!==input.policyRevision)fail('flow_conflict');
  const lifecycle=(await client.query<Lifecycle>('SELECT revision,state,requested_at,effective_end_at,deadline_at FROM data_lifecycles WHERE venue_id=$1 FOR SHARE',[input.venueId])).rows[0];
  if(!lifecycle)fail('flow_unavailable');
  if(!revision(lifecycle.revision)||!['active','exit preparing','read-only until deadline','purging','purged'].includes(lifecycle.state)
   ||!finiteDate(lifecycle.requested_at)||lifecycle.effective_end_at!==null&&!finiteDate(lifecycle.effective_end_at)
   ||lifecycle.deadline_at!==null&&!finiteDate(lifecycle.deadline_at))fail('flow_unavailable');
  if(lifecycle.revision!==input.revision)fail('flow_conflict');
  const bindingHead=(await client.query('SELECT placement_revision FROM venue_country_binding_heads WHERE venue_id=$1 AND service_id=$2 FOR SHARE',[input.venueId,input.serviceId])).rows[0];
  if(!bindingHead)fail('flow_unavailable');
  if(bindingHead.placement_revision!==input.placementRevision)fail('flow_conflict');
  const binding=(await client.query<Binding>(`SELECT venue_id,service_id,placement_revision,country,policy_revision,supplier_id,account_id,endpoint,data_class,region
   FROM venue_country_bindings WHERE venue_id=$1 AND service_id=$2 AND placement_revision=$3`,[input.venueId,input.serviceId,input.placementRevision])).rows[0];
  const stored=(await client.query('SELECT country,revision,definition FROM country_policy_versions WHERE country=$1 AND revision=$2',[input.country,input.policyRevision])).rows[0];
  if(!binding||!stored)fail('flow_unavailable');
  if(![binding.venue_id,binding.service_id,binding.country,binding.supplier_id,binding.account_id,binding.data_class,binding.region].every(text)
   ||!endpoint(binding.endpoint)||!revision(binding.policy_revision)||!revision(binding.placement_revision))fail('flow_unavailable');
  const flow:FlowRequest=Object.freeze({country:binding.country,policyRevision:binding.policy_revision,serviceId:binding.service_id,
   supplierId:binding.supplier_id,accountId:binding.account_id,endpoint:binding.endpoint,dataClass:binding.data_class,region:binding.region});
  if(requestKeys.some(key=>flow[key]!==input[key])||binding.venue_id!==input.venueId.toLowerCase())fail('flow_conflict');
  const policy=parsePolicy(stored.definition,stored.country,stored.revision);
  // The database evaluates the deadline after every row-lock wait, preserving its precision.
  const live=(await client.query("SELECT state='active' AND (effective_end_at IS NULL OR clock_timestamp()<effective_end_at) AS live FROM data_lifecycles WHERE venue_id=$1",[input.venueId])).rows[0]?.live;
  if(live!==true)fail('flow_denied');
  const decision=decideCountryFlow(policy,flow);
  if(!decision.allowed)fail(decision.reason==='unknown_policy'?'flow_unavailable':decision.reason==='stale_policy'?'flow_conflict':'flow_denied');
  return {policyRevision:decision.policyRevision,evidenceId:decision.evidenceId};
 }catch(error){
  if(error instanceof FlowAuthorityError)throw error;
  fail('flow_unavailable');
 }
}
