import {createHash,createPrivateKey,createPublicKey,sign,verify,type KeyObject} from 'node:crypto';
import {isPairingUuid} from './pairing-proof.ts';

export type MachineAction='renew'|'configuration'|'report'|'revoke'|'backup-reserve'|'backup-publish';
export interface SignedEnvelope {payload:string;signature:string}
export interface MachineClaims {origin:string;action:MachineAction;installationId:string;operationId:string;issuedAt:number;lease:string;body:string}
export interface LeaseInput {origin:string;leaseId:string;installationId:string;venueId:string;environment:'test'|'production';publicKey:string;issuedAt:number;expiresAt:number}
export interface LeaseClaims extends LeaseInput {keyId:string;audience:'control'}
export class InstallationError extends Error {
  readonly code:'invalid_proof'|'unavailable'|'revoked'|'conflict'|'permission_denied';
  constructor(code:InstallationError['code']){super(code);this.code=code;}
}
function invalid():never {throw new InstallationError('invalid_proof');}
function decode(value:unknown,max:number):Buffer {
  if(typeof value!=='string'||!value.length||value.length>max||!/^[A-Za-z0-9_-]+$/.test(value))return invalid();
  const bytes=Buffer.from(value,'base64url');if(bytes.toString('base64url')!==value)return invalid();return bytes;
}
function publicKey(value:string):KeyObject {
  const bytes=decode(value,128),key=createPublicKey({key:bytes,type:'spki',format:'der'});
  if(key.asymmetricKeyType!=='ed25519'||!key.export({type:'spki',format:'der'}).equals(bytes))return invalid();return key;
}
function originValid(value:unknown):value is string {
  if(typeof value!=='string'||value.length>256)return false;
  try {const url=new URL(value);return url.origin===value&&['http:','https:'].includes(url.protocol);}catch{return false;}
}
function dateValid(value:unknown):value is number {return Number.isSafeInteger(value)&&Number(value)>=0;}
function envelope(value:unknown):{bytes:Buffer;signature:Buffer;values:unknown[]} {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='payload,signature')return invalid();
  const e=value as SignedEnvelope,bytes=decode(e.payload,12000),signature=decode(e.signature,86);
  const values:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(signature.length!==64||!Array.isArray(values)||!Buffer.from(JSON.stringify(values)).equals(bytes))return invalid();
  return {bytes,signature,values};
}
export function encodeMachine(c:MachineClaims):Buffer {
  return Buffer.from(JSON.stringify(['waitron-cloud-machine-v1',c.origin,c.action,c.installationId,c.operationId,c.issuedAt,c.lease,c.body]));
}
/** Parses routing fields only. Call verifyMachine with the stored installation key before using any claim. */
export function readMachineClaims(value:unknown):MachineClaims {
  try {
    const {values:v}=envelope(value);
    if(v.length!==8||v[0]!=='waitron-cloud-machine-v1'||!originValid(v[1])||!['renew','configuration','report','revoke','backup-reserve','backup-publish'].includes(v[2] as string)
      ||!isPairingUuid(v[3])||!isPairingUuid(v[4])||!dateValid(v[5])||typeof v[6]!=='string'||v[6].length>4096||typeof v[7]!=='string'||v[7].length>4096)return invalid();
    return {origin:v[1],action:v[2] as MachineAction,installationId:v[3],operationId:v[4],issuedAt:v[5],lease:v[6],body:v[7]};
  }catch{return invalid();}
}
export function verifyMachine(value:unknown,key:string,origin:string,action:MachineAction,now=Date.now()):MachineClaims {
  try {
    const c=readMachineClaims(value),e=envelope(value);
    if(c.origin!==origin||c.action!==action||Math.abs(now-c.issuedAt)>60000||!verify(null,e.bytes,publicKey(key),e.signature))return invalid();return c;
  }catch{return invalid();}
}
function encodeLease(c:LeaseClaims):Buffer {return Buffer.from(JSON.stringify(['waitron-cloud-access-v1',c.origin,c.keyId,c.leaseId,c.installationId,c.venueId,c.environment,c.publicKey,c.issuedAt,c.expiresAt,c.audience]));}
function validateLease(c:LeaseClaims):void {
  if(!originValid(c.origin)||!/^[A-Za-z0-9_-]{43}$/.test(c.keyId)||![c.leaseId,c.installationId,c.venueId].every(isPairingUuid)
    ||!['test','production'].includes(c.environment)||!dateValid(c.issuedAt)||!dateValid(c.expiresAt)||c.expiresAt<=c.issuedAt||c.expiresAt-c.issuedAt>3600000||c.audience!=='control')invalid();
  publicKey(c.publicKey);
}
export function createLeaseIssuer(encoded:string) {
  const bytes=decode(encoded,256),key=createPrivateKey({key:bytes,type:'pkcs8',format:'der'});
  if(key.asymmetricKeyType!=='ed25519'||!key.export({type:'pkcs8',format:'der'}).equals(bytes))return invalid();
  const pub=createPublicKey(key).export({type:'spki',format:'der'}),keyId=createHash('sha256').update(pub).digest('base64url');
  return {keyId,publicKey:pub.toString('base64url'),issue(input:LeaseInput):SignedEnvelope {
    const c:LeaseClaims={...input,keyId,audience:'control'};validateLease(c);const payload=encodeLease(c);
    return {payload:payload.toString('base64url'),signature:sign(null,payload,key).toString('base64url')};
  }};
}
export type LeaseIssuer=ReturnType<typeof createLeaseIssuer>;
export function verifyLease(value:unknown,trusted:ReadonlyMap<string,string>,origin:string,now=Date.now()):LeaseClaims {
  try {
    const e=envelope(value),v=e.values;if(v.length!==11||v[0]!=='waitron-cloud-access-v1')return invalid();
    const c:LeaseClaims={origin:v[1] as string,keyId:v[2] as string,leaseId:v[3] as string,installationId:v[4] as string,venueId:v[5] as string,environment:v[6] as LeaseClaims['environment'],publicKey:v[7] as string,issuedAt:v[8] as number,expiresAt:v[9] as number,audience:v[10] as 'control'};
    validateLease(c);const key=trusted.get(c.keyId);
    if(!key||c.origin!==origin||c.issuedAt>now+60000||c.expiresAt<=now||!verify(null,e.bytes,publicKey(key),e.signature))return invalid();return c;
  }catch{return invalid();}
}
