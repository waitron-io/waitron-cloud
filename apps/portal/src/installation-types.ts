export interface AccountInstallation {
 installationId:string;venueId:string;organisationId:string;legalBusinessId:string;environment:string;revision:number;
 revokedAt:string|null;lastContactAt:string|null;leaseExpiresAt:string|null;canRevoke?:boolean;
 overview?:{organisationName:string;businessName:string;countryCode:string|null;latestSnapshotAt:string|null;verifiedSnapshotAt:string|null};
 monitoring?:{enabled:boolean;fresh:boolean;checkedAt:string|null;incidents:{kind:'disconnected'|'snapshot_stale'|'verification_failed';openedAt:string;changedAt:string}[]};
 services:{service:'continuous_backup'|'remote_access'|'retained_snapshots';state:'unconfigured'|'provisioning'|'ready'|'failed';health:'unknown'|'healthy'|'degraded'|'failed';failure:string|null;observedAt:string|null}[];
}
export function validInstallation(value:unknown):value is AccountInstallation {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;const v=value as Record<string,unknown>;
 const id=(s:unknown)=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);
 const date=(s:unknown)=>s===null||(typeof s==='string'&&Number.isFinite(Date.parse(s)));
 return ['installationId','venueId','organisationId','legalBusinessId'].every(k=>id(v[k]))&&['test','production'].includes(String(v.environment))&&Number.isSafeInteger(v.revision)&&Number(v.revision)>=0
  &&['revokedAt','lastContactAt','leaseExpiresAt'].every(k=>date(v[k]))&&(v.canRevoke===undefined||typeof v.canRevoke==='boolean')&&(v.overview===undefined||validOverview(v.overview))&&(v.monitoring===undefined||validMonitoring(v.monitoring))&&Array.isArray(v.services)&&v.services.length===3
  &&new Set(v.services.map(s=>s?.service)).size===3&&v.services.every(s=>s&&['continuous_backup','remote_access','retained_snapshots'].includes(s.service)&&['unconfigured','provisioning','ready','failed'].includes(s.state)&&['unknown','healthy','degraded','failed'].includes(s.health)&&date(s.observedAt));
}

function validOverview(value:unknown):boolean{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;const v=value as Record<string,unknown>;
 const date=(s:unknown)=>s===null||(typeof s==='string'&&Number.isFinite(Date.parse(s)));
 return ['organisationName','businessName'].every(k=>typeof v[k]==='string'&&v[k].length>0&&[...v[k]].length<=200)&&(v.countryCode===null||(typeof v.countryCode==='string'&&/^[A-Z]{2}$/.test(v.countryCode)))&&date(v.latestSnapshotAt)&&date(v.verifiedSnapshotAt);
}

function validMonitoring(value:unknown):boolean{
 if(!value||typeof value!=='object')return false;const v=value as Record<string,unknown>;
 const date=(s:unknown)=>typeof s==='string'&&Number.isFinite(Date.parse(s));
 return typeof v.enabled==='boolean'&&typeof v.fresh==='boolean'&&(v.checkedAt===null||date(v.checkedAt))&&Array.isArray(v.incidents)&&v.incidents.length<=3&&new Set(v.incidents.map(i=>i?.kind)).size===v.incidents.length&&v.incidents.every(i=>i&&['disconnected','snapshot_stale','verification_failed'].includes(i.kind)&&date(i.openedAt)&&date(i.changedAt));
}
