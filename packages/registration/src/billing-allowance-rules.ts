import type {CivilDate} from './billing-calendar.ts';
import type {BillingLevel,TrialView} from './billing-types.ts';
import {trialAllowanceTier} from './billing-trials.ts';

export type AllowanceService='transactional_email'|'sms'|'content_translation'|'rota_solver'|'address_lookup';
export type AllowanceOptions={mode:'test';calendar:'UTC'};
export type AllowanceVersion={revision:number;effectiveFrom:CivilDate;limits:Record<BillingLevel,Record<AllowanceService,string>>;unpaidTrial:{content_translation:string;rota_solver:string}};
export type AllowanceErrorCode='invalid_allowance_input'|'allowance_unavailable'|'allowance_conflict'|'allowance_exhausted'|'allowance_scope_not_found';
export class AllowanceError extends Error{
 readonly code:AllowanceErrorCode;
 constructor(code:AllowanceErrorCode){super(code);this.name='AllowanceError';this.code=code;}
}
const levels=['registered','connected','hosted'] as const;
const services=['transactional_email','sms','content_translation','rota_solver','address_lookup'] as const;
const trialServices=['content_translation','rota_solver'] as const;
function invalid():never{throw new AllowanceError('invalid_allowance_input');}
function record(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||!keys.every(key=>Object.hasOwn(value,key)))invalid();
 return value as Record<string,unknown>;
}
function date(value:unknown):CivilDate{
 if(typeof value!=='string'||value.length!==10||!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<'0001-01-01'||value>'9999-12-31')invalid();
 const parsed=new Date(`${value}T00:00:00Z`);
 if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)invalid();
 return value;
}
function quantity(value:unknown):string{
 if(typeof value!=='string'||value.length>19||/^(?:0|[1-9][0-9]*)$/.exec(value)?.[0]!==value||BigInt(value)>9223372036854775807n)invalid();
 return value;
}
export function validateAllowanceVersion(value:unknown):AllowanceVersion{
 const v=record(value,['revision','effectiveFrom','limits','unpaidTrial']);
 if(typeof v.revision!=='number'||!Number.isSafeInteger(v.revision)||v.revision<1)invalid();
 const effectiveFrom=date(v.effectiveFrom);if(!effectiveFrom.endsWith('-01'))invalid();
 const source=record(v.limits,levels),limits={} as AllowanceVersion['limits'];
 for(const level of levels){
  const row=record(source[level],services),result={} as Record<AllowanceService,string>;
  for(const service of services)result[service]=quantity(row[service]);
  limits[level]=result;
 }
 const trial=record(v.unpaidTrial,trialServices),unpaidTrial={} as AllowanceVersion['unpaidTrial'];
 for(const service of trialServices){
  const amount=quantity(trial[service]);
  if(BigInt(amount)>BigInt(limits.connected[service])||BigInt(amount)>BigInt(limits.hosted[service]))invalid();
  unpaidTrial[service]=amount;
 }
 return {revision:v.revision,effectiveFrom,limits,unpaidTrial};
}
export function allowanceMonth(day:CivilDate):{from:CivilDate;until:CivilDate}{
 const from=date(day).slice(0,7)+'-01',next=new Date(`${from}T00:00:00Z`);
 next.setUTCMonth(next.getUTCMonth()+1);
 if(next.getUTCFullYear()>9999)invalid();
 return {from,until:next.toISOString().slice(0,10)};
}
export function allowanceLimit(config:AllowanceVersion,input:{base:BillingLevel;trials:readonly TrialView[];day:CivilDate;hasPaymentMethod:boolean;service:AllowanceService}):bigint{
 const value=validateAllowanceVersion(config),i=record(input,['base','trials','day','hasPaymentMethod','service']);
 if(!(levels as readonly unknown[]).includes(i.base)||!(services as readonly unknown[]).includes(i.service)||typeof i.hasPaymentMethod!=='boolean'||!Array.isArray(i.trials))invalid();
 const day=date(i.day);if(value.effectiveFrom>day)throw new AllowanceError('allowance_unavailable');
 let rank=levels.indexOf(i.base as BillingLevel),active=false;const seen=new Set<unknown>();
 for(const trial of i.trials){
  const t=record(trial,['level','startedOn','endsOn','extended','state']);
  if((t.level!=='connected'&&t.level!=='hosted')||typeof t.extended!=='boolean'||!['active','converted','lapsed'].includes(t.state as string)||seen.has(t.level))invalid();
  seen.add(t.level);const start=date(t.startedOn),end=date(t.endsOn);if(start>=end)invalid();
  if(t.state==='active'&&start<=day&&day<end){active=true;rank=Math.max(rank,levels.indexOf(t.level));}
 }
 const service=i.service as AllowanceService;
 if(active&&(service==='content_translation'||service==='rota_solver')&&trialAllowanceTier(i.hasPaymentMethod)==='trial')return BigInt(value.unpaidTrial[service]);
 return BigInt(value.limits[levels[rank]!][service]);
}
