import {createHash,randomUUID,type KeyObject} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {transaction} from '@waitron-cloud/registration';
import {RemoteAccessStore,type CertificateAuthorization} from './placement.ts';
import {certificateNeedsRenewal} from './renewal.ts';
import {signManifest,type GatewayRoute} from './manifest.ts';

export type RemoteConfigurationKind='route'|'certificate_staff'|'certificate_public';
export interface RemoteConfigurationJob {
 kind:RemoteConfigurationKind;targetId:string;desiredDigest:string;claimId:string;attempts:number;
}
interface ExecuteContext {signal:AbortSignal;isCurrent:()=>Promise<boolean>}
export interface ReconcilerArtifacts {
 readCsr:(installationId:string,kind:'staff'|'public')=>Promise<string>;
 readCertificate:(installationId:string,kind:'staff'|'public')=>Promise<string|undefined>;
 publishCertificate:(installationId:string,kind:'staff'|'public',certificate:string)=>Promise<void>;
 publishManifest:(cellId:string,envelope:string)=>Promise<void>;
}
export interface CertificateIssueTarget extends CertificateAuthorization {installationId:string;kind:'staff'|'public';csr:string;signal:AbortSignal}
interface ReconcilerOptions {
 execute?:(job:RemoteConfigurationJob,context:ExecuteContext)=>Promise<void>;
 artifacts?:ReconcilerArtifacts;
 issueCertificate?:(target:CertificateIssueTarget)=>Promise<string>;
 signingKeyForCell?:(cellId:string)=>Promise<KeyObject>;
 now?:()=>number;
}
interface DesiredTarget {kind:RemoteConfigurationKind;targetId:string;digest:string}

const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const routeDigest=(routes:GatewayRoute[])=>digest([...routes].sort((a,b)=>a.venueId.localeCompare(b.venueId)).map(route=>({installationId:route.installationId,venueId:route.venueId,staffHostname:route.staffHostname,publicHostname:route.publicHostname,address:route.address,port:route.port,peerPublicKey:route.peerPublicKey})));
const certificateDigest=(installationId:string,kind:'staff'|'public',value:CertificateAuthorization)=>digest({installationId,kind,revision:value.revision,hostname:value.hostname,dnsName:value.dnsName});
const rowJob=(row:Record<string,unknown>):RemoteConfigurationJob=>({kind:row.kind as RemoteConfigurationKind,targetId:String(row.target_id),desiredDigest:String(row.desired_digest),claimId:String(row.claim_id),attempts:Number(row.attempts)});

async function desiredTargets(client:PoolClient):Promise<DesiredTarget[]>{
 const cells=(await client.query('SELECT id FROM remote_cells ORDER BY id')).rows;
 const targets:DesiredTarget[]=[];
 for(const cell of cells){
  const active=(await client.query(`SELECT p.installation_id,p.venue_id,host(p.address) AS address,p.port,p.peer_public_key,
    s.hostname AS staff_hostname,u.hostname AS public_hostname
   FROM remote_placements p JOIN installations i ON i.id=p.installation_id
   JOIN remote_hostnames s ON s.venue_id=p.venue_id AND s.kind='staff'
   JOIN remote_hostnames u ON u.venue_id=p.venue_id AND u.kind='public'
   WHERE p.cell_id=$1 AND i.revoked_at IS NULL ORDER BY p.venue_id`,[cell.id])).rows;
  const staged=(await client.query(`SELECT m.installation_id,m.venue_id,host(m.target_address) AS address,m.target_port AS port,m.target_peer_public_key AS peer_public_key,
    s.hostname AS staff_hostname,u.hostname AS public_hostname
   FROM remote_cell_moves m JOIN installations i ON i.id=m.installation_id
   JOIN remote_hostnames s ON s.venue_id=m.venue_id AND s.kind='staff'
   JOIN remote_hostnames u ON u.venue_id=m.venue_id AND u.kind='public'
   WHERE m.target_cell_id=$1 AND m.state IN ('staged','ready') AND i.configuration_revision=m.expected_revision AND i.revoked_at IS NULL
   ORDER BY m.venue_id`,[cell.id])).rows;
  const routes=[...active,...staged].map(row=>({installationId:row.installation_id,venueId:row.venue_id,address:row.address,port:row.port,peerPublicKey:row.peer_public_key,staffHostname:row.staff_hostname,publicHostname:row.public_hostname}));
  targets.push({kind:'route',targetId:cell.id,digest:routeDigest(routes)});
 }
 const certificates=(await client.query(`SELECT i.id,i.configuration_revision,p.venue_id,c.suffix,s.hostname AS staff_hostname,u.hostname AS public_hostname
  FROM installations i JOIN remote_placements p ON p.installation_id=i.id JOIN remote_cells c ON c.id=p.cell_id
  JOIN remote_hostnames s ON s.venue_id=p.venue_id AND s.kind='staff'
  JOIN remote_hostnames u ON u.venue_id=p.venue_id AND u.kind='public'
  WHERE i.revoked_at IS NULL ORDER BY i.id`)).rows;
 for(const row of certificates){
  for(const kind of ['staff','public'] as const){
   const hostname=row[`${kind}_hostname`],dnsName=`_acme-challenge.${kind==='staff'?'staff-':''}v-${row.venue_id}.${row.suffix}`;
   targets.push({kind:`certificate_${kind}`,targetId:row.id,digest:certificateDigest(row.id,kind,{revision:Number(row.configuration_revision),hostname,dnsName})});
  }
 }
 return targets;
}

