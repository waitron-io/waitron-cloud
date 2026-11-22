import {createCipheriv,createDecipheriv,createHmac,randomBytes} from 'node:crypto';
import {normaliseEmail} from './account-input.ts';
import {isPairingUuid} from './pairing-proof.ts';
import {builtInRoles, securityChanges} from './relay-staff-notices.ts';
export class RelayMessageError extends Error {
 readonly code:'invalid_message'|'relay_unavailable'|'grant_unavailable'|'message_conflict';
 constructor(code:RelayMessageError['code']){super(code);this.code=code;}
}
export function messageError(code:RelayMessageError['code']):never{throw new RelayMessageError(code);}
type RelayV1Class = 'invitation' | 'password_reset' | 'email_change';
interface RelayRequest {
  messageId: string;
  grantId: string;
  grantRevision: number;
  recipient: string;
  displayName: string;
  locale: string;
  timeZone: string;
  expiresAt: string;
}
interface RelayV1Body extends RelayRequest {
  version: 1;
  class: RelayV1Class;
  token?: string;
  code?: string;
  codeExpiresAt?: string;
}
type RoleFacts = {change: 'added' | 'removed'; editorName: string; at: string}
  & ({builtInKey: keyof typeof builtInRoles} | {roleName: string});
type ClockFacts = {
  code: 'clock.corrected';
  before: string;
  after: string;
  beforeOffsetMinutes: number;
  afterOffsetMinutes: number;
  stepMs: number;
  source: 'admin' | 'staff' | 'setup';
  unverified: boolean;
  person?: string;
  device?: string;
};
type BoxAlertFacts =
  | {code: 'storage.space_low' | 'storage.disk_full'}
  | {code: 'backup.archives_deleted'; count: number; date: string; lastDate: string}
  | {code: 'backup.run_stopped'; neededBytes: number; availableBytes: number}
  | {code: 'upgrade.rolled_back'; fromVersion: string; toVersion: string}
  | ClockFacts;
type CertificateFacts = {date: string}
  & ({stage: 'due'; daysLeft: number} | {stage: 'expired'});
export type RelayStaffNotice = RelayRequest & {version: 2} & (
  | {class: 'email_changed'; facts: {editorName: string; at: string}}
  | {class: 'security_change'; facts: {change: keyof typeof securityChanges; at: string}}
  | {class: 'role_membership_changed'; facts: RoleFacts}
  | {class: 'box_alert'; facts: BoxAlertFacts}
  | {class: 'certificate_reminder'; facts: CertificateFacts}
);
export type RelayBody = RelayV1Body | RelayStaffNotice;
export type RelayClass = RelayBody['class'];

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exact(value: unknown, fields: string[]): value is Record<string, unknown> {
  return object(value) && Object.keys(value).length === fields.length
    && fields.every(field => Object.hasOwn(value, field));
}
function date(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}
function label(value: unknown, max: number): value is string {
  return typeof value === 'string' && [...value].length <= max && !/[\p{Cc}\p{Cf}<>]/u.test(value);
}
function noticeLabel(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && [...value].length <= 80
    && !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(value);
}
function calendarDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && date(value + 'T00:00:00.000Z');
}
function whole(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}
function releaseVersion(value: unknown): boolean {
  // Match the release versions the box host accepts.
  return typeof value === 'string' && value.length <= 50
    && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:alpha|beta|rc)\.(?:0|[1-9]\d*))?$/.test(value);
}
function validBoxAlert(facts: unknown): boolean {
  if (!object(facts)) return false;
  switch (facts.code) {
    case 'storage.space_low':
    case 'storage.disk_full':
      return exact(facts, ['code']);
    case 'backup.archives_deleted':
      return exact(facts, ['code', 'count', 'date', 'lastDate']) && whole(facts.count, 1)
        && calendarDate(facts.date) && calendarDate(facts.lastDate) && facts.date <= facts.lastDate;
    case 'backup.run_stopped':
      return exact(facts, ['code', 'neededBytes', 'availableBytes'])
        && whole(facts.neededBytes, 0) && whole(facts.availableBytes, 0);
    case 'upgrade.rolled_back':
      return exact(facts, ['code', 'fromVersion', 'toVersion'])
        && releaseVersion(facts.fromVersion) && releaseVersion(facts.toVersion);
    case 'clock.corrected': {
      const fields = ['code', 'before', 'after', 'beforeOffsetMinutes', 'afterOffsetMinutes',
        'stepMs', 'source', 'unverified'];
      if (Object.hasOwn(facts, 'person')) {
        if (facts.unverified !== false || !noticeLabel(facts.person)) return false;
        fields.push('person');
      }
      if (Object.hasOwn(facts, 'device')) {
        if (facts.unverified !== false || facts.source !== 'staff' || !noticeLabel(facts.device)) return false;
        fields.push('device');
      }
      return exact(facts, fields) && date(facts.before) && date(facts.after)
        && whole(facts.beforeOffsetMinutes, -840, 840) && whole(facts.afterOffsetMinutes, -840, 840)
        && whole(facts.stepMs, Number.MIN_SAFE_INTEGER)
        && (facts.source === 'admin' || facts.source === 'staff' || facts.source === 'setup')
        && typeof facts.unverified === 'boolean';
    }
    default:
      return false;
  }
}
function validNotice(kind: unknown, facts: unknown): boolean {
  switch (kind) {
    case 'email_changed':
      return exact(facts, ['editorName', 'at']) && noticeLabel(facts.editorName) && date(facts.at);
    case 'security_change':
      return exact(facts, ['change', 'at']) && typeof facts.change === 'string'
        && Object.hasOwn(securityChanges, facts.change) && date(facts.at);
    case 'role_membership_changed': {
      const fields = ['change', 'editorName', 'at'];
      if (!object(facts) || (facts.change !== 'added' && facts.change !== 'removed')
        || !noticeLabel(facts.editorName) || !date(facts.at)) return false;
      if (Object.hasOwn(facts, 'builtInKey')) {
        return exact(facts, [...fields, 'builtInKey']) && typeof facts.builtInKey === 'string'
          && Object.hasOwn(builtInRoles, facts.builtInKey);
      }
      return exact(facts, [...fields, 'roleName']) && noticeLabel(facts.roleName);
    }
    case 'box_alert':
      return validBoxAlert(facts);
    case 'certificate_reminder':
      if (!object(facts) || !calendarDate(facts.date)) return false;
      if (facts.stage === 'due') return exact(facts, ['stage', 'date', 'daysLeft']) && whole(facts.daysLeft, 0);
      return facts.stage === 'expired' && exact(facts, ['stage', 'date']);
    default:
      return false;
  }
}
const submitFields = [
  'version', 'messageId', 'grantId', 'grantRevision', 'class', 'recipient',
  'displayName', 'locale', 'timeZone', 'expiresAt',
];

