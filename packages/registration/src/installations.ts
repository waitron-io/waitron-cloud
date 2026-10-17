import {createHash,randomUUID} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {resolveSession} from '@waitron-cloud/identity';
import {readVenuePlan,readOrganisationPlan,type PlanMode} from './organisation-plans.ts';
import {transaction} from './transaction.ts';
import {isPairingUuid} from './pairing-proof.ts';
import {createLeaseTrust,InstallationError,readMachineClaims,verifyMachine,verifyLease,type LeaseIssuer,type MachineAction,type SignedEnvelope} from './installation-proof.ts';
import {recordSecurityAuditEvent,securityAuditSourceId,type SecurityAuditActorKind} from './security-audit.ts';
const names=['continuous_backup','remote_access','retained_snapshots'] as const;
type Service=typeof names[number];
type State='unconfigured'|'provisioning'|'ready'|'failed';
type Health='unknown'|'healthy'|'degraded'|'failed';
type Failure='unavailable'|'authentication'|'configuration'|'storage'|'capacity';
export interface DesiredService {service:Service;state:State;configuration:Record<string,unknown>}
export interface InstallationView {
  installationId:string;venueId:string;organisationId:string;legalBusinessId:string;environment:string;
  revision:number;revokedAt:string|null;lastContactAt:string|null;leaseExpiresAt:string|null;
  services:{service:Service|'content_translation';state:State;configuration:Record<string,unknown>;health:Health;failure:Failure|null;observedAt:string|null}[];
  lease?:SignedEnvelope;canRevoke?:boolean;
}
interface Row {id:string;venue_id:string;organisation_id:string;public_key:string;revoked_at:Date|null;configuration_revision:number;environment:'test'|'production'}
interface Report {revision:number;observedAt:number;services:{service:Service;health:Health;failure:Failure|null}[]}
function fail(code:InstallationError['code']):never {throw new InstallationError(code);}
function object(value:unknown,keys:string[]):value is Record<string,unknown> {
  return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
}
function readBody(action:MachineAction,text:string,now:number):Report|{servicesVersion:2}|undefined {
  let v:unknown;try{v=JSON.parse(text);}catch{return fail('invalid_proof');}
  if(action==='configuration'&&text==='{"servicesVersion":2}')return {servicesVersion:2};
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
  const {rows}=await client.query<Row>(`SELECT i.*,v.environment,v.organisation_id FROM installations i JOIN venues v ON v.id=i.venue_id WHERE i.id=$1 FOR UPDATE OF i`,[id]);
  if(!rows[0])return fail('unavailable');return rows[0];
}
async function view(client:PoolClient,id:string,servicesVersion:1|2=1):Promise<InstallationView> {
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
    WHERE s.installation_id=$1 AND ($2::integer=2 OR s.service<>'content_translation') ORDER BY s.service`,[id,servicesVersion]);
  // JSON dates give durable operation results the same shape as freshly read results.
  return JSON.parse(JSON.stringify({...rows[0],services:services.rows}));
}
async function installationPlan(client:PoolClient,venueId:string,mode:PlanMode) {
  try{return await readVenuePlan(client,venueId,mode);}
  catch(error){if(error instanceof Error && error.message==='permission_denied')fail('permission_denied');throw error;}
}
function maskPlan(result:InstallationView,plan:string,mode:PlanMode):InstallationView {
  if(mode==='test-free-paid' && plan!=='paid')for(const s of result.services)if(s.service!=='content_translation') {
    s.state='unconfigured';s.configuration={};s.health='unknown';s.failure=null;s.observedAt=null;
  }
  return result;
}
/** Machine proofs are checked against the stored key while holding the same lock as revocation. */
export class InstallationStore {
  readonly #planMode:PlanMode;readonly #pool:Pool;readonly #issuer:LeaseIssuer;readonly #origin:string;readonly #trusted:ReadonlyMap<string,string>;
  constructor(pool:Pool,issuer:LeaseIssuer,origin:string,trusted=createLeaseTrust(issuer),planMode:PlanMode='existing'){this.#planMode=planMode;this.#pool=pool;this.#issuer=issuer;this.#origin=origin;this.#trusted=trusted;}
  /** Preliminary authentication protects the per-installation rate allowance; execute rechecks under lock. */
  async authenticate(action:MachineAction,envelope:unknown) {
    const routing=readMachineClaims(envelope);
    const row=(await this.#pool.query('SELECT public_key FROM installations WHERE id=$1',[routing.installationId])).rows[0];
    if(!row)fail('invalid_proof');return verifyMachine(envelope,row.public_key,this.#origin,action);
  }
  async execute(action:MachineAction,envelope:unknown):Promise<InstallationView> {
    if(!['renew','configuration','report','revoke'].includes(action))fail('invalid_proof');
    const routing=readMachineClaims(envelope);
    return transaction(this.#pool,async client=>{
      const initial=(await client.query('SELECT public_key,venue_id FROM installations WHERE id=$1',[routing.installationId])).rows[0];
      if(!initial)fail('unavailable');verifyMachine(envelope,initial.public_key,this.#origin,action);
      const plan=await installationPlan(client,initial.venue_id,this.#planMode);
      const row=await lock(client,routing.installationId),now=Date.now();
      if(row.venue_id!==initial.venue_id)fail('invalid_proof');
      const c=verifyMachine(envelope,row.public_key,this.#origin,action,now);
      const body=readBody(action,c.body,now),report=body&&'revision' in body?body:undefined;
      const digest=createHash('sha256').update(JSON.stringify([action,c.body])).digest('hex');
      const prior=(await client.query('SELECT digest,result FROM installation_operations WHERE installation_id=$1 AND operation_id=$2',[row.id,c.operationId])).rows[0];
      if(prior&&prior.digest!==digest)fail('conflict');
      if(row.revoked_at){if(action==='revoke'&&prior)return prior.result;return fail('revoked');}
      if(action==='renew'||action==='revoke'){if(c.lease!=='')fail('invalid_proof');}
      else {
        let lease:unknown;try{lease=JSON.parse(c.lease);}catch{return fail('invalid_proof');}
        if(JSON.stringify(lease)!==c.lease)fail('invalid_proof');
        const claims=verifyLease(lease,this.#trusted,this.#origin,now);
        if(claims.installationId!==row.id||claims.venueId!==row.venue_id||claims.environment!==row.environment||claims.publicKey!==row.public_key)fail('invalid_proof');
      }
      if(prior){
        if(this.#planMode==='existing')return prior.result;
        const current=await view(client,row.id,body&&'servicesVersion' in body?2:1);
        if(prior.result.lease)current.lease=prior.result.lease;
        if(action==='revoke')for(const s of current.services)s.configuration={};
        return maskPlan(current,plan,this.#planMode);
      }
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
      const result=await view(client,row.id,body&&'servicesVersion' in body?2:1);if(lease)result.lease=lease;
      if(action==='revoke')for(const s of result.services)s.configuration={};
      verifyMachine(envelope,row.public_key,this.#origin,action);
      if(action==='revoke')await client.query("INSERT INTO installation_revocations(installation_id,actor_kind,actor_id,reason,result) VALUES($1,'installation',$1,'user_requested',$2) ON CONFLICT DO NOTHING",[row.id,result]);
      if(action==='renew')await recordSecurityAuditEvent(client,{organisationId:row.organisation_id,venueId:row.venue_id,type:'installation.credentials_renewed',actorKind:'installation',actorId:row.id,subjectKind:'installation',subjectId:row.id,sourceId:securityAuditSourceId('installation.credentials_renewed',row.id,c.operationId)});
      if(action==='revoke')await recordSecurityAuditEvent(client,{organisationId:row.organisation_id,venueId:row.venue_id,type:'installation.revoked',actorKind:'installation',actorId:row.id,subjectKind:'installation',subjectId:row.id,sourceId:row.id});
      await client.query('INSERT INTO installation_operations(installation_id,operation_id,digest,result) VALUES($1,$2,$3,$4)',[row.id,c.operationId,digest,result]);
      return maskPlan(result,plan,this.#planMode);
    });
  }
  /** Trusted provisioning only; deliberately has no public HTTP endpoint. */
  async configure(id:string,expectedRevision:number,services:DesiredService[]):Promise<InstallationView> {
    if(!isPairingUuid(id)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0||!Array.isArray(services)||services.length>3
      ||new Set(services.map(s=>s.service)).size!==services.length)fail('invalid_proof');
    for(const s of services)if(!object(s,['service','state','configuration'])||!names.includes(s.service)||!['unconfigured','provisioning','ready','failed'].includes(s.state)
      ||!s.configuration||typeof s.configuration!=='object'||Array.isArray(s.configuration)||JSON.stringify(s.configuration).length>4096)fail('invalid_proof');
    return transaction(this.#pool,async client=>{
      const initial=(await client.query('SELECT venue_id FROM installations WHERE id=$1',[id])).rows[0];if(!initial)fail('unavailable');
      const plan=await installationPlan(client,initial.venue_id,this.#planMode);
      if(plan!=='paid')fail('permission_denied');
      const row=await lock(client,id);if(row.venue_id!==initial.venue_id)fail('conflict');if(row.revoked_at)fail('revoked');if(row.configuration_revision!==expectedRevision)fail('conflict');
      for(const s of services)await client.query('UPDATE installation_services SET state=$3,configuration=$4 WHERE installation_id=$1 AND service=$2',[id,s.service,s.state,s.configuration]);
      await client.query('UPDATE installations SET configuration_revision=configuration_revision+1 WHERE id=$1',[id]);return view(client,id);
    });
  }
  async listWithSession(token:string):Promise<InstallationView[]> {
    return transaction(this.#pool,async client=>{
      const session=await resolveSession(client,token,{touch:false});
      const memberships=await client.query('SELECT organisation_id,is_owner FROM organisation_memberships WHERE account_id=$1 FOR SHARE',[session.accountId]);
      if(this.#planMode!=='existing')for(const m of [...memberships.rows].sort((a,b)=>a.organisation_id.localeCompare(b.organisation_id)))await readOrganisationPlan(client,m.organisation_id);
      const ids=await client.query(`SELECT i.id,v.organisation_id FROM installations i JOIN venues v ON v.id=i.venue_id WHERE v.organisation_id=ANY($1::uuid[]) AND i.superseded_by IS NULL ORDER BY i.id`,[memberships.rows.map(m=>m.organisation_id)]);
      const result:InstallationView[]=[];
      for(const i of ids.rows){const plan=await installationPlan(client,(await client.query('SELECT venue_id FROM installations WHERE id=$1',[i.id])).rows[0].venue_id,this.#planMode);const v=maskPlan(await view(client,i.id),plan,this.#planMode);v.canRevoke=memberships.rows.find(m=>m.organisation_id===i.organisation_id).is_owner;
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
      const result=await view(client,id);for(const s of result.services)s.configuration={};
      await resolveSession(client,token,{csrfToken,touch:false});
      await client.query("INSERT INTO installation_revocations(installation_id,actor_kind,actor_id,reason,result) VALUES($1,'account',$2,'user_requested',$3) ON CONFLICT DO NOTHING",[id,session.accountId,result]);
      const revocation=(await client.query<{actor_kind:SecurityAuditActorKind;actor_id:string}>('SELECT actor_kind,actor_id FROM installation_revocations WHERE installation_id=$1',[id])).rows[0]!;
      await recordSecurityAuditEvent(client,{organisationId:permission.rows[0].organisation_id,venueId:result.venueId,type:'installation.revoked',actorKind:revocation.actor_kind,actorId:revocation.actor_id,subjectKind:'installation',subjectId:id,sourceId:id});return result;
    });
  }
}
