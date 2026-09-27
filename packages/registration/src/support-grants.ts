import type {Pool,PoolClient} from 'pg';
import {IdentityError,resolveSession} from '@waitron-cloud/identity';
import {recordSecurityAuditEvent,securityAuditSourceId} from './security-audit.ts';
import {transaction} from './transaction.ts';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const identifier=/^[a-z][a-z0-9_.:-]{0,99}$/;

export interface SupportGrantConfig {eligibilityPermissions:readonly string[];grantableActions:readonly string[]}
export interface SupportGrantApproval {
 id:string;organisationId:string;venueId:string|null;platformAccountId:string;actions:readonly string[];reason:string;expiresAt:string;
}
export interface SupportGrant extends SupportGrantApproval {
 approvedByAccountId:string;createdAt:string;revokedAt:string|null;revokedByAccountId:string|null;
}
export interface SupportGrantAuthorization {
 grantId:string;platformAccountId:string;organisationId:string;venueId:string|null;action:string;operationId:string;
}
export class SupportGrantError extends Error {
 readonly code:'invalid_input'|'permission_denied'|'not_configured'|'grant_unavailable'|'grant_conflict'|'grant_expired'|'grant_revoked';
 constructor(code:SupportGrantError['code']){super(code);this.name='SupportGrantError';this.code=code;}
}
interface GrantRow {
 id:string;organisation_id:string;venue_id:string|null;platform_account_id:string;approved_by_account_id:string;actions:string[];reason:string;
 created_at:Date;expires_at:Date;revoked_at:Date|null;revoked_by_account_id:string|null;
}
function fail(code:SupportGrantError['code']):never{throw new SupportGrantError(code);}
function configured(values:readonly string[]):string[]{
 if(!Array.isArray(values)||values.some(value=>typeof value!=='string'||!identifier.test(value)))fail('invalid_input');
 return [...new Set(values)].sort();
}
function actions(values:readonly string[],allowed:readonly string[]):string[]{
 if(!Array.isArray(values)||values.length<1||values.length>100||values.some(value=>typeof value!=='string'||!identifier.test(value)))fail('invalid_input');
 const sorted=[...values].sort();if(new Set(sorted).size!==sorted.length||sorted.some(value=>!allowed.includes(value)))fail('invalid_input');return sorted;
}
function approval(input:SupportGrantApproval,allowed:readonly string[]):SupportGrantApproval{
 if(!input||typeof input!=='object'||Object.keys(input).sort().join(',')!=='actions,expiresAt,id,organisationId,platformAccountId,reason,venueId')fail('invalid_input');
 if(![input.id,input.organisationId,input.platformAccountId].every(value=>typeof value==='string'&&uuid.test(value))
  ||input.venueId!==null&&(typeof input.venueId!=='string'||!uuid.test(input.venueId))
  ||typeof input.reason!=='string'||input.reason!==input.reason.trim()||input.reason.length<1||input.reason.length>500
  ||typeof input.expiresAt!=='string'||!Number.isFinite(Date.parse(input.expiresAt))||new Date(input.expiresAt).toISOString()!==input.expiresAt)fail('invalid_input');
 return {...input,actions:actions(input.actions,allowed)};
}
function authorization(input:SupportGrantAuthorization):SupportGrantAuthorization{
 if(!input||typeof input!=='object'||Object.keys(input).sort().join(',')!=='action,grantId,operationId,organisationId,platformAccountId,venueId'
  ||![input.grantId,input.operationId,input.organisationId,input.platformAccountId].every(value=>typeof value==='string'&&uuid.test(value))
  ||input.venueId!==null&&(typeof input.venueId!=='string'||!uuid.test(input.venueId))
  ||typeof input.action!=='string'||!identifier.test(input.action))fail('invalid_input');
 return {...input};
}
function view(row:GrantRow):SupportGrant{return{
 id:row.id,organisationId:row.organisation_id,venueId:row.venue_id,platformAccountId:row.platform_account_id,
 approvedByAccountId:row.approved_by_account_id,actions:row.actions,reason:row.reason,createdAt:row.created_at.toISOString(),
 expiresAt:row.expires_at.toISOString(),revokedAt:row.revoked_at?.toISOString()??null,revokedByAccountId:row.revoked_by_account_id,
};}
function same(row:GrantRow,input:SupportGrantApproval,approver:string):boolean{return row.id===input.id&&row.organisation_id===input.organisationId
 &&row.venue_id===input.venueId&&row.platform_account_id===input.platformAccountId&&row.approved_by_account_id===approver
 &&row.reason===input.reason&&row.expires_at.toISOString()===input.expiresAt&&row.actions.length===input.actions.length
 &&row.actions.every((value,index)=>value===input.actions[index]);}
