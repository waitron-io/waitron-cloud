import {createHash,sign,verify,type KeyObject} from 'node:crypto';
import {isUuid,type ManifestEnvelope,type AcceptedGatewayManifest} from './manifest.ts';

export interface TrafficLifecycle {
 version:1;audience:'waitron-cloud-remote-traffic-lifecycle';kind:'start'|'end';cellId:string;gatewayId:string;generation:number;
 processId:string;manifestDigest:string;startedAt:string;predecessorId:string|null;endedAt:string|null;finalSequence:number|null;
}
function invalid():never{throw new Error('invalid_traffic_lifecycle');}
function object(value:unknown,keys:string[]):value is Record<string,unknown>{
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
}
const instant=(value:unknown):value is string=>typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
 &&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
function canonical(value:unknown):string {
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical((value as Record<string,unknown>)[k])).join(',')+'}';
 return JSON.stringify(value);
}
function validate(value:unknown):asserts value is TrafficLifecycle {
 if(!object(value,['version','audience','kind','cellId','gatewayId','generation','processId','manifestDigest','startedAt','predecessorId','endedAt','finalSequence'])
  ||value.version!==1||value.audience!=='waitron-cloud-remote-traffic-lifecycle'||!['start','end'].includes(String(value.kind))
  ||!isUuid(value.cellId)||!isUuid(value.gatewayId)||!isUuid(value.processId)||!Number.isSafeInteger(value.generation)||Number(value.generation)<1
  ||typeof value.manifestDigest!=='string'||!/^[a-f0-9]{64}$/.test(value.manifestDigest)||!instant(value.startedAt)
  ||value.predecessorId!==null&&(!isUuid(value.predecessorId)||value.predecessorId===value.processId))invalid();
 if(value.kind==='start'){
  if(value.endedAt!==null||value.finalSequence!==null)invalid();
 }else if(!instant(value.endedAt)||value.endedAt<value.startedAt||!Number.isSafeInteger(value.finalSequence)||Number(value.finalSequence)<0
  ||Number(value.finalSequence)>0&&value.endedAt===value.startedAt)invalid();
}
/** The country and supervisor hash the identical accepted manifest, before signing their own records. */
export function trafficManifestDigest(manifest:AcceptedGatewayManifest):string {
 return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}
/** Decode for identity lookup only; this confers no supervisor or country authority. */
export function trafficEnvelopeLifecycle(envelope:unknown):TrafficLifecycle {
 try{
  if(!object(envelope,['payload','signature'])||typeof envelope.payload!=='string'||envelope.payload.length>8192
   ||typeof envelope.signature!=='string'||envelope.signature.length!==86)invalid();
  const bytes=Buffer.from(envelope.payload,'base64url'),signature=Buffer.from(envelope.signature,'base64url');
  if(bytes.toString('base64url')!==envelope.payload||signature.toString('base64url')!==envelope.signature||signature.length!==64)invalid();
  const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));validate(value);
  if(canonical(value)!==bytes.toString())invalid();return value;
 }catch{return invalid();}
}
export function signTrafficLifecycle(value:TrafficLifecycle,key:KeyObject):ManifestEnvelope {
 try{
  validate(value);if(key.type!=='private'||key.asymmetricKeyType!=='ed25519')invalid();
  const bytes=Buffer.from(canonical(value)),envelope={payload:bytes.toString('base64url'),signature:sign(null,bytes,key).toString('base64url')};
  trafficEnvelopeLifecycle(envelope);return envelope;
 }catch{return invalid();}
}
export function verifyTrafficLifecycle(envelope:unknown,key:KeyObject):TrafficLifecycle {
 try{
  const value=trafficEnvelopeLifecycle(envelope),e=envelope as ManifestEnvelope;
  if(key.asymmetricKeyType!=='ed25519'||!verify(null,Buffer.from(e.payload,'base64url'),key,Buffer.from(e.signature,'base64url')))invalid();
  return value;
 }catch{return invalid();}
}
