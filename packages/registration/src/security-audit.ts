import type {Pool,PoolClient} from 'pg';
import {resolveSession} from '@waitron-cloud/identity';
import {transaction} from './transaction.ts';

export type SecurityAuditEventType='pairing.cloud_approved'|'pairing.local_approved'|'installation.credentials_renewed'|'installation.revoked'|'recovery.approved'|'replacement.approved';
export type SecurityAuditActorKind='account'|'installation'|'local_authority';
export type SecurityAuditSubjectKind='pairing_request'|'installation'|'recovery'|'replacement';
export interface SecurityAuditInput {
 organisationId:string;venueId:string|null;type:SecurityAuditEventType;actorKind:SecurityAuditActorKind;actorId:string;
 subjectKind:SecurityAuditSubjectKind;subjectId:string;sourceId:string;
}
export interface SecurityAuditEvent extends Omit<SecurityAuditInput,'sourceId'>{id:string;occurredAt:string}
export interface SecurityAuditPage {version:1;events:SecurityAuditEvent[];nextCursor:string|null}
export class SecurityAuditError extends Error {
 readonly code:'invalid_input'|'permission_denied'|'security_audit_conflict';
 constructor(code:SecurityAuditError['code']){super(code);this.name='SecurityAuditError';this.code=code;}
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const shapes:Record<SecurityAuditEventType,{actors:SecurityAuditActorKind[];subject:SecurityAuditSubjectKind;venue:boolean}>={
 'pairing.cloud_approved':{actors:['account'],subject:'pairing_request',venue:false},
 'pairing.local_approved':{actors:['local_authority'],subject:'pairing_request',venue:true},
 'installation.credentials_renewed':{actors:['installation'],subject:'installation',venue:true},
 'installation.revoked':{actors:['account','installation'],subject:'installation',venue:true},
 'recovery.approved':{actors:['account'],subject:'recovery',venue:true},
 'replacement.approved':{actors:['account'],subject:'replacement',venue:true},
};
function invalid():never{throw new SecurityAuditError('invalid_input');}
function validate(input:SecurityAuditInput){
 if(!input||typeof input!=='object'||Object.keys(input).sort().join(',')!=='actorId,actorKind,organisationId,sourceId,subjectId,subjectKind,type,venueId')invalid();
 if(![input.organisationId,input.actorId,input.subjectId,input.sourceId].every(id=>typeof id==='string'&&uuid.test(id)))invalid();
 if(input.venueId!==null&&(typeof input.venueId!=='string'||!uuid.test(input.venueId)))invalid();
 const shape=shapes[input.type];if(!shape||!shape.actors.includes(input.actorKind)||shape.subject!==input.subjectKind||shape.venue!==(input.venueId!==null))invalid();
}
interface Row {id:string;occurred_at:Date;organisation_id:string;venue_id:string|null;event_type:SecurityAuditEventType;actor_kind:SecurityAuditActorKind;actor_id:string;subject_kind:SecurityAuditSubjectKind;subject_id:string;source_id:string}
function same(row:Row,input:SecurityAuditInput){return row.organisation_id===input.organisationId&&row.venue_id===input.venueId&&row.event_type===input.type&&row.actor_kind===input.actorKind&&row.actor_id===input.actorId&&row.subject_kind===input.subjectKind&&row.subject_id===input.subjectId&&row.source_id===input.sourceId;}
export async function recordSecurityAuditEvent(client:PoolClient,input:SecurityAuditInput):Promise<{id:string;occurredAt:string}>{
 validate(input);
 if(input.venueId){const venue=(await client.query<{organisation_id:string}>('SELECT organisation_id FROM venues WHERE id=$1',[input.venueId])).rows[0];if(!venue||venue.organisation_id!==input.organisationId)throw new SecurityAuditError('security_audit_conflict');}
 const inserted=await client.query<Row>(`INSERT INTO security_audit_events
  (organisation_id,venue_id,event_type,actor_kind,actor_id,subject_kind,subject_id,source_id)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(event_type,source_id) DO NOTHING RETURNING *`,
 [input.organisationId,input.venueId,input.type,input.actorKind,input.actorId,input.subjectKind,input.subjectId,input.sourceId]);
 const row=inserted.rows[0]??(await client.query<Row>('SELECT * FROM security_audit_events WHERE event_type=$1 AND source_id=$2 FOR SHARE',[input.type,input.sourceId])).rows[0];
 if(!row||!same(row,input))throw new SecurityAuditError('security_audit_conflict');
 return {id:row.id,occurredAt:row.occurred_at.toISOString()};
}
function decodeCursor(cursor:string|undefined):[string,string]|null{
 if(cursor===undefined)return null;if(typeof cursor!=='string'||cursor.length<1||cursor.length>256||!/^[A-Za-z0-9_-]+$/.test(cursor))return invalid();
 try{const bytes=Buffer.from(cursor,'base64url');if(bytes.toString('base64url')!==cursor)return invalid();const value:unknown=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes));
  if(!Array.isArray(value)||value.length!==2||typeof value[0]!=='string'||typeof value[1]!=='string'||new Date(value[0]).toISOString()!==value[0]||!uuid.test(value[1]))return invalid();return [value[0],value[1]];
 }catch{return invalid();}
}
const encodeCursor=(row:Row)=>Buffer.from(JSON.stringify([row.occurred_at.toISOString(),row.id])).toString('base64url');
function event(row:Row):SecurityAuditEvent{return {id:row.id,occurredAt:row.occurred_at.toISOString(),organisationId:row.organisation_id,venueId:row.venue_id,type:row.event_type,actorKind:row.actor_kind,actorId:row.actor_id,subjectKind:row.subject_kind,subjectId:row.subject_id};}
export class SecurityAuditStore {
 readonly #pool:Pool;constructor(pool:Pool){this.#pool=pool;}
 async page(token:string,input:{organisationId:string;limit:number;cursor?:string}):Promise<SecurityAuditPage>{
  if(!input||typeof input!=='object'||!uuid.test(input.organisationId)||!Number.isSafeInteger(input.limit)||input.limit<1||input.limit>100||Object.keys(input).some(key=>!['organisationId','limit','cursor'].includes(key)))return invalid();
  const cursor=decodeCursor(input.cursor);
  return transaction(this.#pool,async client=>{
   const session=await resolveSession(client,token,{touch:false});
   const membership=await client.query('SELECT account_id FROM organisation_memberships WHERE account_id=$1 AND organisation_id=$2 AND is_owner FOR SHARE',[session.accountId,input.organisationId]);
   if(!membership.rowCount)throw new SecurityAuditError('permission_denied');
   const values:unknown[]=[input.organisationId,input.limit+1];let where='organisation_id=$1';
   if(cursor){values.push(cursor[0],cursor[1]);where+=' AND (occurred_at,id)<($3::timestamptz,$4::uuid)';}
   const rows=(await client.query<Row>(`SELECT * FROM security_audit_events WHERE ${where} ORDER BY occurred_at DESC,id DESC LIMIT $2`,values)).rows;
   await resolveSession(client,token,{touch:false});
   const more=rows.length>input.limit,visible=rows.slice(0,input.limit);
   return {version:1 as const,events:visible.map(event),nextCursor:more?encodeCursor(visible.at(-1)!):null};
  });
 }
}
