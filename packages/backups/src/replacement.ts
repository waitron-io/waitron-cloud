import {randomUUID,verify} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {resolveSession} from '@waitron-cloud/identity';
import {transaction} from '@waitron-cloud/registration';
import {decode,publicKey,type Proof} from './recovery.ts';
import {backupFail,lockVenue,uuid} from './catalogue.ts';
import type {BackupKeyVault} from './keys.ts';
export interface ReplacementClaims {id:string;localVenueId:string;nodeId:string;publicKey:string;peerPublicKey:string;issuedAt?:number;}
export interface ReplacementEnvelope extends Proof {id:string;keySignature:string;}
export function replacementPayload(origin:string,action:'prepare'|'status',c:ReplacementClaims,issuedAt:number){return Buffer.from(JSON.stringify(['waitron-cloud-replacement-v1',origin,c.id,action,c.localVenueId,c.nodeId,'test',c.publicKey,c.peerPublicKey,issuedAt]));}
function claims(origin:string,action:'prepare'|'status',envelope:ReplacementEnvelope):ReplacementClaims {
 try{
  if(!envelope||!uuid(envelope.id)||!['prepare','status'].includes(action))throw Error();
  const bytes=decode(envelope.payload,4096),v:unknown=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes));
  if(!Array.isArray(v)||v.length!==10||!uuid(v[4])||!uuid(v[5])||typeof v[7]!=='string'||typeof v[8]!=='string'||!Number.isSafeInteger(v[9])||Math.abs(Date.now()-v[9])>60000)throw Error();
  const c={id:envelope.id,localVenueId:v[4],nodeId:v[5],publicKey:v[7],peerPublicKey:v[8],issuedAt:v[9]};
  if(!replacementPayload(origin,action,c,v[9]).equals(bytes)||!verify(null,bytes,publicKey(c.publicKey),decode(envelope.keySignature,86))||! /^[A-Za-z0-9+/]{43}=$/.test(c.peerPublicKey)||Buffer.from(c.peerPublicKey,'base64').length!==32||Buffer.from(c.peerPublicKey,'base64').toString('base64')!==c.peerPublicKey)throw Error();
  return c;
 }catch{return backupFail('invalid_proof');}
}
async function permission(client:PoolClient,account:string,venue:string){
 if(!(await client.query(`SELECT m.account_id FROM organisation_memberships m JOIN venues v ON v.organisation_id=m.organisation_id JOIN cloud_accounts a ON a.id=m.account_id WHERE m.account_id=$1 AND v.id=$2 AND m.is_owner AND a.disabled_at IS NULL FOR SHARE OF a,m`,[account,venue])).rowCount)backupFail('permission_denied');
}
async function recovery(client:PoolClient,id:string){
 const r=(await client.query(`SELECT r.*,p.source_node_id,p.kind,p.verification,p.deleting,p.deleted_at,v.local_venue_id,v.environment,v.organisation_id,v.legal_business_id,o.name AS organisation_name,b.name AS business_name
 FROM backup_recoveries r JOIN backup_points p ON p.id=r.point_id JOIN venues v ON v.id=r.venue_id JOIN organisations o ON o.id=v.organisation_id JOIN legal_businesses b ON b.id=v.legal_business_id WHERE r.id=$1`,[id])).rows[0];
 if(!r)backupFail('unavailable');if(r.environment!=='test')backupFail('local_integration_only');return r;
}
async function current(client:PoolClient,id:string){
 const r=(await client.query("SELECT r.status='restored' AND r.expires_at>clock_timestamp() AND p.kind='snapshot' AND p.verification='verified' AND NOT p.deleting AND p.deleted_at IS NULL AS valid FROM backup_recoveries r JOIN backup_points p ON p.id=r.point_id WHERE r.id=$1",[id])).rows[0];if(!r?.valid)backupFail('unavailable');
}
function bound(row:Record<string,any>,c:ReplacementClaims){if(row.public_key!==c.publicKey||row.peer_public_key!==c.peerPublicKey||row.local_venue_id!==c.localVenueId||row.node_id!==c.nodeId)backupFail('conflict');}
function view(r:Record<string,any>,p:Record<string,any>){return p.result??{requestId:r.id,pointId:r.point_id,venueId:r.venue_id,oldInstallationId:p.old_installation_id,localVenueId:p.local_venue_id,nodeId:p.node_id,environment:'test',publicKey:p.public_key,peerPublicKey:p.peer_public_key,state:'awaiting_owner',expiresAt:r.expires_at.toISOString(),organisationName:r.organisation_name,legalBusinessName:r.business_name,registration:null};}
export class ReplacementStore {
 readonly pool:Pool;readonly vault:BackupKeyVault;readonly origin:string;
 constructor(pool:Pool,vault:BackupKeyVault,origin:string){this.pool=pool;this.vault=vault;this.origin=origin;}
 async authenticate(action:'prepare'|'status',envelope:ReplacementEnvelope){
  const c=claims(this.origin,action,envelope),r=(await this.pool.query('SELECT target_public_key FROM backup_recoveries WHERE id=$1',[c.id])).rows[0];
  if(!r||!verify(null,decode(envelope.payload,4096),publicKey(r.target_public_key),decode(envelope.signature,86)))backupFail('invalid_proof');return c;
 }
 async #locked(client:PoolClient,id:string,token?:string,csrf?:string){
  // Recovery request locks precede owner/session and resource locks, as in recovery approval.
  await client.query('SELECT id FROM backup_recovery_requests WHERE id=$1 FOR UPDATE',[id]);
  const r=await recovery(client,id);
  if(token!==undefined){const s=await resolveSession(client,token,{csrfToken:csrf,touch:false});if(s.accountId!==r.account_id)backupFail('permission_denied');}
  await permission(client,r.account_id,r.venue_id);
  await client.query('SELECT id FROM venues WHERE id=$1 FOR UPDATE',[r.venue_id]);
  const old=(await client.query('SELECT * FROM installations WHERE venue_id=$1 AND superseded_by IS NULL FOR UPDATE',[r.venue_id])).rows[0];
  if(!old)backupFail('unavailable');
  const l=await lockVenue(client,r.venue_id);
  const p=(await client.query('SELECT * FROM installation_replacements WHERE id=$1 FOR UPDATE',[id])).rows[0];
  return {r,old,l,p};
 }
 async #activeResult(client:PoolClient,p:Record<string,any>){
  if(!(await client.query('SELECT id FROM installations WHERE id=$1 AND revoked_at IS NULL AND superseded_by IS NULL FOR SHARE',[p.result.registration.installationId])).rowCount)backupFail('revoked');return p.result;
 }
 async machine(action:'prepare'|'status',envelope:ReplacementEnvelope){
  const c=await this.authenticate(action,envelope);
  return transaction(this.pool,async client=>{
   const prior=(await client.query('SELECT * FROM installation_replacements WHERE id=$1',[c.id])).rows[0];
   if(prior?.result){bound(prior,c);const result=await this.#activeResult(client,prior);claims(this.origin,action,envelope);return result;}
   const {r,old,l,p}=await this.#locked(client,c.id);
   if(r.local_venue_id!==c.localVenueId||r.source_node_id!==c.nodeId)backupFail('conflict');
   if(p?.result){bound(p,c);const result=await this.#activeResult(client,p);claims(this.origin,action,envelope);return result;}
   await current(client,c.id);
   if(r.kind!=='snapshot'||r.verification!=='verified'||r.deleting||r.deleted_at)backupFail('unavailable');
   if(l.installation_id!==old.id)backupFail('conflict');
   if(p){bound(p,c);claims(this.origin,action,envelope);return view(r,p);}
   if(action!=='prepare')backupFail('unavailable');
   if(c.publicKey===r.target_public_key||(await client.query('SELECT 1 FROM installations WHERE public_key=$1 UNION ALL SELECT 1 FROM backup_recoveries WHERE target_public_key=$1 UNION ALL SELECT 1 FROM backup_recovery_requests WHERE public_key=$1',[c.publicKey])).rowCount)backupFail('target_not_fresh');
   if((await client.query('SELECT 1 FROM remote_placements WHERE peer_public_key=$1 UNION ALL SELECT 1 FROM installation_replacements WHERE peer_public_key=$1 OR old_peer_public_key=$1',[c.peerPublicKey])).rowCount)backupFail('target_not_fresh');
   const remote=(await client.query('SELECT peer_public_key FROM remote_placements WHERE venue_id=$1',[r.venue_id])).rows[0];
   const saved=(await client.query(`INSERT INTO installation_replacements(id,venue_id,old_installation_id,public_key,peer_public_key,old_peer_public_key,local_venue_id,node_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[c.id,r.venue_id,old.id,c.publicKey,c.peerPublicKey,remote?.peer_public_key??null,c.localVenueId,c.nodeId])).rows[0];
   await current(client,c.id);claims(this.origin,action,envelope);return view(r,saved);
  }).catch(error=>{if(error?.code==='23505')backupFail('conflict');throw error;});
 }
 async inspect(id:string,token:string,csrf:string){
  if(!uuid(id))backupFail('unavailable');
  return transaction(this.pool,async client=>{
   const r=await recovery(client,id),s=await resolveSession(client,token,{csrfToken:csrf,touch:false});if(s.accountId!==r.account_id)backupFail('permission_denied');await permission(client,s.accountId,r.venue_id);
   const p=(await client.query('SELECT * FROM installation_replacements WHERE id=$1',[id])).rows[0];await resolveSession(client,token,{csrfToken:csrf,touch:false});return p?view(r,p):null;
  });
 }
 async complete(id:string,token:string,csrf:string,input:{oldInstallationId:string;oldServerUnavailable:boolean;confirmReplacement:boolean}){
  if(!uuid(id)||!uuid(input.oldInstallationId))backupFail('invalid_input');if(input.oldServerUnavailable!==true||input.confirmReplacement!==true)backupFail('confirmation_required');
  return transaction(this.pool,async client=>{
   const {r,old,l,p}=await this.#locked(client,id,token,csrf);
   if(!p)backupFail('unavailable');if(p.old_installation_id!==input.oldInstallationId)backupFail('conflict');
   if(p.result){await resolveSession(client,token,{csrfToken:csrf,touch:false});return this.#activeResult(client,p);}
   await current(client,id);if(old.id!==p.old_installation_id||l.installation_id!==old.id)backupFail('conflict');
   const installationId=randomUUID();
   await client.query('UPDATE installations SET revoked_at=COALESCE(revoked_at,clock_timestamp()),superseded_by=$2 WHERE id=$1',[old.id,installationId]);
   await client.query('INSERT INTO installations(id,venue_id,public_key,configuration_revision) VALUES($1,$2,$3,1)',[installationId,r.venue_id,p.public_key]);
   await client.query("INSERT INTO installation_services(installation_id,service) VALUES($1,'remote_access'),($1,'continuous_backup'),($1,'retained_snapshots')",[installationId]);
   const version=l.active_key_version+1;
   await client.query('INSERT INTO backup_key_versions(venue_id,version,sealed) VALUES($1,$2,$3)',[r.venue_id,version,this.vault.create(r.venue_id,version)]);
   await client.query('UPDATE backup_locations SET installation_id=$2,active_key_version=$3 WHERE venue_id=$1',[r.venue_id,installationId,version]);
   await client.query("UPDATE installation_services SET state='provisioning',configuration=$2 WHERE installation_id=$1 AND service='retained_snapshots'",[installationId,{version:1,provider:'local-s3',bucket:l.bucket}]);
   const remote=(await client.query('SELECT * FROM remote_placements WHERE venue_id=$1 FOR UPDATE',[r.venue_id])).rows[0];
   if(remote){
    if(remote.installation_id!==old.id||remote.peer_public_key!==p.old_peer_public_key)backupFail('conflict');
    await client.query('UPDATE remote_placements SET installation_id=$2,peer_public_key=$3 WHERE venue_id=$1',[r.venue_id,installationId,p.peer_public_key]);
    const config=(await client.query(`SELECT 1 AS version,p.installation_id AS "installationId",p.venue_id AS "venueId",p.cell_id AS "cellId",host(p.address) AS address,p.port,p.peer_public_key AS "peerPublicKey",c.public_key AS "gatewayPublicKey",c.endpoint,s.hostname AS "staffHostname",u.hostname AS "publicHostname" FROM remote_placements p JOIN remote_cells c ON c.id=p.cell_id JOIN remote_hostnames s ON s.venue_id=p.venue_id AND s.kind='staff' JOIN remote_hostnames u ON u.venue_id=p.venue_id AND u.kind='public' WHERE p.venue_id=$1`,[r.venue_id])).rows[0];
    await client.query("UPDATE installation_services SET state='provisioning',configuration=$2 WHERE installation_id=$1 AND service='remote_access'",[installationId,config]);
   }
   // A replacement has not contacted Cloud yet; old disconnection alerts must not describe it.
   // Monitors skip locked installations, so updating their row after this installation lock cannot cycle.
   await client.query("UPDATE venue_monitors SET checked_at=NULL,contact_since=clock_timestamp(),next_check_at=clock_timestamp() WHERE venue_id=$1",[r.venue_id]);
   await client.query("UPDATE venue_incidents SET status='suppressed',revision=revision+1,changed_at=clock_timestamp() WHERE venue_id=$1 AND kind='disconnected' AND status='open'",[r.venue_id]);
   const result={...view(r,p),state:'complete',registration:{venueId:r.venue_id,installationId,organisationId:r.organisation_id,legalBusinessId:r.legal_business_id}};
   await client.query('UPDATE installation_replacements SET result=$2,completed_at=clock_timestamp() WHERE id=$1',[id,result]);
   await current(client,id);await resolveSession(client,token,{csrfToken:csrf,touch:false});return result;
  });
 }
}
