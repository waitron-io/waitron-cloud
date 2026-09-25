import type {AccountNotification} from './account-input.ts';
import type {EmailDeliveryContext,EmailDeliveryReceipt} from './email-delivery.ts';
const incidentKinds=['disconnected','snapshot_stale','verification_failed','public_route_failed','staff_route_failed','public_probe_stale','staff_probe_stale','public_certificate_expiring','staff_certificate_expiring'] as const;
export type IncidentKind=typeof incidentKinds[number];
export type NotifiableIncidentKind=IncidentKind;
export function isNotifiableIncident(kind:IncidentKind):kind is NotifiableIncidentKind{return incidentKinds.includes(kind);}
export interface ServiceAlert extends AccountNotification {
 incidentId:string;revision:number;venueId:string;issue:NotifiableIncidentKind;state:'open'|'recovered';
 checkedAt?:string;certificateNotAfter?:string;
}
export interface ServiceAlertMailer {sendServiceAlert(message:ServiceAlert,context?:EmailDeliveryContext):Promise<void|EmailDeliveryReceipt>;}
export function validServiceAlert(message:unknown):message is ServiceAlert {
 if(!message||typeof message!=='object')return false;
 const m=message as Record<string,unknown>,uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
 const date=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
 if(!uuid(m.incidentId)||!uuid(m.venueId)||!Number.isSafeInteger(m.revision)||Number(m.revision)<=0||typeof m.issue!=='string'||!incidentKinds.includes(m.issue as IncidentKind)||typeof m.state!=='string'||!['open','recovered'].includes(m.state))return false;
 if(!Object.keys(m).every(k=>['email','locale','incidentId','revision','venueId','issue','state','checkedAt','certificateNotAfter'].includes(k)))return false;
 const issue=m.issue as IncidentKind,route=issue.endsWith('_route_failed'),stale=issue.endsWith('_probe_stale'),certificate=issue.endsWith('_certificate_expiring');
 if(route&&(!date(m.checkedAt)||m.certificateNotAfter!==undefined))return false;
 if(stale&&!((m.checkedAt===undefined||date(m.checkedAt))&&m.certificateNotAfter===undefined))return false;
 if(certificate&&(!date(m.checkedAt)||!date(m.certificateNotAfter)))return false;
 if(!route&&!stale&&!certificate&&(m.checkedAt!==undefined||m.certificateNotAfter!==undefined))return false;
 return true;
}
