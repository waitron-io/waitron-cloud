import type {AccountNotification} from './account-input.ts';
import type {EmailDeliveryContext,EmailDeliveryReceipt} from './email-delivery.ts';
export type NotifiableIncidentKind='disconnected'|'snapshot_stale'|'verification_failed';
export type IncidentKind=NotifiableIncidentKind|'public_route_failed'|'staff_route_failed'|'public_probe_stale'|'staff_probe_stale'|'public_certificate_expiring'|'staff_certificate_expiring';
export function isNotifiableIncident(kind:IncidentKind):kind is NotifiableIncidentKind{return ['disconnected','snapshot_stale','verification_failed'].includes(kind);}
export interface ServiceAlert extends AccountNotification {
 incidentId:string;revision:number;venueId:string;issue:NotifiableIncidentKind;state:'open'|'recovered';
}
export interface ServiceAlertMailer {sendServiceAlert(message:ServiceAlert,context?:EmailDeliveryContext):Promise<void|EmailDeliveryReceipt>;}
export function validServiceAlert(message:unknown):message is ServiceAlert {
 if(!message||typeof message!=='object')return false;
 const m=message as Record<string,unknown>,uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
 return uuid(m.incidentId)&&uuid(m.venueId)&&Number.isSafeInteger(m.revision)&&Number(m.revision)>0&&typeof m.issue==='string'&&['disconnected','snapshot_stale','verification_failed'].includes(m.issue)&&typeof m.state==='string'&&['open','recovered'].includes(m.state);
}
