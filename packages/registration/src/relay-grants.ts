import {randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {IdentityError,resolveSession} from '@waitron-cloud/identity';
import {transaction} from './transaction.ts';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const version=/^[a-zA-Z0-9_.:-]{1,100}$/;
export class RelayError extends Error {
 readonly code:'relay_disabled'|'invalid_input'|'grant_unavailable'|'origin_unverified'|'grant_conflict'|'message_conflict'|'allowance_exhausted'|'policy_conflict'|'transaction_required';
 constructor(code:RelayError['code']){super(code);this.name='RelayError';this.code=code;}
}
function fail(code:RelayError['code']):never{throw new RelayError(code);}
function exact(value:unknown,keys:string[]):boolean{return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys.sort().join(',');}
function date(value:unknown):value is string{return typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;}
function id(value:unknown):value is string{return typeof value==='string'&&uuid.test(value);}
function canonicalOrigin(value:unknown):value is string{
 if(typeof value!=='string'||value.length>253)return false;
 try{const u=new URL(value);return u.protocol==='https:'&&u.origin===value&&!u.username&&!u.password;}catch{return false;}
}
export interface RelayPolicy {version:string;units:number;periodSeconds:number;epoch:string;excess:'refuse';debit:'retain'}
export interface OriginChallenge {installationId:string;managementOrigin:string;challenge:string}
export interface OriginEvidence extends OriginChallenge {domainControl:true;httpsEndpoint:true;expiresAt:string}
export interface RelayConfig {mode:'local-proof';consentVersion:string;policy:RelayPolicy;verifyOrigin:(request:OriginChallenge)=>Promise<OriginEvidence>}
export interface RelayApproval {installationId:string;expectedRevision:number;consent:true;consentVersion:string;managementOrigin:string;expiresAt:string}
export interface RelayGrant {id:string;installationId:string;accountId:string;organisationId:string;venueId:string;environment:string;managementOrigin:string;revision:number;expiresAt:string;enabled:boolean}
interface GrantRow {
 id:string;installation_id:string;account_id:string;organisation_id:string;venue_id:string;environment:string;public_key:string;
 management_origin:string;consent_version:string;revision:number;expires_at:Date;origin_verified_until:Date;enabled:boolean;revoked_at:Date|null;
}
interface InstallationRow {id:string;venue_id:string;organisation_id:string;environment:string;public_key:string;revoked_at:Date|null;superseded_by:string|null;lease_expires_at:Date|null}
function view(g:GrantRow):RelayGrant{return {id:g.id,installationId:g.installation_id,accountId:g.account_id,organisationId:g.organisation_id,venueId:g.venue_id,environment:g.environment,managementOrigin:g.management_origin,revision:g.revision,expiresAt:g.expires_at.toISOString(),enabled:g.enabled&&g.revoked_at===null};}
async function now(client:PoolClient):Promise<number>{return (await client.query('SELECT clock_timestamp() AS now')).rows[0].now.getTime();}
async function session(client:PoolClient,token:string,csrfToken:string){
 try{return await resolveSession(client,token,{csrfToken,touch:false});}catch(e){if(e instanceof IdentityError)fail('grant_unavailable');throw e;}
}
async function account(client:PoolClient,accountId:string){
 if(!(await client.query('SELECT id FROM cloud_accounts WHERE id=$1 AND disabled_at IS NULL FOR SHARE',[accountId])).rowCount)fail('grant_unavailable');
 if(!(await client.query('SELECT account_id FROM cloud_credentials WHERE account_id=$1 AND email_verified_at IS NOT NULL FOR SHARE',[accountId])).rowCount)fail('grant_unavailable');
}
async function authority(client:PoolClient,accountId:string,installationId:string):Promise<InstallationRow>{
 const candidate=(await client.query('SELECT v.organisation_id,i.venue_id FROM installations i JOIN venues v ON v.id=i.venue_id WHERE i.id=$1',[installationId])).rows[0];
 if(!candidate)fail('grant_unavailable');
 if(!(await client.query('SELECT account_id FROM organisation_memberships WHERE account_id=$1 AND organisation_id=$2 AND is_owner FOR SHARE',[accountId,candidate.organisation_id])).rowCount)fail('grant_unavailable');
 const venue=(await client.query('SELECT organisation_id,environment FROM venues WHERE id=$1 FOR SHARE',[candidate.venue_id])).rows[0];
 if(!venue||venue.organisation_id!==candidate.organisation_id||venue.environment!=='test')fail('grant_unavailable');
 const row=(await client.query('SELECT * FROM installations WHERE id=$1 FOR SHARE',[installationId])).rows[0];
 if(!row||row.venue_id!==candidate.venue_id||row.revoked_at||row.superseded_by)fail('grant_unavailable');
 return {...row,...venue};
}
function liveInstallation(row:InstallationRow,time:number){if(!row.lease_expires_at||row.lease_expires_at.getTime()<=time)fail('grant_unavailable');}

/** Internal local-proof core. No HTTP caller or production verifier is installed. */
export class RelayGrantStore {
 readonly #pool:Pool;readonly #config:RelayConfig|undefined;
 constructor(pool:Pool,config?:RelayConfig){
  this.#pool=pool;
  if(config!==undefined){
   const p=config?.policy;
   if(config?.mode!=='local-proof'||typeof config.consentVersion!=='string'||!version.test(config.consentVersion)||typeof config.verifyOrigin!=='function'
    ||!p||typeof p.version!=='string'||!version.test(p.version)||!Number.isSafeInteger(p.units)||p.units<1||p.units>1_000_000
    ||!Number.isSafeInteger(p.periodSeconds)||p.periodSeconds<1||p.periodSeconds>366*86400||!date(p.epoch)||p.excess!=='refuse'||p.debit!=='retain')fail('invalid_input');
   this.#config={...config,policy:{...p}};
  }
 }
 #configured():RelayConfig{if(!this.#config)fail('relay_disabled');return this.#config;}
 async approve(token:string,csrfToken:string,input:RelayApproval):Promise<RelayGrant>{
  const config=this.#configured();
  if(!exact(input,['installationId','expectedRevision','consent','consentVersion','managementOrigin','expiresAt'])||!id(input.installationId)
   ||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0||input.expectedRevision>=2147483647||input.consent!==true
   ||input.consentVersion!==config.consentVersion||!canonicalOrigin(input.managementOrigin)||!date(input.expiresAt))fail('invalid_input');
  // Authenticate before invoking the trusted verifier; network proof runs outside database locks.
  await transaction(this.#pool,async client=>{const actor=await session(client,token,csrfToken);await account(client,actor.accountId);await authority(client,actor.accountId,input.installationId);});
  const challenge={installationId:input.installationId,managementOrigin:input.managementOrigin,challenge:randomUUID()};
  let evidence:OriginEvidence;
  try{evidence=await config.verifyOrigin({...challenge});}catch{return fail('origin_unverified');}
  if(!evidence||evidence.installationId!==challenge.installationId||evidence.managementOrigin!==challenge.managementOrigin||evidence.challenge!==challenge.challenge
   ||evidence.domainControl!==true||evidence.httpsEndpoint!==true||!date(evidence.expiresAt))fail('origin_unverified');
  return transaction(this.#pool,async client=>{
   const actor=await session(client,token,csrfToken);await account(client,actor.accountId);const installation=await authority(client,actor.accountId,input.installationId);
   // Serialize first approval too; there is no grant row to lock until it is created.
   await client.query("SELECT pg_advisory_xact_lock(hashtextextended('relay-grant:'||$1,0))",[installation.id]);
   const prior=(await client.query<GrantRow>('SELECT * FROM relay_grants WHERE installation_id=$1 FOR UPDATE',[installation.id])).rows[0];
   if((prior?.revision??0)!==input.expectedRevision)fail('grant_conflict');
   const time=await now(client);liveInstallation(installation,time);
   if(Date.parse(evidence.expiresAt)<=time||Date.parse(evidence.expiresAt)<Date.parse(input.expiresAt))fail('origin_unverified');
   if(Date.parse(input.expiresAt)<=time)fail('invalid_input');
   const g=(await client.query<GrantRow>(`INSERT INTO relay_grants
    (id,installation_id,account_id,organisation_id,venue_id,environment,public_key,management_origin,consent_version,revision,expires_at,origin_verified_until,enabled)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10,$11,true)
    ON CONFLICT(installation_id) DO UPDATE SET account_id=excluded.account_id,organisation_id=excluded.organisation_id,
    venue_id=excluded.venue_id,environment=excluded.environment,public_key=excluded.public_key,management_origin=excluded.management_origin,
    consent_version=excluded.consent_version,revision=relay_grants.revision+1,expires_at=excluded.expires_at,origin_verified_until=excluded.origin_verified_until,enabled=true,revoked_at=NULL
    RETURNING *`,[randomUUID(),installation.id,actor.accountId,installation.organisation_id,installation.venue_id,installation.environment,installation.public_key,input.managementOrigin,input.consentVersion,input.expiresAt,evidence.expiresAt])).rows[0]!;
   await session(client,token,csrfToken);return view(g);
  });
 }
 async revoke(token:string,csrfToken:string,grantId:string):Promise<void>{
  if(!id(grantId))fail('invalid_input');
  await transaction(this.#pool,async client=>{
   const actor=await session(client,token,csrfToken);
   const candidate=(await client.query<GrantRow>('SELECT * FROM relay_grants WHERE id=$1',[grantId])).rows[0];
   if(!candidate)fail('grant_unavailable');
   // Current owners can revoke even after the consenting owner or installation is disabled.
   if(!(await client.query('SELECT account_id FROM organisation_memberships WHERE account_id=$1 AND organisation_id=$2 AND is_owner FOR SHARE',[actor.accountId,candidate.organisation_id])).rowCount)fail('grant_unavailable');
   await client.query('UPDATE relay_grants SET enabled=false,revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE id=$1',[grantId]);
   await session(client,token,csrfToken);
  });
 }

 /** Call inside a transaction; the caller authenticates this installation, never the message body. */
 async reserve(client:PoolClient,authenticated:RelayInstallation,input:RelayReservationInput):Promise<RelayReservation>{
  const config=this.#configured();
  if(!exact(authenticated,['installationId','publicKey'])||!id(authenticated.installationId)||typeof authenticated.publicKey!=='string'
   ||!exact(input,['grantId','grantRevision','messageId','binding'])||!id(input.grantId)||!id(input.messageId)
   ||!Number.isSafeInteger(input.grantRevision)||input.grantRevision<1||typeof input.binding!=='string'||!input.binding.length||input.binding.length>256)fail('invalid_input');
  // A PoolClient also works in autocommit, where transaction locks would immediately disappear.
  try{await client.query('SAVEPOINT relay_reservation_transaction');}
  catch(error){if((error as {code?:string})?.code==='25P01')fail('transaction_required');throw error;}
  await client.query('RELEASE SAVEPOINT relay_reservation_transaction');
  const candidate=(await client.query<GrantRow>('SELECT * FROM relay_grants WHERE id=$1 AND installation_id=$2',[input.grantId,authenticated.installationId])).rows[0];
  if(!candidate)fail('grant_unavailable');
  await account(client,candidate.account_id);
  const installation=await authority(client,candidate.account_id,authenticated.installationId);
  const grant=(await client.query<GrantRow>('SELECT * FROM relay_grants WHERE id=$1 FOR SHARE',[candidate.id])).rows[0];
  if(!grant||grant.account_id!==candidate.account_id||grant.installation_id!==installation.id||grant.venue_id!==installation.venue_id
   ||grant.organisation_id!==installation.organisation_id||grant.environment!==installation.environment||grant.public_key!==installation.public_key
   ||authenticated.publicKey!==installation.public_key||grant.revision!==input.grantRevision||!grant.enabled||grant.revoked_at
   ||grant.consent_version!==config.consentVersion)fail('grant_unavailable');
  // An account-wide turn covers every installation and the empty first period as well as retries.
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('relay-account:'||$1,0))",[grant.account_id]);
  const policy=config.policy;
  await client.query('INSERT INTO relay_policies(version,definition) VALUES($1,$2) ON CONFLICT DO NOTHING',[policy.version,policy]);
  const matches=(await client.query('SELECT version FROM relay_policies WHERE version=$1 AND definition=$2::jsonb FOR SHARE',[policy.version,policy])).rowCount;
  if(!matches)fail('policy_conflict');
  await client.query('INSERT INTO relay_account_policies(account_id,policy_version) VALUES($1,$2) ON CONFLICT DO NOTHING',[grant.account_id,policy.version]);
  if(!(await client.query('SELECT account_id FROM relay_account_policies WHERE account_id=$1 AND policy_version=$2 FOR SHARE',[grant.account_id,policy.version])).rowCount)fail('policy_conflict');
  // Policy rows can wait on another account; deadlines and periods use time after every lock.
  const time=await now(client);liveInstallation(installation,time);
  if(grant.expires_at.getTime()<=time||grant.origin_verified_until.getTime()<=time)fail('grant_unavailable');
  const prior=(await client.query<ReservationRow>('SELECT * FROM relay_reservations WHERE installation_id=$1 AND message_id=$2',[installation.id,input.messageId])).rows[0];
  if(prior){
   if(prior.binding!==input.binding||prior.grant_id!==grant.id||prior.grant_revision!==grant.revision||prior.account_id!==grant.account_id)fail('message_conflict');
   return reservationView(prior,true);
  }
  const epoch=Date.parse(policy.epoch),duration=policy.periodSeconds*1000;
  if(time<epoch)fail('policy_conflict');
  const start=epoch+Math.floor((time-epoch)/duration)*duration;
  const used=Number((await client.query('SELECT count(*) FROM relay_reservations WHERE account_id=$1 AND period_start=$2',[grant.account_id,new Date(start)])).rows[0].count);
  if(used>=policy.units)fail('allowance_exhausted');
  const saved=(await client.query<ReservationRow>(`INSERT INTO relay_reservations
   (installation_id,message_id,grant_id,grant_revision,account_id,policy_version,period_start,period_end,binding)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
   [installation.id,input.messageId,grant.id,grant.revision,grant.account_id,policy.version,new Date(start),new Date(start+duration),input.binding])).rows[0]!;
  return reservationView(saved,false);
 }

}


export interface RelayInstallation {installationId:string;publicKey:string}
export interface RelayReservationInput {grantId:string;grantRevision:number;messageId:string;binding:string}
export interface RelayReservation {accountId:string;messageId:string;policyVersion:string;periodStart:string;periodEnd:string;replay:boolean}
interface ReservationRow {account_id:string;message_id:string;policy_version:string;period_start:Date;period_end:Date;binding:string;grant_id:string;grant_revision:number}
function reservationView(r:ReservationRow,replay:boolean):RelayReservation{return {accountId:r.account_id,messageId:r.message_id,policyVersion:r.policy_version,periodStart:r.period_start.toISOString(),periodEnd:r.period_end.toISOString(),replay};}
