import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {resolveSession} from '@waitron-cloud/identity';
import {transaction} from './transaction.ts';
import {isPairingUuid} from './pairing-proof.ts';
import {InstallationError,readMachineClaims,verifyMachine,verifyLease,type LeaseIssuer,type MachineAction,type SignedEnvelope} from './installation-proof.ts';
const names=['continuous_backup','remote_access','retained_snapshots'] as const;
type Service=typeof names[number];
type State='unconfigured'|'provisioning'|'ready'|'failed';
type Health='unknown'|'healthy'|'degraded'|'failed';
type Failure='unavailable'|'authentication'|'configuration'|'storage'|'capacity';
export interface DesiredService {service:Service;state:State;configuration:Record<string,unknown>}
export interface InstallationView {
  installationId:string;venueId:string;organisationId:string;legalBusinessId:string;environment:string;
  revision:number;revokedAt:string|null;lastContactAt:string|null;leaseExpiresAt:string|null;
  services:(DesiredService & {health:Health;failure:Failure|null;observedAt:string|null})[];
  lease?:SignedEnvelope;canRevoke?:boolean;
}
interface Row {id:string;venue_id:string;public_key:string;revoked_at:Date|null;configuration_revision:number;environment:'test'|'production'}
interface Report {revision:number;observedAt:number;services:{service:Service;health:Health;failure:Failure|null}[]}
function fail(code:InstallationError['code']):never {throw new InstallationError(code);}
function object(value:unknown,keys:string[]):value is Record<string,unknown> {
  return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
}
function readBody(action:MachineAction,text:string,now:number):Report|undefined {
  let v:unknown;try{v=JSON.parse(text);}catch{return fail('invalid_proof');}
  if(action!=='report'){if(text!=='{}')fail('invalid_proof');return;}
  if(!object(v,['revision','observedAt','services'])||!Number.isSafeInteger(v.revision)||Number(v.revision)<0
    ||!Number.isSafeInteger(v.observedAt)||Number(v.observedAt)<0||Number(v.observedAt)>now+60000||!Array.isArray(v.services)||v.services.length<1||v.services.length>3)fail('invalid_proof');
  const services:Report['services']=[];
  for(const s of v.services){
    if(!object(s,['service','health','failure'])||!names.includes(s.service as Service)||!['unknown','healthy','degraded','failed'].includes(String(s.health))
      ||(s.failure!==null&&!['unavailable','authentication','configuration','storage','capacity'].includes(String(s.failure)))||services.some(x=>x.service===s.service))fail('invalid_proof');
    services.push({service:s.service as Service,health:s.health as Health,failure:s.failure as Failure|null});
  }
  const report={revision:v.revision as number,observedAt:v.observedAt as number,services};
  if(JSON.stringify(report)!==text)fail('invalid_proof');return report;
}
async function lock(client:PoolClient,id:string):Promise<Row> {
  const {rows}=await client.query<Row>(`SELECT i.*,v.environment FROM installations i JOIN venues v ON v.id=i.venue_id WHERE i.id=$1 FOR UPDATE OF i`,[id]);
  if(!rows[0])return fail('unavailable');return rows[0];
}
async function view(client:PoolClient,id:string):Promise<InstallationView> {
  const {rows}=await client.query(`SELECT i.id AS "installationId",i.venue_id AS "venueId",v.organisation_id AS "organisationId",
    v.legal_business_id AS "legalBusinessId",v.environment,i.configuration_revision AS revision,i.revoked_at AS "revokedAt",
    i.last_contact_at AS "lastContactAt",i.lease_expires_at AS "leaseExpiresAt"
    FROM installations i JOIN venues v ON v.id=i.venue_id WHERE i.id=$1`,[id]);
  const services=await client.query(`SELECT s.service,s.state,s.configuration,
    CASE WHEN o.revision=i.configuration_revision AND o.received_at>clock_timestamp()-interval '5 minutes'
      AND o.observed_at>clock_timestamp()-interval '5 minutes' THEN o.health ELSE 'unknown' END AS health,
    CASE WHEN o.revision=i.configuration_revision AND o.received_at>clock_timestamp()-interval '5 minutes'
      AND o.observed_at>clock_timestamp()-interval '5 minutes' THEN o.failure ELSE NULL END AS failure,
    o.observed_at AS "observedAt"
    FROM installation_services s JOIN installations i ON i.id=s.installation_id
    LEFT JOIN installation_observations o ON o.installation_id=s.installation_id AND o.service=s.service
    WHERE s.installation_id=$1 ORDER BY s.service`,[id]);
  // JSON dates give durable operation results the same shape as freshly read results.
  return JSON.parse(JSON.stringify({...rows[0],services:services.rows}));
}
/** Machine proofs are checked against the stored key while holding the same lock as revocation. */
export class InstallationStore {
  readonly #pool:Pool;readonly #issuer:LeaseIssuer;readonly #origin:string;
  constructor(pool:Pool,issuer:LeaseIssuer,origin:string){this.#pool=pool;this.#issuer=issuer;this.#origin=origin;}
  /** Preliminary authentication protects the per-installation rate allowance; execute rechecks under lock. */
  async authenticate(action:MachineAction,envelope:unknown) {
    const routing=readMachineClaims(envelope);
    const row=(await this.#pool.query('SELECT public_key FROM installations WHERE id=$1',[routing.installationId])).rows[0];
    if(!row)fail('invalid_proof');return verifyMachine(envelope,row.public_key,this.#origin,action);
  }
  async execute(action:MachineAction,envelope:unknown):Promise<InstallationView> {
    const routing=readMachineClaims(envelope);
    return transaction(this.#pool,async client=>{
      const row=await lock(client,routing.installationId),now=Date.now();
      const c=verifyMachine(envelope,row.public_key,this.#origin,action,now);
      const report=readBody(action,c.body,now);
      const digest=createHash('sha256').update(JSON.stringify([action,c.lease,c.body])).digest('hex');
      const prior=(await client.query('SELECT digest,result FROM installation_operations WHERE installation_id=$1 AND operation_id=$2',[row.id,c.operationId])).rows[0];
      if(prior&&prior.digest!==digest)fail('conflict');
      if(row.revoked_at){if(action==='revoke'&&prior)return prior.result;return fail('revoked');}
      if(action==='renew'||action==='revoke'){if(c.lease!=='')fail('invalid_proof');}
      else {
        let lease:unknown;try{lease=JSON.parse(c.lease);}catch{return fail('invalid_proof');}
        const claims=verifyLease(lease,new Map([[this.#issuer.keyId,this.#issuer.publicKey]]),this.#origin,now);
        if(claims.installationId!==row.id||claims.venueId!==row.venue_id||claims.environment!==row.environment||claims.publicKey!==row.public_key)fail('invalid_proof');
      }
      if(prior)return prior.result;
      let lease:SignedEnvelope|undefined;
      if(action==='renew'){
        lease=this.#issuer.issue({origin:this.#origin,leaseId:randomUUID(),installationId:row.id,venueId:row.venue_id,environment:row.environment,publicKey:row.public_key,issuedAt:now,expiresAt:now+3600000});
        await client.query('UPDATE installations SET lease_expires_at=$2 WHERE id=$1',[row.id,new Date(now+3600000)]);
      }
      if(report){
        if(report.revision!==row.configuration_revision)fail('conflict');
        for(const s of report.services)await client.query(`INSERT INTO installation_observations(installation_id,service,revision,health,failure,observed_at)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(installation_id,service) DO UPDATE SET revision=excluded.revision,health=excluded.health,
          failure=excluded.failure,observed_at=excluded.observed_at,received_at=clock_timestamp()
          WHERE installation_observations.revision<excluded.revision OR installation_observations.observed_at<excluded.observed_at`,
        [row.id,s.service,report.revision,s.health,s.failure,new Date(report.observedAt)]);
      }
      if(action==='revoke')await client.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[row.id]);
      await client.query('UPDATE installations SET last_contact_at=clock_timestamp() WHERE id=$1',[row.id]);
      const result=await view(client,row.id);if(lease)result.lease=lease;
      await client.query('INSERT INTO installation_operations(installation_id,operation_id,digest,result) VALUES($1,$2,$3,$4)',[row.id,c.operationId,digest,result]);
      return result;
    });
  }
  /** Trusted provisioning only; deliberately has no public HTTP endpoint. */
  async configure(id:string,expectedRevision:number,services:DesiredService[]):Promise<InstallationView> {
    if(!isPairingUuid(id)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0||!Array.isArray(services)||services.length>3
      ||new Set(services.map(s=>s.service)).size!==services.length)fail('invalid_proof');
    for(const s of services)if(!object(s,['service','state','configuration'])||!names.includes(s.service)||!['unconfigured','provisioning','ready','failed'].includes(s.state)
      ||!s.configuration||typeof s.configuration!=='object'||Array.isArray(s.configuration)||JSON.stringify(s.configuration).length>4096)fail('invalid_proof');
    return transaction(this.#pool,async client=>{
      const row=await lock(client,id);if(row.revoked_at)fail('revoked');if(row.configuration_revision!==expectedRevision)fail('conflict');
      for(const s of services)await client.query('UPDATE installation_services SET state=$3,configuration=$4 WHERE installation_id=$1 AND service=$2',[id,s.service,s.state,s.configuration]);
      await client.query('UPDATE installations SET configuration_revision=configuration_revision+1 WHERE id=$1',[id]);return view(client,id);
    });
  }
  async listWithSession(token:string):Promise<InstallationView[]> {
    return transaction(this.#pool,async client=>{
      const session=await resolveSession(client,token,{touch:false});
      const memberships=await client.query('SELECT organisation_id,is_owner FROM organisation_memberships WHERE account_id=$1 FOR SHARE',[session.accountId]);
      const ids=await client.query(`SELECT i.id,v.organisation_id FROM installations i JOIN venues v ON v.id=i.venue_id WHERE v.organisation_id=ANY($1::uuid[]) ORDER BY i.id`,[memberships.rows.map(m=>m.organisation_id)]);
      const result:InstallationView[]=[];
      for(const i of ids.rows){const v=await view(client,i.id);v.canRevoke=memberships.rows.find(m=>m.organisation_id===i.organisation_id).is_owner;
        // Provisioning values may contain adapter authority; account screens receive status only.
        for(const s of v.services)s.configuration={};result.push(v);}
      await resolveSession(client,token,{touch:false});return result;
    });
  }
  async revokeWithSession(token:string,csrfToken:string,id:string):Promise<InstallationView> {
    if(!isPairingUuid(id))fail('permission_denied');
    return transaction(this.#pool,async client=>{
      const session=await resolveSession(client,token,{csrfToken,touch:false});
      const permission=await client.query(`SELECT m.organisation_id FROM organisation_memberships m JOIN venues v ON v.organisation_id=m.organisation_id
        JOIN installations i ON i.venue_id=v.id WHERE i.id=$1 AND m.account_id=$2 AND m.is_owner FOR SHARE OF m`,[id,session.accountId]);
      if(!permission.rowCount)fail('permission_denied');await lock(client,id);
      await resolveSession(client,token,{csrfToken});
      await client.query('UPDATE installations SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE id=$1',[id]);
      const result=await view(client,id);for(const s of result.services)s.configuration={};return result;
    });
  }
}