async function owner(client:PoolClient,accountId:string,organisationId:string):Promise<void>{
 const result=await client.query(`SELECT m.account_id FROM organisation_memberships m JOIN cloud_accounts a ON a.id=m.account_id
  WHERE m.account_id=$1 AND m.organisation_id=$2 AND m.is_owner AND a.disabled_at IS NULL FOR SHARE OF m,a`,[accountId,organisationId]);
 if(!result.rowCount)fail('permission_denied');
}
async function eligible(client:PoolClient,accountId:string,permissions:readonly string[]):Promise<void>{
 const result=await client.query(`SELECT a.id FROM cloud_accounts a JOIN platform_permissions p ON p.account_id=a.id
  WHERE a.id=$1 AND a.disabled_at IS NULL AND p.permission=ANY($2::text[]) FOR SHARE OF a,p`,[accountId,permissions]);
 if(!result.rowCount)fail('permission_denied');
}
async function venue(client:PoolClient,venueId:string|null,organisationId:string):Promise<void>{
 if(venueId===null)return;
 const result=await client.query('SELECT id FROM venues WHERE id=$1 AND organisation_id=$2 FOR SHARE',[venueId,organisationId]);
 if(!result.rowCount)fail('permission_denied');
}
async function session(client:PoolClient,token:string,csrfToken:string){
 try{return await resolveSession(client,token,{csrfToken,touch:false});}catch(error){if(error instanceof IdentityError)fail('permission_denied');throw error;}
}

export class SupportGrantStore {
 readonly #pool:Pool;readonly #eligibilityPermissions:string[];readonly #grantableActions:string[];
 constructor(pool:Pool,config:SupportGrantConfig={eligibilityPermissions:[],grantableActions:[]}){
  this.#pool=pool;this.#eligibilityPermissions=configured(config.eligibilityPermissions);this.#grantableActions=configured(config.grantableActions);
 }
 #requireConfigured(){if(this.#eligibilityPermissions.length<1||this.#grantableActions.length<1)fail('not_configured');}

 async approve(token:string,csrfToken:string,input:SupportGrantApproval):Promise<SupportGrant>{
  this.#requireConfigured();const proposed=approval(input,this.#grantableActions);
  return transaction(this.#pool,async client=>{
   const actor=await session(client,token,csrfToken);await owner(client,actor.accountId,proposed.organisationId);
   await eligible(client,proposed.platformAccountId,this.#eligibilityPermissions);await venue(client,proposed.venueId,proposed.organisationId);
   const prior=(await client.query<GrantRow>('SELECT * FROM support_grants WHERE id=$1 FOR SHARE',[proposed.id])).rows[0];
   if(prior){
    if(!same(prior,proposed,actor.accountId))fail('grant_conflict');
    await recordSecurityAuditEvent(client,{organisationId:prior.organisation_id,venueId:prior.venue_id,type:'support.granted',actorKind:'account',actorId:actor.accountId,subjectKind:'support_grant',subjectId:prior.id,sourceId:prior.id});
    await owner(client,actor.accountId,proposed.organisationId);await session(client,token,csrfToken);return view(prior);
   }
   const now:Date=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
   if(new Date(proposed.expiresAt).getTime()<=now.getTime())fail('invalid_input');
   const inserted=await client.query<GrantRow>(`INSERT INTO support_grants
    (id,organisation_id,venue_id,platform_account_id,approved_by_account_id,actions,reason,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO NOTHING RETURNING *`,
   [proposed.id,proposed.organisationId,proposed.venueId,proposed.platformAccountId,actor.accountId,proposed.actions,proposed.reason,proposed.expiresAt]);
   const row=inserted.rows[0]??(await client.query<GrantRow>('SELECT * FROM support_grants WHERE id=$1 FOR SHARE',[proposed.id])).rows[0];
   if(!row||!same(row,proposed,actor.accountId))fail('grant_conflict');
   await recordSecurityAuditEvent(client,{organisationId:row.organisation_id,venueId:row.venue_id,type:'support.granted',actorKind:'account',actorId:actor.accountId,subjectKind:'support_grant',subjectId:row.id,sourceId:row.id});
   await owner(client,actor.accountId,proposed.organisationId);await session(client,token,csrfToken);return view(row);
  });
 }

