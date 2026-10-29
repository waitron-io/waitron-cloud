import {sign,verify,type KeyObject} from 'node:crypto';
import {isUuid,type ManifestEnvelope} from './manifest.ts';

export interface TrafficEntry {installationId:string;venueId:string;revision:number;routeBinding:string;channel:'staff'|'public';ingress:string;egress:string}
export interface TrafficReport {
 version:1;audience:'waitron-cloud-remote-traffic';cellId:string;gatewayId:string;generation:number;processId:string;
 sequence:number;from:string;until:string;complete:boolean;entries:TrafficEntry[];
}
function invalid():never{throw new Error('invalid_traffic_report');}
function object(value:unknown,keys:string[]):value is Record<string,unknown>{
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
}
const integer=(value:unknown,min:number):value is number=>Number.isSafeInteger(value)&&Number(value)>=min;
const instant=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
function quantity(value:unknown):bigint {
 if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,18})$/.test(value))return invalid();return BigInt(value);
}
function canonical(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}';
 return JSON.stringify(value);
}
/** Structural checks confer no reporter, route, country or freshness authority. */
export function validateTrafficReport(value:unknown):asserts value is TrafficReport {
 if(!object(value,['version','audience','cellId','gatewayId','generation','processId','sequence','from','until','complete','entries'])
  ||value.version!==1||value.audience!=='waitron-cloud-remote-traffic'||!isUuid(value.cellId)||!isUuid(value.gatewayId)||!isUuid(value.processId)
  ||!integer(value.generation,1)||!integer(value.sequence,1)||!instant(value.from)||!instant(value.until)||value.until<=value.from
  ||typeof value.complete!=='boolean'||!Array.isArray(value.entries)||value.entries.length>128)invalid();
 const routes=new Map<string,string>(),channels=new Set<string>(),venues=new Map<string,string>();
 for(const e of value.entries){
  if(!object(e,['installationId','venueId','revision','routeBinding','channel','ingress','egress'])||!isUuid(e.installationId)||!isUuid(e.venueId)
   ||!integer(e.revision,0)||typeof e.routeBinding!=='string'||!/^[a-f0-9]{64}$/.test(e.routeBinding)||(e.channel!=='staff'&&e.channel!=='public')
   ||quantity(e.ingress)+quantity(e.egress)>9223372036854775807n)invalid();
  const binding=JSON.stringify([e.venueId,e.revision,e.routeBinding]),channel=e.installationId+':'+e.channel;
  if(channels.has(channel)||routes.has(e.installationId)&&routes.get(e.installationId)!==binding||venues.has(e.venueId)&&venues.get(e.venueId)!==e.installationId)invalid();
  routes.set(e.installationId,binding);channels.add(channel);venues.set(e.venueId,e.installationId);
 }
 if(routes.size>64)invalid();
}
/** Decode for local persistence only; callers accepting remote input must verify the signature. */
export function trafficEnvelopeReport(envelope:unknown):TrafficReport {
 try{
  if(!object(envelope,['payload','signature'])||typeof envelope.payload!=='string'||envelope.payload.length>262144
   ||typeof envelope.signature!=='string'||envelope.signature.length!==86||Buffer.byteLength(JSON.stringify(envelope))>262144)invalid();
  const bytes=Buffer.from(envelope.payload,'base64url'),signature=Buffer.from(envelope.signature,'base64url');
  if(bytes.toString('base64url')!==envelope.payload||signature.toString('base64url')!==envelope.signature||signature.length!==64)invalid();
  const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));validateTrafficReport(value);
  if(canonical(value)!==bytes.toString())invalid();return value;
 }catch{return invalid();}
}
export function signTrafficReport(report:TrafficReport,key:KeyObject):ManifestEnvelope {
 try{
  validateTrafficReport(report);if(key.type!=='private'||key.asymmetricKeyType!=='ed25519')invalid();
  const bytes=Buffer.from(canonical(report));if(bytes.length>262144)invalid();
  const envelope={payload:bytes.toString('base64url'),signature:sign(null,bytes,key).toString('base64url')};
  trafficEnvelopeReport(envelope);return envelope;
 }catch{return invalid();}
}
export function verifyTrafficReport(envelope:unknown,key:KeyObject):TrafficReport {
 try{
  const report=trafficEnvelopeReport(envelope),e=envelope as ManifestEnvelope;
  if(key.asymmetricKeyType!=='ed25519'||!verify(null,Buffer.from(e.payload,'base64url'),key,Buffer.from(e.signature,'base64url')))invalid();
  return report;
 }catch{return invalid();}
}
