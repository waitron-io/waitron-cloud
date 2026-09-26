export type DiagnosticService='continuous_backup'|'remote_access'|'retained_snapshots';
export type DiagnosticIncident='disconnected'|'snapshot_stale'|'verification_failed'|'public_route_failed'|'staff_route_failed'|'public_probe_stale'|'staff_probe_stale'|'public_certificate_expiring'|'staff_certificate_expiring';
export interface DiagnosticExport{
 version:1;generatedAt:string;installation:{installationId:string;venueId:string;environment:'test'|'production';revision:number;
  access:{status:'active'|'revoked';lastContactAt:string|null;leaseExpiresAt:string|null};
  services:Array<{service:DiagnosticService;state:'unconfigured'|'provisioning'|'ready'|'failed';health:'unknown'|'healthy'|'degraded'|'failed';observedAt:string|null}>;
  backups:{latestSnapshotAt:string|null;verifiedSnapshotAt:string|null};
  monitoring:{enabled:boolean;fresh:boolean;checkedAt:string|null;
   incidents:Array<{kind:DiagnosticIncident;openedAt:string;changedAt:string}>;
   remoteChecks:{public:{status:'unknown'|'healthy'|'failed';checkedAt:string;certificateNotAfter:string|null}|null;staff:{status:'unknown'|'healthy'|'failed';checkedAt:string;certificateNotAfter:string|null}|null};
 }};
}
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:Record<string,unknown>,keys:string[])=>Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const timestamp=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const optionalTimestamp=(value:unknown)=>value===null||timestamp(value);
function validRemote(value:unknown){if(value===null)return true;if(!object(value)||!exact(value,['status','checkedAt','certificateNotAfter']))return false;return ['unknown','healthy','failed'].includes(String(value.status))&&timestamp(value.checkedAt)&&optionalTimestamp(value.certificateNotAfter);}
export function validDiagnosticExport(value:unknown):value is DiagnosticExport{
 if(!object(value)||!exact(value,['version','generatedAt','installation'])||value.version!==1||!timestamp(value.generatedAt)||!object(value.installation))return false;
 const i=value.installation;if(!exact(i,['installationId','venueId','environment','revision','access','services','backups','monitoring'])||!uuid.test(String(i.installationId))||!uuid.test(String(i.venueId))||!['test','production'].includes(String(i.environment))||!Number.isSafeInteger(i.revision)||Number(i.revision)<0||!object(i.access)||!exact(i.access,['status','lastContactAt','leaseExpiresAt'])||!['active','revoked'].includes(String(i.access.status))||!optionalTimestamp(i.access.lastContactAt)||!optionalTimestamp(i.access.leaseExpiresAt))return false;
 const names=['continuous_backup','remote_access','retained_snapshots'];if(!Array.isArray(i.services)||i.services.length!==3||new Set(i.services.map(service=>service?.service)).size!==3||!i.services.every(service=>object(service)&&exact(service,['service','state','health','observedAt'])&&names.includes(String(service.service))&&['unconfigured','provisioning','ready','failed'].includes(String(service.state))&&['unknown','healthy','degraded','failed'].includes(String(service.health))&&optionalTimestamp(service.observedAt)))return false;
 if(!object(i.backups)||!exact(i.backups,['latestSnapshotAt','verifiedSnapshotAt'])||!optionalTimestamp(i.backups.latestSnapshotAt)||!optionalTimestamp(i.backups.verifiedSnapshotAt)||!object(i.monitoring)||!exact(i.monitoring,['enabled','fresh','checkedAt','incidents','remoteChecks'])||typeof i.monitoring.enabled!=='boolean'||typeof i.monitoring.fresh!=='boolean'||!optionalTimestamp(i.monitoring.checkedAt)||!Array.isArray(i.monitoring.incidents)||!object(i.monitoring.remoteChecks)||!exact(i.monitoring.remoteChecks,['public','staff'])||!validRemote(i.monitoring.remoteChecks.public)||!validRemote(i.monitoring.remoteChecks.staff))return false;
 const kinds=['disconnected','snapshot_stale','verification_failed','public_route_failed','staff_route_failed','public_probe_stale','staff_probe_stale','public_certificate_expiring','staff_certificate_expiring'];
 return i.monitoring.incidents.length<=kinds.length&&new Set(i.monitoring.incidents.map(incident=>incident?.kind)).size===i.monitoring.incidents.length&&i.monitoring.incidents.every(incident=>object(incident)&&exact(incident,['kind','openedAt','changedAt'])&&kinds.includes(String(incident.kind))&&timestamp(incident.openedAt)&&timestamp(incident.changedAt));
}
