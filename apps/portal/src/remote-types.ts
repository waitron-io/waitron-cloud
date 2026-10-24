export type RemoteKind='staff'|'public';
export interface RemoteView {installationId:string;revision:number;revoked:boolean;names:Record<RemoteKind,{assigned:string;current:string}>|null;service:{state:'unconfigured'|'provisioning'|'ready'|'failed';health:'unknown'|'healthy'|'degraded'|'failed';observedAt:string|null;validUntil:string|null};}
export interface RemoteDns {installationId:string;kind:RemoteKind;hostname:string;records:{type:'CNAME';name:string;value:string}[];}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const id=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
export const remoteHostname=(v:unknown):v is string=>typeof v==='string'&&v.length<=237&&v.includes('.')&&v.split('.').every(s=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(s))&&!/^\d+(\.\d+){3}$/.test(v);
export function validRemoteView(v:unknown):v is RemoteView{
 if(!object(v)||!id(v.installationId)||!Number.isSafeInteger(v.revision)||(v.revision as number)<0||typeof v.revoked!=='boolean'||!object(v.service))return false;
 const names=v.names;
 return (names===null||(object(names)&&['staff','public'].every(k=>object(names[k])&&remoteHostname(names[k].assigned)&&remoteHostname(names[k].current))))&&['unconfigured','provisioning','ready','failed'].includes(String(v.service.state))&&['unknown','healthy','degraded','failed'].includes(String(v.service.health))&&(v.service.validUntil===null||(typeof v.service.validUntil==='string'&&Number.isFinite(Date.parse(v.service.validUntil))))&&(v.service.observedAt===null||(typeof v.service.observedAt==='string'&&Number.isFinite(Date.parse(v.service.observedAt))));
}
export function validRemoteDns(v:unknown):v is RemoteDns{
 if(!object(v)||!id(v.installationId)||!['staff','public'].includes(String(v.kind))||!remoteHostname(v.hostname)||!Array.isArray(v.records)||v.records.length!==2)return false;
 const [a,b]=v.records;return object(a)&&object(b)&&a.type==='CNAME'&&b.type==='CNAME'&&a.name===v.hostname&&b.name==='_acme-challenge.'+v.hostname&&remoteHostname(a.value)&&b.value==='_acme-challenge.'+a.value;
}

export function remoteReady(v:RemoteView|undefined,now=Date.now()):boolean {return !!v&&!v.revoked&&v.service.state==='ready'&&v.service.health==='healthy'&&!!v.service.validUntil&&Date.parse(v.service.validUntil)>now;}
