import {isGuestMenuLanguageShape} from '../../../packages/remote-access/src/guest-menu-language.ts';
import type {RemoteDnsRecord} from '../../../packages/remote-access/src/certificates.ts';
export type RemoteKind='staff'|'public';
export type ForwardCause='upstream_non_200'|'upstream_timeout'|'upstream_response_limit'|'upstream_transport'|'forward_internal';
export interface PublicForwardView {category:ForwardCause|null;observedAt:string;expiresAt:string}
export interface GuestMenuView {version:1;venueId:string;url:string;revision:number;state:'off'|'current'|'blocked';publication:null|{bodySha256:string;defaultLanguage:string;receivedAt:string};}
interface RemoteName {assigned:string;current:string;recordMoved?:boolean;}
export interface RemoteView {guestMenu?:GuestMenuView;publicForward?:PublicForwardView|null;connectedRequired?:true;installationId:string;revision:number;revoked:boolean;names:Record<RemoteKind,RemoteName>|null;service:{state:'unconfigured'|'provisioning'|'ready'|'failed';health:'unknown'|'healthy'|'degraded'|'failed';observedAt:string|null;validUntil:string|null};}
export interface RemoteDns {installationId:string;kind:RemoteKind;hostname:string;records:[RemoteDnsRecord];}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const id=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
export const remoteHostname=(v:unknown):v is string=>typeof v==='string'&&v.length<=237&&v.includes('.')&&v.split('.').every(s=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(s))&&!/^\d+(\.\d+){3}$/.test(v);
const iso=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
export function validGuestMenuView(v:unknown):v is GuestMenuView{
 if(!object(v)||v.version!==1||!id(v.venueId)||typeof v.url!=='string'||!Number.isSafeInteger(v.revision)||Number(v.revision)<0||!['off','current','blocked'].includes(String(v.state)))return false;
 try{const url=new URL(v.url);if(url.protocol!=='https:'||url.href!==url.origin+'/m/'+v.venueId)return false;}catch{return false;}
 if(v.state!=='current')return v.publication===null;
 const p=v.publication;
 return Number(v.revision)>0&&object(p)&&typeof p.bodySha256==='string'&&/^[0-9a-f]{64}$/.test(p.bodySha256)&&isGuestMenuLanguageShape(p.defaultLanguage)&&iso(p.receivedAt);
}
function validForward(v:unknown):boolean{
 if(v===null||v===undefined)return true;
 return object(v)&&Object.keys(v).sort().join(',')==='category,expiresAt,observedAt'
  &&(v.category===null||(typeof v.category==='string'&&['upstream_non_200','upstream_timeout','upstream_response_limit','upstream_transport','forward_internal'].includes(v.category)))
  &&iso(v.observedAt)&&iso(v.expiresAt)&&Date.parse(v.expiresAt)>Date.parse(v.observedAt)&&Date.parse(v.expiresAt)<=Date.parse(v.observedAt)+300000;
}
function validRemoteName(v:unknown):v is RemoteName{
 return object(v)&&remoteHostname(v.assigned)&&remoteHostname(v.current)
  &&(v.recordMoved===undefined||typeof v.recordMoved==='boolean')
  &&(v.recordMoved!==true||v.current!==v.assigned);
}
export function validRemoteView(v:unknown):v is RemoteView{
 if(!object(v)||(v.guestMenu!==undefined&&!validGuestMenuView(v.guestMenu))||!validForward(v.publicForward)||(v.publicForward!=null&&(v.revoked===true||v.names===null))||!id(v.installationId)||!Number.isSafeInteger(v.revision)||(v.revision as number)<0||typeof v.revoked!=='boolean'||!object(v.service))return false;
 const names=v.names;
 return (v.connectedRequired===undefined||v.connectedRequired===true)&&(names===null||(object(names)&&['staff','public'].every(k=>validRemoteName(names[k]))))&&['unconfigured','provisioning','ready','failed'].includes(String(v.service.state))&&['unknown','healthy','degraded','failed'].includes(String(v.service.health))&&(v.service.validUntil===null||(typeof v.service.validUntil==='string'&&Number.isFinite(Date.parse(v.service.validUntil))))&&(v.service.observedAt===null||(typeof v.service.observedAt==='string'&&Number.isFinite(Date.parse(v.service.observedAt))));
}
export function validRemoteDns(v:unknown):v is RemoteDns{
 if(!object(v)||!id(v.installationId)||!['staff','public'].includes(String(v.kind))||!remoteHostname(v.hostname)||!Array.isArray(v.records)||v.records.length!==1)return false;
 const [record]=v.records;return object(record)&&record.type==='CNAME'&&record.name===v.hostname&&remoteHostname(record.value);
}

export function remoteReady(v:RemoteView|undefined,now=Date.now()):boolean {return !!v&&!v.revoked&&v.service.state==='ready'&&v.service.health==='healthy'&&!!v.service.validUntil&&Date.parse(v.service.validUntil)>now;}
