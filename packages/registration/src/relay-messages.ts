import type {Pool} from 'pg';
import {InstallationStore} from './installations.ts';
import {createLeaseTrust,InstallationError,verifyLease,verifyMachine,type LeaseIssuer} from './installation-proof.ts';
import {RelayGrantStore,type RelayConfig} from './relay-grants.ts';
import {RelayKeys,relayBody,messageError,type RelayBody,type RelayKeyConfig,type RelayPayloadBinding} from './relay-payload.ts';
import {transaction} from './transaction.ts';
export type RelayAction='email-submit'|'email-status'|'email-cancel';
export interface RelayAdmissionConfig {mode:'local-proof';grants:RelayConfig;payloadKeys:RelayKeyConfig;replayKeys:RelayKeyConfig}
interface MessageRow extends RelayPayloadBinding {binding:string;replay_key_id:string;payload:Buffer|null;state:string;status_revision:number;reason:string|null;expires_at:Date}
function view(row:MessageRow){return {version:1,messageId:row.message_id,state:row.state,statusRevision:row.status_revision,expiresAt:row.expires_at.toISOString(),reason:row.reason};}
/** No worker is connected to this separately configured local-proof queue. */
export class RelayMessages {
 readonly #pool:Pool;readonly #origin:string;readonly #trusted:ReadonlyMap<string,string>;readonly #installations:InstallationStore;
 readonly #grants:RelayGrantStore;readonly #payload:RelayKeys;readonly #replay:RelayKeys;
 constructor(pool:Pool,issuer:LeaseIssuer,origin:string,config:RelayAdmissionConfig,trusted=createLeaseTrust(issuer)){
  if(config?.mode!=='local-proof')messageError('relay_unavailable');
  this.#pool=pool;this.#origin=origin;this.#trusted=trusted;this.#installations=new InstallationStore(pool,issuer,origin,trusted);
  this.#grants=new RelayGrantStore(pool,config.grants);this.#payload=new RelayKeys(config.payloadKeys);this.#replay=new RelayKeys(config.replayKeys);
 }
 authenticate(action:RelayAction,envelope:unknown){return this.#installations.authenticate(action,envelope);}
 async execute(action:RelayAction,envelope:unknown){
  if(!['email-submit','email-status','email-cancel'].includes(action))throw new InstallationError('invalid_proof');
  const claims=await this.authenticate(action,envelope),body=relayBody(claims.body,action==='email-submit');
  if(action==='email-submit'&&claims.operationId!==body.messageId)messageError('invalid_message');
  return transaction(this.#pool,async client=>{
   // Serialize the missing row as well as replays before taking D45's authority/allowance locks.
   await client.query("SELECT pg_advisory_xact_lock(hashtextextended('relay-message:'||$1||':'||$2,0))",[claims.installationId,body.messageId]);
   let row=(await client.query<MessageRow>('SELECT * FROM relay_messages WHERE installation_id=$1 AND message_id=$2',[claims.installationId,body.messageId])).rows[0];
   if(action!=='email-submit'&&!row)messageError('grant_unavailable');
   const submitted=body as RelayBody;
   const grantId=action==='email-submit'?submitted.grantId:row!.grant_id,revision=action==='email-submit'?submitted.grantRevision:row!.grant_revision;
   const current=(await client.query('SELECT public_key FROM installations WHERE id=$1',[claims.installationId])).rows[0];
   if(!current)throw new InstallationError('invalid_proof');
   // Status/cancel reuse the stored reservation and never mint an allowance unit.
   const replayKey=row?.replay_key_id??this.#replay.active;
   const binding=action==='email-submit'?this.#replay.fingerprint(replayKey,claims.installationId,body.messageId,claims.body):row!.binding;
   const reservation=await this.#grants.reserve(client,{installationId:claims.installationId,publicKey:current.public_key},{grantId,grantRevision:revision,messageId:body.messageId,binding});
   // reserve holds account, membership, venue, installation and grant locks through this commit.
   const installation=(await client.query('SELECT i.*,v.environment FROM installations i JOIN venues v ON v.id=i.venue_id WHERE i.id=$1',[claims.installationId])).rows[0];
   const now=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now.getTime();
   verifyMachine(envelope,installation.public_key,this.#origin,action,now);
   let encoded:unknown;try{encoded=JSON.parse(claims.lease);}catch{throw new InstallationError('invalid_proof');}
   if(JSON.stringify(encoded)!==claims.lease)throw new InstallationError('invalid_proof');
   const lease=verifyLease(encoded,this.#trusted,this.#origin,now);
   if(lease.installationId!==installation.id||lease.venueId!==installation.venue_id||lease.environment!==installation.environment||lease.publicKey!==installation.public_key)throw new InstallationError('invalid_proof');
   let created=false;
   if(!row){
    if(reservation.replay)messageError('relay_unavailable');
    const expiry=Math.min(Date.parse(submitted.expiresAt),submitted.codeExpiresAt?Date.parse(submitted.codeExpiresAt):Infinity);
    if(expiry<=now||Date.parse(submitted.expiresAt)>now+86400000||(submitted.codeExpiresAt&&Date.parse(submitted.codeExpiresAt)>now+86400000))messageError('invalid_message');
    const grant=(await client.query('SELECT management_origin FROM relay_grants WHERE id=$1',[grantId])).rows[0];
    const metadata={installation_id:claims.installationId,message_id:body.messageId,grant_id:grantId,grant_revision:revision,class:submitted.class,key_id:this.#payload.active};
    const encrypted=this.#payload.seal(metadata,{...submitted,managementOrigin:grant.management_origin});
    row=(await client.query<MessageRow>(`INSERT INTO relay_messages(installation_id,message_id,grant_id,grant_revision,class,binding,replay_key_id,key_id,payload,expires_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[metadata.installation_id,metadata.message_id,grantId,revision,submitted.class,binding,replayKey,metadata.key_id,encrypted,new Date(expiry)])).rows[0]!;
    created=true;
   }else if(!reservation.replay)messageError('relay_unavailable');
   if(row.state==='queued'&&(row.expires_at.getTime()<=now||action==='email-cancel')){
    const state=row.expires_at.getTime()<=now?'expired':'cancelled';
    row=(await client.query<MessageRow>(`UPDATE relay_messages SET state=$3,reason=$3,payload=NULL,status_revision=status_revision+1 WHERE installation_id=$1 AND message_id=$2 RETURNING *`,[claims.installationId,body.messageId,state])).rows[0]!;
   }
   if(row.payload)this.#payload.open({...row,payload:row.payload});
   return {created,status:view(row)};
  });
 }
}