export class RemoteConfigurationReconciler {
 readonly #pool:Pool;readonly #execute:ReconcilerOptions['execute'];readonly #artifacts:ReconcilerArtifacts|undefined;
 readonly #issueCertificate:ReconcilerOptions['issueCertificate'];readonly #signingKeyForCell:ReconcilerOptions['signingKeyForCell'];readonly #now:()=>number;readonly #store:RemoteAccessStore;
 constructor(pool:Pool,options:ReconcilerOptions={}){this.#pool=pool;this.#store=new RemoteAccessStore(pool);this.#execute=options.execute;this.#artifacts=options.artifacts;this.#issueCertificate=options.issueCertificate;this.#signingKeyForCell=options.signingKeyForCell;this.#now=options.now??Date.now;}
 async schedule():Promise<number>{return transaction(this.#pool,async client=>{
  await client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext('remote_configuration_schedule'))");
  const desired=await desiredTargets(client),keys=new Set(desired.map(target=>`${target.kind}:${target.targetId}`));let changed=0;
  const existing=(await client.query('SELECT kind,target_id FROM remote_configuration_jobs WHERE enabled')).rows;
  for(const row of existing)if(!keys.has(`${row.kind}:${row.target_id}`)){
   const result=await client.query(`UPDATE remote_configuration_jobs SET enabled=false,status='pending',claim_id=NULL,lease_until=NULL,attempts=0,last_error=NULL,updated_at=clock_timestamp()
    WHERE kind=$1 AND target_id=$2 AND enabled`,[row.kind,row.target_id]);changed+=result.rowCount??0;
  }
  for(const target of desired){
   const result=await client.query(`INSERT INTO remote_configuration_jobs(kind,target_id,desired_digest) VALUES($1,$2,$3)
    ON CONFLICT(kind,target_id) DO UPDATE SET enabled=true,
     desired_digest=EXCLUDED.desired_digest,
     status=CASE WHEN remote_configuration_jobs.desired_digest<>EXCLUDED.desired_digest OR NOT remote_configuration_jobs.enabled THEN 'pending' ELSE remote_configuration_jobs.status END,
     available_at=CASE WHEN remote_configuration_jobs.desired_digest<>EXCLUDED.desired_digest OR NOT remote_configuration_jobs.enabled THEN clock_timestamp() ELSE remote_configuration_jobs.available_at END,
     claim_id=CASE WHEN remote_configuration_jobs.desired_digest<>EXCLUDED.desired_digest OR NOT remote_configuration_jobs.enabled THEN NULL ELSE remote_configuration_jobs.claim_id END,
     lease_until=CASE WHEN remote_configuration_jobs.desired_digest<>EXCLUDED.desired_digest OR NOT remote_configuration_jobs.enabled THEN NULL ELSE remote_configuration_jobs.lease_until END,
     attempts=CASE WHEN remote_configuration_jobs.desired_digest<>EXCLUDED.desired_digest OR NOT remote_configuration_jobs.enabled THEN 0 ELSE remote_configuration_jobs.attempts END,
     last_error=CASE WHEN remote_configuration_jobs.desired_digest<>EXCLUDED.desired_digest OR NOT remote_configuration_jobs.enabled THEN NULL ELSE remote_configuration_jobs.last_error END,
     updated_at=CASE WHEN remote_configuration_jobs.desired_digest<>EXCLUDED.desired_digest OR NOT remote_configuration_jobs.enabled THEN clock_timestamp() ELSE remote_configuration_jobs.updated_at END
    WHERE remote_configuration_jobs.desired_digest<>EXCLUDED.desired_digest OR NOT remote_configuration_jobs.enabled
    RETURNING 1`,[target.kind,target.targetId,target.digest]);changed+=result.rowCount??0;
  }
  return changed;
 });}
 async #current(job:RemoteConfigurationJob):Promise<boolean>{
  const row=(await this.#pool.query(`SELECT 1 FROM remote_configuration_jobs WHERE kind=$1 AND target_id=$2 AND desired_digest=$3 AND claim_id=$4
   AND enabled AND status='running' AND lease_until>clock_timestamp()`,[job.kind,job.targetId,job.desiredDigest,job.claimId])).rows[0];return !!row;
 }
 async runOnce(signal=new AbortController().signal):Promise<boolean>{
  const claimed=await transaction(this.#pool,async client=>{
   const row=(await client.query(`SELECT * FROM remote_configuration_jobs WHERE enabled AND attempts<8 AND
    ((status='pending' AND available_at<=clock_timestamp()) OR (status='running' AND lease_until<=clock_timestamp()))
    ORDER BY available_at,kind,target_id LIMIT 1 FOR UPDATE SKIP LOCKED`)).rows[0];if(!row)return;
   return rowJob((await client.query(`UPDATE remote_configuration_jobs SET status='running',claim_id=$3,lease_until=clock_timestamp()+interval '120 seconds',
    attempts=attempts+1,runs=runs+1,updated_at=clock_timestamp() WHERE kind=$1 AND target_id=$2 RETURNING *`,[row.kind,row.target_id,randomUUID()])).rows[0]);
  });
  if(!claimed)return false;
  if(signal.aborted){await this.#release(claimed,true);return true;}
  try{
   if(this.#execute){await this.#execute(claimed,{signal,isCurrent:()=>this.#current(claimed)});await this.#complete(claimed,async()=>{});}
   else if(claimed.kind==='certificate_staff'||claimed.kind==='certificate_public')await this.#certificate(claimed,signal);
   else await this.#route(claimed);
  }catch{await this.#release(claimed,false);}
  return true;
 }
 async #route(job:RemoteConfigurationJob){
  if(!this.#artifacts||!this.#signingKeyForCell)throw new Error('reconciler_not_configured');const now=this.#now();
  const manifest=await this.#store.manifest(job.targetId,now);if(routeDigest(manifest.routes)!==job.desiredDigest)throw new Error('stale_configuration');
  const key=await this.#signingKeyForCell(job.targetId),envelope=JSON.stringify(signManifest(manifest,key,now));
  await this.#complete(job,()=>this.#artifacts!.publishManifest(job.targetId,envelope));
 }
 async #certificate(job:RemoteConfigurationJob,signal:AbortSignal){
  if(!this.#artifacts||!this.#issueCertificate)throw new Error('reconciler_not_configured');
  const kind=job.kind==='certificate_staff'?'staff':'public',csr=await this.#artifacts.readCsr(job.targetId,kind);
  const authority=await this.#store.authorizeCertificate(job.targetId,kind,csr);
  if(certificateDigest(job.targetId,kind,authority)!==job.desiredDigest)throw new Error('stale_configuration');
  const existing=await this.#artifacts.readCertificate(job.targetId,kind);
  if(existing&&!certificateNeedsRenewal(existing,csr,authority.hostname,this.#now())){await this.#complete(job,async()=>{});return;}
  const certificate=await this.#issueCertificate({...authority,installationId:job.targetId,kind,csr,signal});
  if(certificateNeedsRenewal(certificate,csr,authority.hostname,this.#now()))throw new Error('invalid_certificate');
  await this.#complete(job,async()=>{
   const latestCsr=await this.#artifacts!.readCsr(job.targetId,kind);if(latestCsr!==csr)throw new Error('csr_changed');
   await this.#store.publishAuthorizedCertificate(job.targetId,kind,csr,authority,()=>this.#artifacts!.publishCertificate(job.targetId,kind,certificate));
  });
 }
 async #complete(job:RemoteConfigurationJob,action:()=>Promise<void>){
  const interval=job.kind==='route'?'5 minutes':'1 day';
  return transaction(this.#pool,async client=>{
   const live=(await client.query(`SELECT 1 FROM remote_configuration_jobs WHERE kind=$1 AND target_id=$2 AND desired_digest=$3 AND claim_id=$4
    AND enabled AND status='running' AND lease_until>clock_timestamp() FOR UPDATE`,[job.kind,job.targetId,job.desiredDigest,job.claimId])).rows[0];
   if(!live)throw new Error('stale_claim');await action();
   await client.query(`UPDATE remote_configuration_jobs SET status='pending',applied_digest=desired_digest,available_at=clock_timestamp()+$5::interval,
    claim_id=NULL,lease_until=NULL,attempts=0,last_error=NULL,last_success_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE kind=$1 AND target_id=$2 AND desired_digest=$3 AND claim_id=$4`,[job.kind,job.targetId,job.desiredDigest,job.claimId,interval]);
  });
 }
 async #release(job:RemoteConfigurationJob,cancelled:boolean){
  const attempts=job.attempts,status=!cancelled&&attempts>=8?'failed':'pending';
  const seconds=cancelled?0:Math.min(900,30*2**Math.max(0,attempts-1));
  await this.#pool.query(`UPDATE remote_configuration_jobs SET status=$5,available_at=clock_timestamp()+$6*interval '1 second',claim_id=NULL,lease_until=NULL,
   attempts=CASE WHEN $7 THEN GREATEST(0,attempts-1) ELSE attempts END,failures=failures+CASE WHEN $7 THEN 0 ELSE 1 END,
   last_error=CASE WHEN $7 THEN last_error ELSE 'reconcile_failed' END,updated_at=clock_timestamp()
   WHERE kind=$1 AND target_id=$2 AND desired_digest=$3 AND claim_id=$4 AND status='running'`,[job.kind,job.targetId,job.desiredDigest,job.claimId,status,seconds,cancelled]);
 }
}

export async function remoteConfigurationStatus(pool:Pool){
 const row=(await pool.query(`SELECT count(*) FILTER(WHERE enabled)::integer AS enabled,
  count(*) FILTER(WHERE enabled AND ((status='pending' AND available_at<=clock_timestamp()) OR(status='running' AND lease_until<=clock_timestamp())))::integer AS due,
  count(*) FILTER(WHERE enabled AND status='running' AND lease_until>clock_timestamp())::integer AS running,
  count(*) FILTER(WHERE enabled AND status='failed')::integer AS failed,
  min(CASE WHEN status='running' THEN lease_until ELSE available_at END) FILTER(WHERE enabled AND ((status='pending' AND available_at<=clock_timestamp()) OR(status='running' AND lease_until<=clock_timestamp()))) AS oldest_due_at
  FROM remote_configuration_jobs`)).rows[0];
 return {enabled:row.enabled,due:row.due,running:row.running,failed:row.failed,oldestDueAt:row.oldest_due_at?.toISOString()??null};
}
