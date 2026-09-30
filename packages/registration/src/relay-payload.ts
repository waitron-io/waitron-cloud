import {createCipheriv,createDecipheriv,createHmac,randomBytes} from 'node:crypto';
import {normaliseEmail} from './account-input.ts';
import {isPairingUuid} from './pairing-proof.ts';
export class RelayMessageError extends Error {
 readonly code:'invalid_message'|'relay_unavailable'|'grant_unavailable'|'message_conflict';
 constructor(code:RelayMessageError['code']){super(code);this.code=code;}
}
export function messageError(code:RelayMessageError['code']):never{throw new RelayMessageError(code);}
export type RelayClass='invitation'|'password_reset'|'email_change';
export interface RelayBody {version:1;messageId:string;grantId:string;grantRevision:number;class:RelayClass;recipient:string;displayName:string;locale:string;timeZone:string;expiresAt:string;token?:string;code?:string;codeExpiresAt?:string}
function exact(v:unknown,fields:string[]):v is Record<string,unknown>{return !!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===fields.sort().join(',');}
function date(v:unknown):v is string{return typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;}
export function relayBody(text:string,submit:boolean):RelayBody|{version:1;messageId:string}{
 if(Buffer.byteLength(text)>4096)messageError('invalid_message');
 let v:unknown;try{v=JSON.parse(text);}catch{return messageError('invalid_message');}
 if(!submit){if(!exact(v,['version','messageId'])||v.version!==1||!isPairingUuid(v.messageId))messageError('invalid_message');return v as {version:1;messageId:string};}
 const kind=(v as RelayBody|null)?.class;
 const fields=['version','messageId','grantId','grantRevision','class','recipient','displayName','locale','timeZone','expiresAt',...(kind==='email_change'?['code','codeExpiresAt']:['token'])];
 if(!exact(v,fields)||v.version!==1||!isPairingUuid(v.messageId)||!isPairingUuid(v.grantId)||!Number.isSafeInteger(v.grantRevision)||Number(v.grantRevision)<1
  ||!['invitation','password_reset','email_change'].includes(String(kind))||typeof v.recipient!=='string'||normaliseEmail(v.recipient)!==v.recipient||Buffer.byteLength(v.recipient)>254
  ||typeof v.displayName!=='string'||[...v.displayName].length>200||/[\p{Cc}\p{Cf}<>]/u.test(v.displayName)
  ||!['en','en-GB','en-US','es','es-ES'].includes(String(v.locale))||typeof v.timeZone!=='string'||v.timeZone.length>100||!date(v.expiresAt))messageError('invalid_message');
 try{new Intl.DateTimeFormat('en',{timeZone:v.timeZone});}catch{return messageError('invalid_message');}
 if(kind==='email_change'){
  if(typeof v.code!=='string'||!/^\d{6}$/.test(v.code)||!date(v.codeExpiresAt))messageError('invalid_message');
 }else if(typeof v.token!=='string'||! /^[A-Za-z0-9_-]{43}$/.test(v.token)||Buffer.from(v.token,'base64url').toString('base64url')!==v.token)messageError('invalid_message');
 return v as unknown as RelayBody;
}
export interface RelayKeyConfig {activeKeyId:string;keys:Record<string,string>}
export interface RelayPayloadBinding {installation_id:string;message_id:string;grant_id:string;grant_revision:number;class:RelayClass;key_id:string}
export class RelayKeys {
 readonly active:string;readonly #keys=new Map<string,Buffer>();
 constructor(config:RelayKeyConfig){
  if(!config||!config.keys||typeof config.keys!=='object'||Array.isArray(config.keys))messageError('relay_unavailable');
  for(const [id,key] of Object.entries(config.keys)){
   if(!/^[A-Za-z0-9_-]{1,64}$/.test(id)||typeof key!=='string'||!/^[a-fA-F0-9]{64}$/.test(key))messageError('relay_unavailable');
   this.#keys.set(id,Buffer.from(key,'hex'));
  }
  if(!this.#keys.has(config.activeKeyId))messageError('relay_unavailable');this.active=config.activeKeyId;
 }
 #key(id:string):Buffer{const key=this.#keys.get(id);if(!key)messageError('relay_unavailable');return key;}
 fingerprint(id:string,installationId:string,messageId:string,body:string):string{
  return id+':'+createHmac('sha256',this.#key(id)).update(JSON.stringify(['waitron-relay-v1',installationId,messageId,body])).digest('hex');
 }
 #aad(row:RelayPayloadBinding){return Buffer.from(JSON.stringify(['waitron-relay-v1',row.installation_id,row.message_id,row.grant_id,row.grant_revision,row.class,row.key_id]));}
 seal(row:RelayPayloadBinding,content:RelayBody&{managementOrigin:string}):Buffer{
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.#key(row.key_id),nonce);cipher.setAAD(this.#aad(row));
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(content),'utf8'),cipher.final()]);return Buffer.concat([nonce,cipher.getAuthTag(),encrypted]);
 }
 open(row:RelayPayloadBinding&{payload:Buffer}):RelayBody&{managementOrigin:string}{
  try{
   const decipher=createDecipheriv('aes-256-gcm',this.#key(row.key_id),row.payload.subarray(0,12));decipher.setAAD(this.#aad(row));decipher.setAuthTag(row.payload.subarray(12,28));
   return JSON.parse(Buffer.concat([decipher.update(row.payload.subarray(28)),decipher.final()]).toString('utf8'));
  }catch{return messageError('relay_unavailable');}
 }
}
