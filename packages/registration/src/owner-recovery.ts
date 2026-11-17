import {markAccountActionProof} from './account-action-proof.ts';
import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {createSession,hashSecret,withEnrollmentPolicy,type SessionCredentials} from '@waitron-cloud/identity';
import {transaction} from './transaction.ts';
import {cancelOwnerTransfers} from './owner-transfer.ts';
import {validLocale,validNewPassword,type AccountLocale} from './account-input.ts';
import {screenPassword,type PasswordScreeningProvider} from './compromised-passwords.ts';
import type {EmailOutbox} from './email-outbox.ts';
import {InstallationStore} from './installations.ts';
import {InstallationError,readMachineClaims,verifyMachine,verifyLease,createLeaseTrust,type LeaseIssuer,type MachineAction} from './installation-proof.ts';
export interface OwnerRecoveryBinding {requestId:string;accountId:string;email:string;organisationId:string;legalBusinessId:string;venueId:string;installationId:string;publicKey:string;environment:string;countryCode:string;expiresAt:string}
type Options={origin:string;countryCode:string;issuer:LeaseIssuer;trusted?:ReadonlyMap<string,string>;screening?:PasswordScreeningProvider};
type RequestRow={token_hash:string;account_id:string;email:string;password_fingerprint:string;expires_at:Date;consumed_at:Date|null;purpose:string;recovery_id:string|null;mailbox_proven_at:Date|null;recovery_binding:OwnerRecoveryBinding|null;recovery_decision:'approved'|'refused'|null;recovery_decision_digest:string|null;recovery_decision_result:{result:{requestId:string;state:'approved'|'refused'};envelope:unknown;verifiedAt:number}|null};
export class OwnerRecoveryError extends Error {
 readonly code:'recovery_unavailable'|'recovery_scope_limited'|'recovery_invalid'|'password_compromised'|'password_screening_unavailable';
 constructor(code:OwnerRecoveryError['code']='recovery_unavailable'){super(code);this.name='OwnerRecoveryError';this.code=code;}
}
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const uuid=(s:unknown):s is string=>typeof s==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(s);
const unavailable=():never=>{throw new OwnerRecoveryError();};
const invalid=():never=>{throw new InstallationError('invalid_proof');};
const time=async(client:PoolClient):Promise<number>=>(await client.query('SELECT clock_timestamp() AS now')).rows[0].now.getTime();
function ordered(r:OwnerRecoveryBinding):OwnerRecoveryBinding {
 return {requestId:r.requestId,accountId:r.accountId,email:r.email,organisationId:r.organisationId,legalBusinessId:r.legalBusinessId,venueId:r.venueId,installationId:r.installationId,publicKey:r.publicKey,environment:r.environment,countryCode:r.countryCode,expiresAt:r.expiresAt};
}
async function scope(client:PoolClient,accountId:string,organisationId:string){
 const row=(await client.query('SELECT recovery_organisation_id FROM cloud_accounts WHERE id=$1',[accountId])).rows[0];
 if(row.recovery_organisation_id&&row.recovery_organisation_id!==organisationId)throw new OwnerRecoveryError('recovery_scope_limited');
}
async function lockRequest(client:PoolClient,selector:'token_hash'|'recovery_id',value:string):Promise<RequestRow>{
 const candidate=(await client.query(`SELECT account_id FROM password_reset_requests WHERE ${selector}=$1`,[value])).rows[0];
 if(!candidate?.account_id)unavailable();
 if(!(await client.query('SELECT id FROM cloud_accounts WHERE id=$1 AND disabled_at IS NULL FOR UPDATE',[candidate.account_id])).rowCount)unavailable();
 const credential=(await client.query('SELECT * FROM cloud_credentials WHERE account_id=$1 FOR UPDATE',[candidate.account_id])).rows[0];
 const row:RequestRow=(await client.query(`SELECT * FROM password_reset_requests WHERE ${selector}=$1 FOR UPDATE`,[value])).rows[0];
 if(!row||row.account_id!==candidate.account_id||row.consumed_at||row.expires_at.getTime()<=await time(client)||!credential?.email_verified_at
   ||credential.email!==row.email||!credential.password_hash||digest(credential.password_hash)!==row.password_fingerprint)unavailable();
 return row;
}
async function binding(client:PoolClient,row:RequestRow,installationId:string,countryCode:string):Promise<OwnerRecoveryBinding>{
 const initial=(await client.query('SELECT v.organisation_id FROM installations i JOIN venues v ON v.id=i.venue_id WHERE i.id=$1',[installationId])).rows[0];
 if(!initial)unavailable();await scope(client,row.account_id,initial.organisation_id);
 await client.query('SELECT id FROM organisations WHERE id=$1 FOR SHARE',[initial.organisation_id]);
 const current=(await client.query(`SELECT v.id AS venue_id,v.organisation_id,v.legal_business_id,v.environment,b.country_code,i.id AS installation_id,i.public_key
  FROM organisation_memberships m JOIN venues v ON v.organisation_id=m.organisation_id
  JOIN legal_businesses b ON b.id=v.legal_business_id AND b.organisation_id=v.organisation_id JOIN installations i ON i.venue_id=v.id
  WHERE m.account_id=$1 AND m.is_owner AND i.id=$2 AND i.revoked_at IS NULL AND i.superseded_by IS NULL AND b.country_code=$3
  FOR SHARE OF m,v,b,i`,[row.account_id,installationId,countryCode])).rows[0];
 if(!current||current.organisation_id!==initial.organisation_id)unavailable();
 return {requestId:row.recovery_id!,accountId:row.account_id,email:row.email,organisationId:current.organisation_id,legalBusinessId:current.legal_business_id,
  venueId:current.venue_id,installationId:current.installation_id,publicKey:current.public_key,environment:current.environment,countryCode:current.country_code,expiresAt:row.expires_at.toISOString()};
}
function recovery(row:RequestRow){if(row.purpose!=='owner_recovery'||!row.mailbox_proven_at||!row.recovery_id)unavailable();}
async function currentBinding(client:PoolClient,row:RequestRow,countryCode:string){
 recovery(row);if(!row.recovery_binding)unavailable();
 const current=await binding(client,row,row.recovery_binding!.installationId,countryCode);
 if(JSON.stringify(current)!==JSON.stringify(ordered(row.recovery_binding!)))unavailable();return current;
}
/** Mailbox proof and a verified current-box decision never replace the sole-owner membership. */
export class OwnerRecoveryStore {
 readonly #pool:Pool;readonly #outbox:EmailOutbox;readonly #options:Options;readonly #trusted:ReadonlyMap<string,string>;
 constructor(pool:Pool,outbox:EmailOutbox,options:Options){this.#pool=pool;this.#outbox=outbox;this.#options=options;this.#trusted=options.trusted??createLeaseTrust(options.issuer);}
 async begin(token:string){
  this.#token(token);
  return transaction(this.#pool,async client=>{
   let row=await lockRequest(client,'token_hash',digest(token));
   if(row.purpose==='password_reset')row=(await client.query("UPDATE password_reset_requests SET purpose='owner_recovery',recovery_id=$2,mailbox_proven_at=clock_timestamp() WHERE token_hash=$1 RETURNING *",[row.token_hash,randomUUID()])).rows[0];
   recovery(row);
   const venues=(await client.query(`SELECT i.id AS "installationId",v.id AS "venueId",o.name AS "organisationName",b.name AS "businessName"
    FROM organisation_memberships m JOIN organisations o ON o.id=m.organisation_id JOIN legal_businesses b ON b.organisation_id=o.id
    JOIN venues v ON v.organisation_id=o.id AND v.legal_business_id=b.id JOIN installations i ON i.venue_id=v.id
    JOIN cloud_accounts a ON a.id=m.account_id
    WHERE m.account_id=$1 AND m.is_owner AND i.revoked_at IS NULL AND i.superseded_by IS NULL AND b.country_code=$2
    AND (a.recovery_organisation_id IS NULL OR a.recovery_organisation_id=m.organisation_id) ORDER BY o.name,b.name,v.id`,[row.account_id,this.#options.countryCode])).rows;
   return {requestId:row.recovery_id!,state:row.recovery_decision??(row.recovery_binding?'pending':'choose'),venues,...(row.recovery_binding?{request:ordered(row.recovery_binding)}:{})};
  });
 }
 async select(token:string,installationId:string):Promise<OwnerRecoveryBinding>{
  this.#token(token);if(!uuid(installationId))unavailable();
  return transaction(this.#pool,async client=>{
   const row=await lockRequest(client,'token_hash',digest(token));recovery(row);
   const selected=await binding(client,row,installationId,this.#options.countryCode);
   if(row.recovery_binding&&JSON.stringify(ordered(row.recovery_binding))!==JSON.stringify(selected))unavailable();
   if(row.recovery_decision==='refused')unavailable();
   await client.query('UPDATE password_reset_requests SET recovery_binding=$2 WHERE token_hash=$1',[row.token_hash,selected]);
   if(row.expires_at.getTime()<=await time(client))unavailable();return selected;
  });
 }
 async status(token:string){
  this.#token(token);return transaction(this.#pool,async client=>{
   const row=await lockRequest(client,'token_hash',digest(token));recovery(row);
   if(row.recovery_binding)await currentBinding(client,row,this.#options.countryCode);
   return {requestId:row.recovery_id!,state:row.recovery_decision??(row.recovery_binding?'pending':'choose')};
  });
 }
 authenticate(action:MachineAction,envelope:unknown){return new InstallationStore(this.#pool,this.#options.issuer,this.#options.origin,this.#trusted).authenticate(action,envelope);}
 async #machineProof(client:PoolClient,action:MachineAction,envelope:unknown,verifiedAt?:number){
  const routing=readMachineClaims(envelope);
  const row=(await client.query('SELECT i.*,v.environment FROM installations i JOIN venues v ON v.id=i.venue_id WHERE i.id=$1 AND i.revoked_at IS NULL AND i.superseded_by IS NULL FOR SHARE OF i,v',[routing.installationId])).rows[0];
  if(!row)invalid();const now=await time(client),claims=verifyMachine(envelope,row.public_key,this.#options.origin,action,verifiedAt??now);
  let lease:unknown;try{lease=JSON.parse(claims.lease);}catch{invalid();}
  if(JSON.stringify(lease)!==claims.lease)invalid();
  const l=verifyLease(lease,this.#trusted,this.#options.origin,verifiedAt??now);
  if(l.installationId!==row.id||l.venueId!==row.venue_id||l.publicKey!==row.public_key||l.environment!==row.environment)invalid();
  return claims;
 }
 async machine(action:MachineAction,envelope:unknown):Promise<unknown>{
  if(!['owner-recovery-read','owner-recovery-approve','owner-recovery-refuse'].includes(action))invalid();
  const claims=await this.authenticate(action,envelope);
  return transaction(this.#pool,async client=>{
   if(action==='owner-recovery-read'){
    if(claims.body!=='{}')invalid();
    const candidates=(await client.query(`SELECT account_id,token_hash FROM password_reset_requests WHERE purpose='owner_recovery' AND consumed_at IS NULL
     AND recovery_decision IS NULL AND expires_at>clock_timestamp() AND recovery_binding->>'installationId'=$1 ORDER BY account_id`,[claims.installationId])).rows;
    const requests:OwnerRecoveryBinding[]=[];
    for(const candidate of candidates){
     // An obsolete challenge is simply absent from this box's work list.
     await client.query('SAVEPOINT recovery_read');
     try{const row=await lockRequest(client,'token_hash',candidate.token_hash);requests.push(await currentBinding(client,row,this.#options.countryCode));}
     catch(error){if(!(error instanceof OwnerRecoveryError))throw error;await client.query('ROLLBACK TO SAVEPOINT recovery_read');}
    }
    await this.#machineProof(client,action,envelope);return {requests};
   }
   let body:{request:OwnerRecoveryBinding;approvedBy?:string;refusedBy?:string};try{body=JSON.parse(claims.body);}catch{invalid();}
   const state=action==='owner-recovery-approve'?'approved':'refused',person=state==='approved'?'approvedBy':'refusedBy';
   if(!body!?.request||!uuid(body![person])||!uuid(body!.request.requestId)||claims.operationId!==body!.request.requestId
    ||claims.body!==JSON.stringify({request:ordered(body!.request),[person]:body![person]}))invalid();
   const row=await lockRequest(client,'recovery_id',claims.operationId),request=await currentBinding(client,row,this.#options.countryCode);
   if(request.installationId!==claims.installationId||JSON.stringify(request)!==JSON.stringify(body!.request))invalid();
   await this.#machineProof(client,action,envelope);
   const decisionDigest=digest(JSON.stringify([action,claims.body]));
   if(row.recovery_decision){if(row.recovery_decision_digest!==decisionDigest)throw new InstallationError('conflict');return row.recovery_decision_result!.result;}
   const result={requestId:request.requestId,state};
   await client.query('UPDATE password_reset_requests SET recovery_decision=$2,recovery_decision_digest=$3,recovery_decision_result=$4 WHERE token_hash=$1',
    [row.token_hash,state,decisionDigest,{result,envelope,verifiedAt:await time(client)}]);
   if(row.expires_at.getTime()<=await time(client))unavailable();return result;
  });
 }
 async complete(token:string,password:string,locale:AccountLocale='en'):Promise<SessionCredentials>{
  this.#token(token);if(!validNewPassword(password)||!validLocale(locale))throw new OwnerRecoveryError('recovery_invalid');
  const screened=await screenPassword(this.#options.screening,password);
  if(screened==='compromised')throw new OwnerRecoveryError('password_compromised');
  if(screened==='unavailable')throw new OwnerRecoveryError('password_screening_unavailable');
  const passwordHash=await hashSecret(password);
  return transaction(this.#pool,async client=>{
   const row=await lockRequest(client,'token_hash',digest(token)),request=await currentBinding(client,row,this.#options.countryCode);
   if(row.recovery_decision!=='approved'||!row.recovery_decision_result)unavailable();
   const {envelope,verifiedAt}=row.recovery_decision_result!;
   const claims=await this.#machineProof(client,'owner-recovery-approve',envelope,verifiedAt);
   if(claims.operationId!==request.requestId||digest(JSON.stringify(['owner-recovery-approve',claims.body]))!==row.recovery_decision_digest)unavailable();
   await cancelOwnerTransfers(client,row.account_id,this.#outbox);
   await client.query('UPDATE cloud_credentials SET password_hash=$2 WHERE account_id=$1',[row.account_id,passwordHash]);
   await client.query('UPDATE cloud_accounts SET recovery_organisation_id=$2 WHERE id=$1',[row.account_id,request.organisationId]);
   await client.query('DELETE FROM cloud_passkeys WHERE account_id=$1',[row.account_id]);
   await client.query('UPDATE cloud_authenticator_factors SET version=version+1,secret_generation=NULL,secret_envelope=NULL WHERE account_id=$1',[row.account_id]);
   for(const table of ['cloud_factor_enrolments','cloud_factor_login_challenges','cloud_sign_in_checks','cloud_email_changes','cloud_factor_recovery_codes'])
    await client.query(`UPDATE ${table} SET consumed_at=clock_timestamp() WHERE account_id=$1 AND consumed_at IS NULL`,[row.account_id]);
   await client.query(`UPDATE cloud_webauthn_ceremonies SET consumed_at=clock_timestamp() WHERE consumed_at IS NULL AND
    (account_id=$1 OR action_session_token_hash IN(SELECT token_hash FROM cloud_sessions WHERE account_id=$1))`,[row.account_id]);
   await client.query('DELETE FROM cloud_recognised_browsers WHERE account_id=$1',[row.account_id]);
   await client.query('UPDATE cloud_sessions SET ended_at=clock_timestamp() WHERE account_id=$1 AND ended_at IS NULL',[row.account_id]);
   await client.query('UPDATE password_reset_requests SET consumed_at=clock_timestamp() WHERE account_id=$1 AND consumed_at IS NULL',[row.account_id]);
   await this.#outbox.enqueue(client,'password_changed',{email:row.email,locale});
   const session=await createSession(client,row.account_id);
   await withEnrollmentPolicy({required:true,allowEnrollment:true},()=>markAccountActionProof(client,session.token,session.csrfToken,'recovery'));
   await this.#machineProof(client,'owner-recovery-approve',envelope,verifiedAt);
   if(row.expires_at.getTime()<=await time(client))unavailable();return session;
  });
 }
 #token(token:string){if(typeof token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(token))unavailable();}
}
