import {createHash,sign,verify,type KeyObject} from 'node:crypto';
import {isUuid,type GatewayRoute,type ManifestEnvelope} from './manifest.ts';

export type ForwardCause='upstream_non_200'|'upstream_timeout'|'upstream_response_limit'|'upstream_transport'|'forward_internal';
export interface ForwardBinding {
 cellId:string;gatewayId:string;generation:number;installationId:string;venueId:string;revision:number;
 routeId:'public_availability';routeBinding:string;manifestSequence:number;manifestExpiresAt:number;
}
export interface ForwardObservation extends ForwardBinding {
 observationSequence:number;category:ForwardCause|null;observedAt:number;expiresAt:number;
}
export interface ForwardReport {
 version:1;audience:'waitron-cloud-public-forward-report';cellId:string;gatewayId:string;generation:number;
 sequence:number;issuedAt:number;observations:ForwardObservation[];
}
export interface PublicForwardView {category:ForwardCause|null;observedAt:string;expiresAt:string}

export function routeBinding(route:GatewayRoute):string {
 return createHash('sha256').update(JSON.stringify([route.installationId,route.venueId,route.staffHostname,
  route.publicHostname,route.address,route.port,route.peerPublicKey])).digest('hex');
}

function invalid():never{throw new Error('invalid_forward_report');}
function object(value:unknown,keys:string[]):value is Record<string,unknown>{
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
}
function integer(value:unknown,minimum=0):value is number{return Number.isSafeInteger(value)&&Number(value)>=minimum;}
function canonical(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}';
 return JSON.stringify(value);
}
function validate(value:unknown,now:number):asserts value is ForwardReport {
 if(!integer(now)||!object(value,['version','audience','cellId','gatewayId','generation','sequence','issuedAt','observations'])
  ||value.version!==1||value.audience!=='waitron-cloud-public-forward-report'||!isUuid(value.cellId)||!isUuid(value.gatewayId)
  ||!integer(value.generation,1)||!integer(value.sequence,1)||!integer(value.issuedAt)
  ||value.issuedAt>now+5000||value.issuedAt<now-300000||!Array.isArray(value.observations)||value.observations.length>64)invalid();
 const installations=new Set<string>(),venues=new Set<string>();
 for(const entry of value.observations){
  if(!object(entry,['cellId','gatewayId','generation','installationId','venueId','revision','routeId','routeBinding',
   'manifestSequence','manifestExpiresAt','observationSequence','category','observedAt','expiresAt'])
   ||entry.cellId!==value.cellId||entry.gatewayId!==value.gatewayId||entry.generation!==value.generation
   ||!isUuid(entry.installationId)||!isUuid(entry.venueId)||installations.has(entry.installationId)||venues.has(entry.venueId)
   ||!integer(entry.revision)||entry.routeId!=='public_availability'||typeof entry.routeBinding!=='string'||!/^[a-f0-9]{64}$/.test(entry.routeBinding)
   ||!integer(entry.manifestSequence,1)||!integer(entry.observationSequence,1)||entry.observationSequence>value.sequence
   ||(entry.category!==null&&(typeof entry.category!=='string'||!['upstream_non_200','upstream_timeout','upstream_response_limit','upstream_transport','forward_internal'].includes(entry.category)))
   ||!integer(entry.observedAt)||entry.observedAt>now+5000||!integer(entry.manifestExpiresAt)||entry.manifestExpiresAt<=entry.observedAt
   ||entry.manifestExpiresAt>entry.observedAt+600000||!integer(entry.expiresAt)||entry.expiresAt<=now
   ||entry.expiresAt!==Math.min(entry.observedAt+300000,entry.manifestExpiresAt))invalid();
  installations.add(entry.installationId);venues.add(entry.venueId);
 }
}

export function signForwardReport(report:ForwardReport,key:KeyObject):ManifestEnvelope {
 try{
  validate(report,report.issuedAt);if(key.asymmetricKeyType!=='ed25519')invalid();
  const bytes=Buffer.from(canonical(report));
  const envelope={payload:bytes.toString('base64url'),signature:sign(null,bytes,key).toString('base64url')};
  if(Buffer.byteLength(JSON.stringify(envelope))>262144)invalid();return envelope;
 }catch{return invalid();}
}
export function verifyForwardReport(envelope:unknown,key:KeyObject,now:number):ForwardReport {
 try{
  if(!object(envelope,['payload','signature'])||typeof envelope.payload!=='string'||envelope.payload.length>262144
   ||typeof envelope.signature!=='string'||envelope.signature.length!==86||Buffer.byteLength(JSON.stringify(envelope))>262144)invalid();
  const bytes=Buffer.from(envelope.payload,'base64url'),signature=Buffer.from(envelope.signature,'base64url');
  if(bytes.toString('base64url')!==envelope.payload||signature.toString('base64url')!==envelope.signature||signature.length!==64
   ||key.asymmetricKeyType!=='ed25519'||!verify(null,bytes,key,signature))invalid();
  const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));validate(value,now);
  if(canonical(value)!==bytes.toString())invalid();return value;
 }catch{return invalid();}
}