export function relayBody(text: string, submit: boolean): RelayBody | {version: 1; messageId: string} {
  if (Buffer.byteLength(text) > 4096) messageError('invalid_message');
  let value: unknown;
  try {value = JSON.parse(text);} catch {return messageError('invalid_message');}
  if (!submit) {
    if (!exact(value, ['version', 'messageId']) || value.version !== 1 || !isPairingUuid(value.messageId)) {
      messageError('invalid_message');
    }
    return {version: 1, messageId: value.messageId};
  }
  if (!object(value) || (value.version !== 1 && value.version !== 2)
    || !isPairingUuid(value.messageId) || !isPairingUuid(value.grantId)
    || !Number.isSafeInteger(value.grantRevision) || Number(value.grantRevision) < 1
    || typeof value.recipient !== 'string' || normaliseEmail(value.recipient) !== value.recipient
    || Buffer.byteLength(value.recipient) > 254 || !label(value.displayName, 200)
    || typeof value.locale !== 'string' || !['en', 'en-GB', 'en-US', 'es', 'es-ES'].includes(value.locale)
    || typeof value.timeZone !== 'string' || value.timeZone.length > 100 || !date(value.expiresAt)) {
    messageError('invalid_message');
  }
  try {new Intl.DateTimeFormat('en', {timeZone: value.timeZone});}
  catch {return messageError('invalid_message');}
  if (value.version === 2) {
    if (!exact(value, [...submitFields, 'facts']) || !validNotice(value.class, value.facts)) {
      messageError('invalid_message');
    }
  } else if (value.class === 'email_change') {
    if (!exact(value, [...submitFields, 'code', 'codeExpiresAt'])
      || typeof value.code !== 'string' || !/^\d{6}$/.test(value.code) || !date(value.codeExpiresAt)) {
      messageError('invalid_message');
    }
  } else if ((value.class !== 'invitation' && value.class !== 'password_reset')
    || !exact(value, [...submitFields, 'token']) || typeof value.token !== 'string'
    || !/^[A-Za-z0-9_-]{43}$/.test(value.token)
    || Buffer.from(value.token, 'base64url').toString('base64url') !== value.token) {
    messageError('invalid_message');
  }
  return value as unknown as RelayBody;
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
