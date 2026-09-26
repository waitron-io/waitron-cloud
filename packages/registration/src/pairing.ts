import {createHash,timingSafeEqual} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {resolveSession} from '@waitron-cloud/identity';
import {RegistrationStore,type ConnectionBinding,type Registration} from './index.ts';
import {transaction} from './transaction.ts';
import {isPairingUuid,PairingError,type PairingClaims} from './pairing-proof.ts';
import {recordSecurityAuditEvent} from './security-audit.ts';
interface Row {
  id:string;public_key:string;local_venue_id:string;environment:string;code_hash:string;expires_at:Date;
  failed_codes:number;cloud_account_id:string|null;organisation_id:string|null;legal_business_id:string|null;result:Registration|null;
}
export interface PairingView {
  requestId:string;localVenueId:string;environment:string;expiresAt:string;
  state:'awaiting_cloud'|'awaiting_local'|'complete';organisationId?:string;legalBusinessId?:string;
  organisationName?:string;legalBusinessName?:string;registration?:Registration;
}
const digest=(code:string)=>createHash('sha256').update(code).digest('hex');
function machineBinding(row:Row,c:PairingClaims) {
  if(row.public_key!==c.publicKey||row.local_venue_id!==c.localVenueId||row.environment!==c.environment)throw new PairingError('binding_conflict');
}
async function lock(client:PoolClient,id:string):Promise<Row> {
  if(!isPairingUuid(id))throw new PairingError('pairing_unavailable');
  const row=(await client.query<Row>('SELECT * FROM pairing_requests WHERE id=$1 FOR UPDATE',[id])).rows[0];
  if(!row)throw new PairingError('pairing_unavailable');return row;
}
async function available(client:PoolClient,row:Row) {
  if(row.result) {
    if(!(await client.query('SELECT id FROM installations WHERE id=$1 AND revoked_at IS NULL FOR SHARE',[row.result.installationId])).rowCount)throw new PairingError('pairing_unavailable');
  }else if(row.failed_codes>=5||!(await client.query('SELECT expires_at>clock_timestamp() AS valid FROM pairing_requests WHERE id=$1',[row.id])).rows[0]?.valid)throw new PairingError('pairing_unavailable');
}
async function view(client:PoolClient,row:Row):Promise<PairingView> {
  const result:PairingView={requestId:row.id,localVenueId:row.local_venue_id,environment:row.environment,expiresAt:row.expires_at.toISOString(),state:row.result?'complete':row.cloud_account_id?'awaiting_local':'awaiting_cloud'};
  if(row.organisation_id&&row.legal_business_id) {
    const names=(await client.query('SELECT o.name AS organisation, b.name AS business FROM organisations o JOIN legal_businesses b ON b.organisation_id=o.id WHERE o.id=$1 AND b.id=$2',[row.organisation_id,row.legal_business_id])).rows[0];
    if(typeof names?.organisation!=='string'||!names.organisation.trim()||typeof names?.business!=='string'||!names.business.trim())throw new PairingError('pairing_unavailable');
    result.organisationId=row.organisation_id;result.legalBusinessId=row.legal_business_id;
    result.organisationName=names.organisation;result.legalBusinessName=names.business;
  }
  if(row.result)result.registration=row.result;return result;
}
async function permission(client:PoolClient,account:string,org:string,business:string) {
  if(!isPairingUuid(org)||!isPairingUuid(business))throw new PairingError('permission_denied');
  const result=await client.query(`SELECT m.account_id FROM organisation_memberships m JOIN cloud_accounts a ON a.id=m.account_id
    JOIN legal_businesses b ON b.organisation_id=m.organisation_id
    WHERE m.account_id=$1 AND m.organisation_id=$2 AND b.id=$3 AND m.can_register_venues AND a.disabled_at IS NULL FOR SHARE OF m,a,b`,[account,org,business]);
  if(!result.rowCount)throw new PairingError('permission_denied');
}
/** Machine entry points accept claims only after verifyPairingProof succeeds. */
export class PairingStore {
  readonly #pool:Pool;
  constructor(pool:Pool){this.#pool=pool;}
  async start(c:PairingClaims):Promise<PairingView> {
    return transaction(this.#pool,async client=>{
      await client.query(`INSERT INTO pairing_requests(id,public_key,local_venue_id,environment,code_hash) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(id) DO NOTHING`,[c.requestId,c.publicKey,c.localVenueId,c.environment,digest(c.code)]);
      const row=await lock(client,c.requestId);machineBinding(row,c);
      if(row.code_hash!==digest(c.code))throw new PairingError('binding_conflict');
      await available(client,row);return view(client,row);
    });
  }
  async status(c:PairingClaims):Promise<PairingView> {
    return transaction(this.#pool,async client=>{const row=await lock(client,c.requestId);machineBinding(row,c);await available(client,row);return view(client,row);});
  }
  async businesses(token:string) {
    return transaction(this.#pool,async client=>{
      const session=await resolveSession(client,token,{touch:false});
      const result=await client.query(`SELECT o.id AS "organisationId",o.name AS "organisationName",b.id AS "legalBusinessId",
        b.name AS "legalBusinessName",b.country_code AS "countryCode" FROM organisation_memberships m
        JOIN organisations o ON o.id=m.organisation_id JOIN legal_businesses b ON b.organisation_id=o.id
        WHERE m.account_id=$1 AND m.can_register_venues ORDER BY o.name,b.name,b.id`,[session.accountId]);
      // A plain SELECT can wait behind table maintenance past the session deadline.
      await resolveSession(client,token,{touch:false});return result.rows;
    });
  }
  async #browser(id:string,code:string,token:string,csrf:string,choice?:{org:string;business:string}):Promise<PairingView> {
    const result=await transaction(this.#pool,async client=>{
      const row=await lock(client,id);const session=await resolveSession(client,token,{csrfToken:csrf,touch:false});
      if(row.failed_codes>=5)throw new PairingError('pairing_unavailable');
      await available(client,row);
      if(typeof code!=='string'||!/^\d{8}$/.test(code)||!timingSafeEqual(Buffer.from(digest(code),'hex'),Buffer.from(row.code_hash,'hex'))) {
        await client.query('UPDATE pairing_requests SET failed_codes=LEAST(5,failed_codes+1) WHERE id=$1',[id]);
        return null;
      }
      if(row.cloud_account_id&&row.cloud_account_id!==session.accountId)throw new PairingError('permission_denied');
      if(choice) {
        if(row.organisation_id&&(row.organisation_id!==choice.org||row.legal_business_id!==choice.business))throw new PairingError('binding_conflict');
        await permission(client,session.accountId,choice.org,choice.business);
        await available(client,row);
        await client.query('UPDATE pairing_requests SET cloud_account_id=$2,organisation_id=$3,legal_business_id=$4 WHERE id=$1',[id,session.accountId,choice.org,choice.business]);
        row.cloud_account_id=session.accountId;row.organisation_id=choice.org;row.legal_business_id=choice.business;
        await recordSecurityAuditEvent(client,{organisationId:choice.org,venueId:null,type:'pairing.cloud_approved',actorKind:'account',actorId:session.accountId,subjectKind:'pairing_request',subjectId:row.id,sourceId:row.id});
      }
      await resolveSession(client,token,{csrfToken:csrf,touch:false});return view(client,row);
    });
    // Commit the failed-code count before returning the refusal to the caller.
    if(!result)throw new PairingError('pairing_unavailable');return result;
  }
  inspect(id:string,code:string,token:string,csrf:string){return this.#browser(id,code,token,csrf);}
  approve(id:string,code:string,org:string,business:string,token:string,csrf:string){return this.#browser(id,code,token,csrf,{org,business});}
  async complete(c:PairingClaims):Promise<PairingView> {
    return transaction(this.#pool,async client=>{
      const row=await lock(client,c.requestId);machineBinding(row,c);await available(client,row);
      if(!row.cloud_account_id)throw new PairingError('approval_required');
      if(row.organisation_id!==c.organisationId||row.legal_business_id!==c.legalBusinessId)throw new PairingError('binding_conflict');
      if(row.result)return view(client,row);
      await permission(client,row.cloud_account_id,c.organisationId,c.legalBusinessId);
      await available(client,row);
      const binding:ConnectionBinding={operationId:row.id,installationKey:row.public_key,localVenueId:row.local_venue_id,environment:row.environment,organisationId:c.organisationId,legalBusinessId:c.legalBusinessId};
      const registration=new RegistrationStore(this.#pool,client);
      await registration.start(binding);await registration.approveLocal(binding,row.id);await registration.approveCloud(binding,row.cloud_account_id);
      const registered=await registration.complete(binding);
      await recordSecurityAuditEvent(client,{organisationId:row.organisation_id,venueId:registered.venueId,type:'pairing.local_approved',actorKind:'local_authority',actorId:row.id,subjectKind:'pairing_request',subjectId:row.id,sourceId:row.id});
      await available(client,row);
      await client.query('UPDATE pairing_requests SET result=$2 WHERE id=$1',[row.id,registered]);row.result=registered;
      return view(client,row);
    });
  }
}