 async revoke(token:string,csrfToken:string,grantId:string):Promise<SupportGrant>{
  if(typeof grantId!=='string'||!uuid.test(grantId))fail('invalid_input');
  return transaction(this.#pool,async client=>{
   const actor=await session(client,token,csrfToken);
   let row=(await client.query<GrantRow>('SELECT * FROM support_grants WHERE id=$1 FOR UPDATE',[grantId])).rows[0];
   if(!row)fail('grant_unavailable');
   try{await owner(client,actor.accountId,row.organisation_id);}catch(error){if(error instanceof SupportGrantError&&error.code==='permission_denied')fail('grant_unavailable');throw error;}
   if(row.revoked_at===null){
    row=(await client.query<GrantRow>('UPDATE support_grants SET revoked_at=clock_timestamp(),revoked_by_account_id=$2 WHERE id=$1 AND revoked_at IS NULL RETURNING *',[grantId,actor.accountId])).rows[0]!;
    await recordSecurityAuditEvent(client,{organisationId:row.organisation_id,venueId:row.venue_id,type:'support.revoked',actorKind:'account',actorId:actor.accountId,subjectKind:'support_grant',subjectId:row.id,sourceId:row.id});
   }
   await owner(client,actor.accountId,row.organisation_id);await session(client,token,csrfToken);return view(row);
  });
 }

 async authorize<T>(input:SupportGrantAuthorization,protectedAction:(client:PoolClient)=>Promise<T>):Promise<T>{
  this.#requireConfigured();const requested=authorization(input);
  if(typeof protectedAction!=='function')fail('invalid_input');
  if(!this.#grantableActions.includes(requested.action))fail('permission_denied');
  return transaction(this.#pool,async client=>{
   const row=(await client.query<GrantRow>('SELECT * FROM support_grants WHERE id=$1 FOR SHARE',[requested.grantId])).rows[0];
   if(!row||row.organisation_id!==requested.organisationId||row.platform_account_id!==requested.platformAccountId
    ||row.venue_id!==null&&row.venue_id!==requested.venueId||!row.actions.includes(requested.action))fail('grant_unavailable');
   if(row.revoked_at!==null)fail('grant_revoked');
   if(row.venue_id===null)await venue(client,requested.venueId,row.organisation_id);
   const before:Date=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
   if(row.expires_at.getTime()<=before.getTime())fail('grant_expired');
   await eligible(client,row.platform_account_id,this.#eligibilityPermissions);
   await owner(client,row.approved_by_account_id,row.organisation_id);
   const result=await protectedAction(client);
   const after:Date=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
   if(row.expires_at.getTime()<=after.getTime())fail('grant_expired');
   await eligible(client,row.platform_account_id,this.#eligibilityPermissions);
   await owner(client,row.approved_by_account_id,row.organisation_id);
   await recordSecurityAuditEvent(client,{organisationId:row.organisation_id,venueId:requested.venueId,type:'support.accessed',actorKind:'platform_account',actorId:row.platform_account_id,subjectKind:'support_grant',subjectId:row.id,sourceId:securityAuditSourceId('support.accessed',row.id,requested.operationId)});
   const auditedAt:Date=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now;
   if(row.expires_at.getTime()<=auditedAt.getTime())fail('grant_expired');
   return result;
  });
 }
}
