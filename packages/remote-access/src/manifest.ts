import {sign,verify,type KeyObject} from 'node:crypto';
export interface GatewayRoute {
 installationId:string;venueId:string;staffHostname:string;publicHostname:string;
 address:string;port:number;peerPublicKey:string;
}
export interface GatewayManifest {
 version:1;audience:'waitron-cloud-gateway';cellId:string;sequence:number;
 issuedAt:number;expiresAt:number;routes:GatewayRoute[];
}
export type ReportingGatewayRoute=GatewayRoute&{revision:number};
export interface ReportingGatewayManifest extends Omit<GatewayManifest,'version'|'routes'> {
 version:2;routes:ReportingGatewayRoute[];reporter:{gatewayId:string;generation:number};
}
export type AcceptedGatewayManifest=GatewayManifest|ReportingGatewayManifest;
export interface ManifestEnvelope {payload:string;signature:string}
export const isUuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
export const isHostname=(v:unknown):v is string=>typeof v==='string'&&v.length<=253&&v.includes('.')&&v.split('.').every(s=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(s))&&!/^\d+(\.\d+){3}$/.test(v);
export const isPeerKey=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9+/]{43}=$/.test(v)&&Buffer.from(v,'base64').length===32&&Buffer.from(v,'base64').toString('base64')===v;
export const isAddress=(v:unknown):v is string=>typeof v==='string'&&/^10\.77\.(0|[1-9]\d{0,2})\.([1-9]\d{0,2})$/.test(v)&&Number(v.split('.')[2])<=255&&Number(v.split('.')[3])>=2&&Number(v.split('.')[3])<=254;
function invalid():never{throw new Error('invalid_manifest');}
function object(v:unknown,keys:string[]):v is Record<string,unknown>{return !!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');}
function validate(v:unknown,now:number):asserts v is AcceptedGatewayManifest {
 const reporting=!!v&&typeof v==='object'&&'version'in v&&v.version===2;
 if(!object(v,['version','audience','cellId','sequence','issuedAt','expiresAt','routes',...(reporting?['reporter']:[])])||(v.version!==1&&v.version!==2)||v.audience!=='waitron-cloud-gateway'||!isUuid(v.cellId)
  ||!Number.isSafeInteger(v.sequence)||Number(v.sequence)<1||!Number.isSafeInteger(v.issuedAt)||Number(v.issuedAt)<0||!Number.isSafeInteger(v.expiresAt)
  ||Number(v.expiresAt)<=now||Number(v.issuedAt)>now+60000||Number(v.expiresAt)<=Number(v.issuedAt)||Number(v.expiresAt)-Number(v.issuedAt)>600000
  ||!Array.isArray(v.routes)||v.routes.length>64)invalid();
 if(reporting&&(!object(v.reporter,['gatewayId','generation'])||!isUuid(v.reporter.gatewayId)||!Number.isSafeInteger(v.reporter.generation)||Number(v.reporter.generation)<1))invalid();
 const ids=new Set(),venues=new Set(),names=new Set(),addresses=new Set(),keys=new Set();
 for(const r of v.routes){
  if(!object(r,['installationId','venueId','staffHostname','publicHostname','address','port','peerPublicKey',...(reporting?['revision']:[])])||!isUuid(r.installationId)||!isUuid(r.venueId)
   ||!isHostname(r.staffHostname)||!isHostname(r.publicHostname)||r.staffHostname===r.publicHostname||!isAddress(r.address)||!isPeerKey(r.peerPublicKey)
   ||!Number.isInteger(r.port)||Number(r.port)<1||Number(r.port)>65535||ids.has(r.installationId)||venues.has(r.venueId)||names.has(r.staffHostname)||names.has(r.publicHostname)||addresses.has(r.address)||keys.has(r.peerPublicKey))invalid();
  if(reporting&&(!Number.isSafeInteger(r.revision)||Number(r.revision)<0))invalid();
  ids.add(r.installationId);venues.add(r.venueId);names.add(r.staffHostname);names.add(r.publicHostname);addresses.add(r.address);keys.add(r.peerPublicKey);
 }
}
export function signManifest(value:AcceptedGatewayManifest,key:KeyObject,now=Date.now()):ManifestEnvelope {
 validate(value,now);if(key.asymmetricKeyType!=='ed25519')invalid();
 const bytes=Buffer.from(JSON.stringify(value));return {payload:bytes.toString('base64url'),signature:sign(null,bytes,key).toString('base64url')};
}
export function verifyManifest(envelope:unknown,key:KeyObject,cellId:string,now=Date.now(),minimumSequence=0):AcceptedGatewayManifest {
 try{
  if(!object(envelope,['payload','signature'])||typeof envelope.payload!=='string'||envelope.payload.length>65536||typeof envelope.signature!=='string'||envelope.signature.length!==86)invalid();
  const bytes=Buffer.from(envelope.payload,'base64url'),signature=Buffer.from(envelope.signature,'base64url');
  if(bytes.toString('base64url')!==envelope.payload||signature.toString('base64url')!==envelope.signature||signature.length!==64||key.asymmetricKeyType!=='ed25519'||!verify(null,bytes,key,signature))invalid();
  const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));validate(value,now);
  if(JSON.stringify(value)!==bytes.toString()||value.cellId!==cellId||value.sequence<=minimumSequence)invalid();return value;
 }catch{return invalid();}
}
