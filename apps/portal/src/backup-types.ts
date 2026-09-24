export interface BackupPointView {id:string;capturedAt:string;expiresAt:string;verification:'pending'|'verified'|'failed';retention:'daily'|'monthly';protection:'fallback'|'recovery'|null;}
export interface BackupPage {venueId:string;points:BackupPointView[];nextCursor:string|null;defaultPointId:string|null;continuousRecoveryAvailable:false;}
export function validBackupPage(value:unknown):value is BackupPage{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;const v=value as Record<string,unknown>;
 const id=(s:unknown)=>typeof s==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(s);
 const date=(s:unknown)=>typeof s==='string'&&Number.isFinite(Date.parse(s));
 return id(v.venueId)&&v.continuousRecoveryAvailable===false&&(v.defaultPointId===null||id(v.defaultPointId))&&(v.nextCursor===null||(typeof v.nextCursor==='string'&&/^[A-Za-z0-9_-]{1,256}$/.test(v.nextCursor)))
  &&Array.isArray(v.points)&&v.points.length<=50&&new Set(v.points.map(p=>p?.id)).size===v.points.length&&v.points.every(p=>p&&id(p.id)&&date(p.capturedAt)&&date(p.expiresAt)&&['pending','verified','failed'].includes(p.verification)&&['daily','monthly'].includes(p.retention)&&(p.protection===null||['fallback','recovery'].includes(p.protection)));
}
