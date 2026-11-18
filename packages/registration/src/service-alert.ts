import type {AccountNotification} from './account-input.ts';
import type {EmailDeliveryContext,EmailDeliveryReceipt} from './email-delivery.ts';
const incidentKinds=['disconnected','snapshot_stale','verification_failed','public_route_failed','staff_route_failed','public_probe_stale','staff_probe_stale','public_record_moved','staff_record_moved'] as const;
export type IncidentKind=typeof incidentKinds[number];
export interface ServiceAlert extends AccountNotification {
 incidentId:string;revision:number;venueId:string;issue:IncidentKind;state:'open'|'recovered';
 checkedAt?:string;hostname?:string;target?:string;notification?:'reminder';
}
export interface ServiceAlertMailer {sendServiceAlert(message:ServiceAlert,context?:EmailDeliveryContext):Promise<void|EmailDeliveryReceipt>;}
const hostname = (value: unknown) => typeof value === 'string' && value.length <= 253
 && value.includes('.') && !/^\d+(?:\.\d+){3}$/.test(value)
 && value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));

export function validServiceAlert(message:unknown):message is ServiceAlert {
 if(!message||typeof message!=='object')return false;
 const m=message as Record<string,unknown>,uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
 const date=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
 if(!uuid(m.incidentId)||!uuid(m.venueId)||!Number.isSafeInteger(m.revision)||Number(m.revision)<=0||typeof m.issue!=='string'||!incidentKinds.includes(m.issue as IncidentKind)||typeof m.state!=='string'||!['open','recovered'].includes(m.state))return false;
 if(!Object.keys(m).every(k=>['email','locale','incidentId','revision','venueId','issue','state','checkedAt','notification','hostname','target'].includes(k)))return false;
 if('notification' in m&&(m.notification!=='reminder'||m.state!=='open'))return false;
 const issue=m.issue as IncidentKind,route=issue.endsWith('_route_failed'),stale=issue.endsWith('_probe_stale');
 if(issue.endsWith('_record_moved')) {
  return m.checkedAt === undefined && hostname(m.hostname) && hostname(m.target);
 }
 if('hostname' in m || 'target' in m) return false;
 if(route&&(!date(m.checkedAt)))return false;
 if(stale&&!((m.checkedAt===undefined||date(m.checkedAt))))return false;
 if(!route&&!stale&&(m.checkedAt!==undefined))return false;
 return true;
}
