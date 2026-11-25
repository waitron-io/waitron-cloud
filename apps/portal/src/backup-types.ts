export interface BackupPointView {id:string;capturedAt:string;expiresAt:string;verification:'pending'|'verified'|'failed';retention:'daily'|'monthly';protection:'fallback'|'recovery'|null;}
export interface ContinuousRecoveryView {recoverableAt:string;checkedAt:string;sourceNodeId:string;}
interface ExitRecoveryView {effectiveEndAt:string;deadlineAt:string;expired:boolean;}
export interface BackupPage {venueId:string;points:BackupPointView[];nextCursor:string|null;defaultPointId:string|null;continuousRecovery:ContinuousRecoveryView|null;exitDownloadAvailable?:true;exitRecovery?:ExitRecoveryView;}
export function validBackupPage(value:unknown):value is BackupPage{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;const v=value as Record<string,unknown>;
 const id=(s:unknown)=>typeof s==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(s);
 const date=(s:unknown)=>typeof s==='string'&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString()===s;
 const keys=(o:Record<string,unknown>,expected:string[])=>Object.keys(o).length===expected.length&&expected.every(k=>k in o);
 const stream=v.continuousRecovery;
 const exit=v.exitRecovery as Record<string,unknown>|undefined;
 return keys(v,['venueId','points','nextCursor','defaultPointId','continuousRecovery',...(v.exitDownloadAvailable===true?['exitDownloadAvailable']:[]),...(exit===undefined?[]:['exitRecovery'])])&&id(v.venueId)
  &&(exit===undefined||!!exit&&typeof exit==='object'&&!Array.isArray(exit)&&keys(exit,['effectiveEndAt','deadlineAt','expired'])&&date(exit.effectiveEndAt)&&date(exit.deadlineAt)&&typeof exit.expired==='boolean')
  &&(stream===null||!!stream&&typeof stream==='object'&&!Array.isArray(stream)&&keys(stream as Record<string,unknown>,['recoverableAt','checkedAt','sourceNodeId'])&&date((stream as Record<string,unknown>).recoverableAt)&&date((stream as Record<string,unknown>).checkedAt)&&id((stream as Record<string,unknown>).sourceNodeId))
  &&(v.defaultPointId===null||id(v.defaultPointId))&&(v.nextCursor===null||(typeof v.nextCursor==='string'&&/^[A-Za-z0-9_-]{1,256}$/.test(v.nextCursor)))
  &&Array.isArray(v.points)&&v.points.length<=50&&new Set(v.points.map(p=>p?.id)).size===v.points.length&&v.points.every(p=>p&&typeof p==='object'&&!Array.isArray(p)&&keys(p,['id','capturedAt','expiresAt','retention','verification','protection'])&&id(p.id)&&date(p.capturedAt)&&date(p.expiresAt)&&['pending','verified','failed'].includes(p.verification as string)&&['daily','monthly'].includes(p.retention as string)&&(p.protection===null||['fallback','recovery'].includes(p.protection as string)));
}
export type BackupDownload = 'download'|'download-key'|'download-manifest'|'download-database';
export const backupDownloadDirectory = 'waitron-backup-download';
export interface DatabaseDownloadRequest {venueId: string; pointId: string; attempt: string; csrfToken: string;}
export async function removeDatabaseDownload(root: FileSystemDirectoryHandle) {
 try { await root.removeEntry(backupDownloadDirectory, {recursive: true}); }
 catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error; }
}
export function databaseStorageRefusal(error: unknown) {
 if (!(error instanceof DOMException)) return undefined;
 if (error.name === 'NoModificationAllowedError') return 'temporarily_unavailable';
 if (['QuotaExceededError','NotSupportedError','UnknownError','SecurityError','NotAllowedError'].includes(error.name)) return 'database_storage_unavailable';
}
