import {readStaffRequest,publishStaffCertificate,type StaffCertificateRequest} from './staff-exchange.ts';
import {createHash,createPrivateKey,randomUUID,X509Certificate,type KeyObject} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {transaction,type PlanMode} from '@waitron-cloud/registration';
import {eligibleRemoteInstallations,legacyRemoteExclusion,lockLegacyRemoteScope} from './plan-permissions.ts';
import {RemoteAccessStore,type CertificateAuthorization,type TrafficCoverageJournal} from './placement.ts';
import {certificateNeedsRenewal} from './renewal.ts';
import {crypto as acmeCrypto} from 'acme-client';
import {validateCsr} from './certificates.ts';
import {certificateDigest,routeCells} from './certificate-digest.ts';
import {signManifest,type GatewayRoute,type ReportingGatewayRoute} from './manifest.ts';

export type RemoteConfigurationKind='route'|'certificate_staff'|'certificate_public'|'name';
export interface RemoteConfigurationJob {
 kind:RemoteConfigurationKind;targetId:string;desiredDigest:string;claimId:string;attempts:number;
}
interface ExecuteContext {signal:AbortSignal;isCurrent:()=>Promise<boolean>}
export interface PublicCertificateCopy {pem:string;csr:string}
export interface ReconcilerArtifacts {
 readPublicCertificate:(installationId:string)=>Promise<PublicCertificateCopy|undefined>;
 publishPublicCertificate:(installationId:string,venueId:string,cellIds:string[],copy:PublicCertificateCopy)=>Promise<void>;
 publishManifest:(cellId:string,envelope:string)=>Promise<void>;
}
export interface CertificateIssueTarget extends CertificateAuthorization {installationId:string;kind:'staff'|'public';csr:string;signal:AbortSignal}
interface ReconcilerOptions {
 planMode?:PlanMode;
 forwardReports?:boolean;
 trafficCoverage?:TrafficCoverageJournal;
 execute?:(job:RemoteConfigurationJob,context:ExecuteContext)=>Promise<void>;
 artifacts?:ReconcilerArtifacts;
 issueCertificate?:(target:CertificateIssueTarget)=>Promise<string>;
 signingKeyForCell?:(cellId:string)=>Promise<KeyObject>;
 pointName?:(name:string,target:string,signal:AbortSignal)=>Promise<void>;
 now?:()=>number;
}
interface DesiredTarget {kind:RemoteConfigurationKind;targetId:string;digest:string;names?:{staff:string;public:string;target:string}}

const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const routeDigest=(routes:GatewayRoute[])=>digest([...routes].sort((a,b)=>a.venueId.localeCompare(b.venueId)).map(route=>({installationId:route.installationId,venueId:route.venueId,staffHostname:route.staffHostname,publicHostname:route.publicHostname,address:route.address,port:route.port,peerPublicKey:route.peerPublicKey})));
const publicationDigest=(routes:GatewayRoute[],reporter?:{gatewayId:string;generation:number},venueLevels=false)=>reporter||venueLevels
 ?digest({routes:[...routes].sort((a,b)=>a.venueId.localeCompare(b.venueId)).map(r=>({binding:routeDigest([r]),revision:(r as ReportingGatewayRoute).revision})),...(reporter?{reporter}:{})}):routeDigest(routes);
const rowJob=(row:Record<string,unknown>):RemoteConfigurationJob=>({kind:row.kind as RemoteConfigurationKind,targetId:String(row.target_id),desiredDigest:String(row.desired_digest),claimId:String(row.claim_id),attempts:Number(row.attempts)});

const staffDigest=(authorityDigest:string,request:StaffCertificateRequest)=>digest({authorityDigest,requestId:request.request_id,requestDigest:request.request_digest});

async function desiredTargets(client:PoolClient,mode:PlanMode,forwardReports:boolean,scope?:Pick<RemoteConfigurationJob,'kind'|'targetId'>):Promise<DesiredTarget[]>{
 const cellId=scope?.kind==='route'?scope.targetId:null,installationId=scope&&scope.kind!=='route'?scope.targetId:null;
 let eligibleIds:string[]|undefined;
 if(mode==='test-venue-levels'){
  eligibleIds=await eligibleRemoteInstallations(client,mode,cellId??undefined,{installationIds:installationId?[installationId]:undefined,lock:scope?(scope.kind==='route'?'SHARE':'UPDATE'):false});
 }else if(forwardReports){
  const captured=mode==='test-free-paid'?await lockLegacyRemoteScope(client,cellId??undefined,installationId?[installationId]:undefined):undefined;
  const exclusion=await legacyRemoteExclusion(client,mode,captured?.venue_authority);
  const policies=captured?.organisations??(await client.query(`SELECT o.id FROM organisations o WHERE EXISTS(SELECT 1 FROM venues v JOIN remote_placements p ON p.venue_id=v.id
   WHERE v.organisation_id=o.id AND ($1::uuid IS NULL OR p.cell_id=$1 OR EXISTS(SELECT 1 FROM remote_cell_moves m
    WHERE m.installation_id=p.installation_id AND m.target_cell_id=$1 AND m.state IN ('staged','ready')))
   AND ($2::uuid IS NULL OR p.installation_id=$2)) ORDER BY o.id FOR SHARE OF o`,[cellId,installationId])).rows.map(r=>r.id);
  // Scheduling only projects work. Completion locks its policy and installations before the job;
  // certificate publication needs UPDATE immediately so concurrent completions never upgrade SHARE.
  const lock=scope?` FOR ${scope.kind==='route'?'SHARE':'UPDATE'} OF i`:'';
  const locked=(await client.query(`SELECT i.id FROM installations i JOIN venues v ON v.id=i.venue_id WHERE v.organisation_id=ANY($1::uuid[]) AND ($4::uuid[] IS NULL OR v.id=ANY($4::uuid[]))
   AND ($3::uuid IS NULL OR i.id=$3) AND EXISTS(SELECT 1 FROM remote_placements p WHERE p.installation_id=i.id
    AND ($2::uuid IS NULL OR p.cell_id=$2 OR EXISTS(SELECT 1 FROM remote_cell_moves m WHERE m.installation_id=i.id
     AND m.target_cell_id=$2 AND m.state IN ('staged','ready')))) ORDER BY i.id${lock}`,[policies,cellId,installationId,captured?.venues??null])).rows.map(r=>r.id);
  eligibleIds=mode==='existing'?locked:(await client.query(`SELECT i.id FROM installations i JOIN venues v ON v.id=i.venue_id JOIN organisations o ON o.id=v.organisation_id
   JOIN installation_services s ON s.installation_id=i.id AND s.service='remote_access' WHERE i.id=ANY($1::uuid[]) AND o.service_plan='paid'
   AND v.environment='test' AND s.state<>'unconfigured' AND i.revoked_at IS NULL${exclusion}`,[locked])).rows.map(r=>r.id);
 }else eligibleIds=await eligibleRemoteInstallations(client,mode);
 const eligible=eligibleIds===undefined?undefined:new Set(eligibleIds);
 const cells=installationId?[]:(await client.query(forwardReports?`SELECT c.id,r.gateway_id,r.generation,r.revoked_at FROM remote_cells c
  LEFT JOIN remote_forward_reporters r ON r.cell_id=c.id WHERE ($1::uuid IS NULL OR c.id=$1) ORDER BY c.id`:'SELECT id FROM remote_cells WHERE ($1::uuid IS NULL OR id=$1) ORDER BY id',[cellId])).rows;
 const targets:DesiredTarget[]=[];
 const active=installationId?[]:(await client.query(`SELECT p.cell_id,p.installation_id,p.venue_id,host(p.address) AS address,p.port,p.peer_public_key,
    s.hostname AS staff_hostname,u.hostname AS public_hostname,i.configuration_revision
   FROM remote_placements p JOIN installations i ON i.id=p.installation_id
   JOIN remote_hostnames s ON s.venue_id=p.venue_id AND s.kind='staff'
   JOIN remote_hostnames u ON u.venue_id=p.venue_id AND u.kind='public'
   WHERE i.revoked_at IS NULL AND ($1::uuid IS NULL OR p.cell_id=$1) ORDER BY p.cell_id,p.venue_id`,[cellId])).rows;
 const staged=installationId?[]:(await client.query(`SELECT m.target_cell_id AS cell_id,m.installation_id,m.venue_id,host(m.target_address) AS address,m.target_port AS port,m.target_peer_public_key AS peer_public_key,
    s.hostname AS staff_hostname,u.hostname AS public_hostname,i.configuration_revision
   FROM remote_cell_moves m JOIN installations i ON i.id=m.installation_id
   JOIN remote_hostnames s ON s.venue_id=m.venue_id AND s.kind='staff'
   JOIN remote_hostnames u ON u.venue_id=m.venue_id AND u.kind='public'
   WHERE m.state IN ('staged','ready') AND i.configuration_revision=m.expected_revision AND i.revoked_at IS NULL
   AND ($1::uuid IS NULL OR m.target_cell_id=$1) ORDER BY m.target_cell_id,m.venue_id`,[cellId])).rows;
 const routesByCell=new Map<string,GatewayRoute[]>();
 for(const row of [...active,...staged]){
  if(eligible&&!eligible.has(row.installation_id))continue;
  let routes=routesByCell.get(row.cell_id);if(!routes){routes=[];routesByCell.set(row.cell_id,routes);}
  routes.push({...(forwardReports||mode==='test-venue-levels'?{revision:Number(row.configuration_revision)}:{}),installationId:row.installation_id,venueId:row.venue_id,address:row.address,port:row.port,peerPublicKey:row.peer_public_key,staffHostname:row.staff_hostname,publicHostname:row.public_hostname});
 }
 for(const cell of cells)targets.push({kind:'route',targetId:cell.id,digest:publicationDigest(routesByCell.get(cell.id)??[],forwardReports&&cell.gateway_id&&!cell.revoked_at?{gatewayId:cell.gateway_id,generation:Number(cell.generation)}:undefined,mode==='test-venue-levels')});
 const cellsByInstallation=new Map<string,Set<string>>();for(const row of [...active,...staged]){let ids=cellsByInstallation.get(row.installation_id);if(!ids){ids=new Set();cellsByInstallation.set(row.installation_id,ids);}ids.add(row.cell_id);}
 const certificates=cellId?[]:(await client.query(`SELECT i.id,i.configuration_revision,p.venue_id,s.hostname AS staff_hostname,u.hostname AS public_hostname,s.assigned_hostname AS staff_assigned,u.assigned_hostname AS public_assigned,c.endpoint
  FROM installations i JOIN remote_placements p ON p.installation_id=i.id JOIN remote_cells c ON c.id=p.cell_id
  JOIN remote_hostnames s ON s.venue_id=p.venue_id AND s.kind='staff'
  JOIN remote_hostnames u ON u.venue_id=p.venue_id AND u.kind='public'
  WHERE i.revoked_at IS NULL AND ($1::uuid IS NULL OR i.id=$1) ORDER BY i.id`,[installationId])).rows;
 for(const row of certificates){
  if(eligible&&!eligible.has(row.id))continue;
  const names={staff:row.staff_assigned,public:row.public_assigned,target:row.endpoint.split(':')[0]};
  targets.push({kind:'name',targetId:row.id,digest:digest(names),names});
  for(const kind of ['staff','public'] as const){
   const hostname=row[`${kind}_hostname`],assigned=row[`${kind}_assigned`],dnsName='_acme-challenge.'+assigned;
   let desiredDigest=certificateDigest(row.id,kind,{revision:Number(row.configuration_revision),hostname,assigned,dnsName},kind==='public'?(installationId?await routeCells(client,row.id):[...cellsByInstallation.get(row.id)??[]]):[]);
   if(kind==='staff'){const request=await readStaffRequest(client,row.id);if(!request||request.revision!==Number(row.configuration_revision)||request.hostname!==hostname)continue;desiredDigest=staffDigest(desiredDigest,request);}
   targets.push({kind:`certificate_${kind}`,targetId:row.id,digest:desiredDigest});
  }
 }
 return targets;
}

export class RemoteConfigurationReconciler {
 readonly #forwardReports:boolean;readonly #planMode:PlanMode;readonly #pool:Pool;readonly #execute:ReconcilerOptions['execute'];readonly #artifacts:ReconcilerArtifacts|undefined;
 readonly #issueCertificate:ReconcilerOptions['issueCertificate'];readonly #signingKeyForCell:ReconcilerOptions['signingKeyForCell'];readonly #pointName:ReconcilerOptions['pointName'];readonly #now:()=>number;readonly #store:RemoteAccessStore;
 constructor(pool:Pool,options:ReconcilerOptions={}){
  if(options.trafficCoverage&&(!options.forwardReports||options.execute))throw new Error('invalid_traffic_options');
  this.#forwardReports=options.forwardReports??false;this.#planMode=options.planMode??'existing';this.#pool=pool;this.#store=new RemoteAccessStore(pool,this.#planMode,options.trafficCoverage);this.#execute=options.execute;this.#artifacts=options.artifacts;this.#issueCertificate=options.issueCertificate;this.#signingKeyForCell=options.signingKeyForCell;this.#pointName=options.pointName;this.#now=options.now??Date.now;
 }
 async schedule():Promise<number>{return transaction(this.#pool,async client=>{
  await client.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext('remote_configuration_schedule'))");
  const desired=await desiredTargets(client,this.#planMode,this.#forwardReports),keys=new Set(desired.map(target=>`${target.kind}:${target.targetId}`));let changed=0;
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
 async #eligible(job:RemoteConfigurationJob,client:PoolClient):Promise<boolean>{
  return this.#planMode==='existing'&&!this.#forwardReports||(await desiredTargets(client,this.#planMode,this.#forwardReports,job)).some(t=>t.kind===job.kind&&t.targetId===job.targetId&&t.digest===job.desiredDigest);
 }
 async #current(job:RemoteConfigurationJob,client?:PoolClient):Promise<boolean>{
  if(!client)return transaction(this.#pool,c=>this.#current(job,c));
  if(!await this.#eligible(job,client))return false;
  const row=(await client.query(`SELECT 1 FROM remote_configuration_jobs WHERE kind=$1 AND target_id=$2 AND desired_digest=$3 AND claim_id=$4
   AND enabled AND status='running' AND lease_until>clock_timestamp()`,[job.kind,job.targetId,job.desiredDigest,job.claimId])).rows[0];return !!row;
 }
 async runOnce(signal=new AbortController().signal):Promise<boolean>{
  const claimed=await transaction(this.#pool,async client=>{
   const exhausted=(await client.query(`SELECT kind,target_id FROM remote_configuration_jobs WHERE enabled AND kind<>'name' AND status='running' AND attempts>=8
    AND lease_until<=clock_timestamp() ORDER BY lease_until,kind,target_id LIMIT 1 FOR UPDATE SKIP LOCKED`)).rows[0];
   if(exhausted){await client.query(`UPDATE remote_configuration_jobs SET status='failed',claim_id=NULL,lease_until=NULL,failures=failures+1,
    last_error='reconcile_failed',updated_at=clock_timestamp() WHERE kind=$1 AND target_id=$2`,[exhausted.kind,exhausted.target_id]);return {parked:true as const};}
   const row=(await client.query(`SELECT * FROM remote_configuration_jobs WHERE enabled AND (attempts<8 OR kind='name') AND
    ((status='pending' AND available_at<=clock_timestamp()) OR (status='running' AND lease_until<=clock_timestamp()))
    ORDER BY available_at,kind,target_id LIMIT 1 FOR UPDATE SKIP LOCKED`)).rows[0];if(!row)return;
   return {parked:false as const,job:rowJob((await client.query(`UPDATE remote_configuration_jobs SET status='running',claim_id=$3,lease_until=clock_timestamp()+interval '120 seconds',
    attempts=LEAST(attempts+1,8),runs=runs+1,updated_at=clock_timestamp() WHERE kind=$1 AND target_id=$2 RETURNING *`,[row.kind,row.target_id,randomUUID()])).rows[0])};
  });
  if(!claimed)return false;
  if(claimed.parked)return true;
  const job=claimed.job;
  if(signal.aborted){await this.#release(job,true);return true;}
  try{
   if(!await this.#current(job))throw new Error('stale_configuration');
   if(this.#execute){await this.#execute(job,{signal,isCurrent:()=>this.#current(job)});await this.#complete(job,async()=>{});}
   else if(job.kind==='certificate_staff'||job.kind==='certificate_public')await this.#certificate(job,signal);
   else if(job.kind==='name')await this.#name(job,signal);
   else await this.#route(job);
  }catch{await this.#release(job,signal.aborted);}
  return true;
 }
 async #name(job:RemoteConfigurationJob,signal:AbortSignal){
  if(!this.#pointName)throw new Error('reconciler_not_configured');
  const desired=await transaction(this.#pool,client=>desiredTargets(client,this.#planMode,this.#forwardReports,job));
  const names=desired.find(t=>t.kind==='name'&&t.digest===job.desiredDigest)?.names;
  if(!names)throw new Error('stale_configuration');
  for(const name of [names.staff,names.public]){signal.throwIfAborted();if(!await this.#current(job))throw new Error('stale_claim');await this.#pointName(name,names.target,signal);}
  signal.throwIfAborted();await this.#complete(job,async()=>{});
 }
 async #route(job:RemoteConfigurationJob){
  if(!this.#artifacts||!this.#signingKeyForCell)throw new Error('reconciler_not_configured');const now=this.#now();
  const manifest=this.#forwardReports?await this.#store.reportingManifest(job.targetId,now):await this.#store.manifest(job.targetId,now);
  // Venue generations fence the job privately, including when the gateway wire has no reporter or revision.
  if(this.#planMode==='test-venue-levels'?!await this.#current(job):publicationDigest(manifest.routes,manifest.version===2?manifest.reporter:undefined)!==job.desiredDigest)throw new Error('stale_configuration');
  const key=await this.#signingKeyForCell(job.targetId),envelope=JSON.stringify(signManifest(manifest,key,now));
  await this.#complete(job,async client=>{
   await this.#store.journalTrafficManifest(client,manifest);
   await this.#artifacts!.publishManifest(job.targetId,envelope);
  });
 }
 async #certificate(job:RemoteConfigurationJob,signal:AbortSignal){return job.kind==='certificate_public'?this.#publicCertificate(job,signal):this.#staffCertificate(job,signal);}
 async #publicCertificate(job:RemoteConfigurationJob,signal:AbortSignal){
  if(!this.#artifacts||!this.#issueCertificate)throw new Error('reconciler_not_configured');
  const target=(await this.#pool.query("SELECT p.venue_id,h.hostname FROM remote_placements p JOIN remote_hostnames h ON h.venue_id=p.venue_id AND h.kind='public' WHERE p.installation_id=$1",[job.targetId])).rows[0];
  if(!target)throw new Error('placement_changed');
  const cells=await transaction(this.#pool,client=>routeCells(client,job.targetId)),copy=await this.#artifacts.readPublicCertificate(job.targetId);
  let usable=false;
  if(copy)try{validateCsr(copy.csr,target.hostname);usable=!certificateNeedsRenewal(copy.pem,copy.csr,target.hostname,this.#now(),false)&&new X509Certificate(copy.pem).checkPrivateKey(createPrivateKey(copy.pem));}catch{}
  const publish=async(value:PublicCertificateCopy,authority:CertificateAuthorization,keepClaim=false)=>this.#complete(job,async client=>{
   await this.#store.publishAuthorizedCertificate(client,job.targetId,'public',value.csr,authority,async()=>{
    if(!await this.#current(job,client))throw new Error('stale_claim');signal.throwIfAborted();
    if(certificateDigest(job.targetId,'public',authority,await routeCells(client,job.targetId))!==job.desiredDigest)throw new Error('placement_changed');
    if(certificateNeedsRenewal(value.pem,value.csr,authority.hostname,this.#now(),false))throw new Error('invalid_certificate');
    await this.#artifacts!.publishPublicCertificate(job.targetId,target.venue_id,cells,value);
   });
  },keepClaim);
  if(copy&&usable){
   const authority=await this.#store.authorizeCertificate(job.targetId,'public',copy.csr);
   if(certificateDigest(job.targetId,'public',authority,cells)!==job.desiredDigest)throw new Error('stale_configuration');
   const renewal=certificateNeedsRenewal(copy.pem,copy.csr,authority.hostname,this.#now());await publish(copy,authority,renewal);if(!renewal)return;
  }
  const [key,csrBytes]=await acmeCrypto.createCsr({commonName:target.hostname,altNames:[target.hostname]}),csr=csrBytes.toString(),authority=await this.#store.authorizeCertificate(job.targetId,'public',csr);
  if(certificateDigest(job.targetId,'public',authority,cells)!==job.desiredDigest)throw new Error('stale_configuration');
  signal.throwIfAborted();const certificate=await this.#issueCertificate({...authority,installationId:job.targetId,kind:'public',csr,signal});signal.throwIfAborted();
  if(certificateNeedsRenewal(certificate,csr,authority.hostname,this.#now()))throw new Error('invalid_certificate');
  await publish({pem:key.toString()+certificate,csr},authority);
 }
 async #staffCertificate(job:RemoteConfigurationJob,signal:AbortSignal){
  if(!this.#issueCertificate)throw new Error('reconciler_not_configured');
  const request=await readStaffRequest(this.#pool,job.targetId);if(!request)throw new Error('missing_staff_request');
  const authority=await this.#store.authorizeCertificate(job.targetId,'staff',request.csr);
  if(request.revision!==authority.revision||request.hostname!==authority.hostname||staffDigest(certificateDigest(job.targetId,'staff',authority),request)!==job.desiredDigest)throw new Error('stale_configuration');
  if(request.certificate_request_id===request.request_id&&request.certificate&&!certificateNeedsRenewal(request.certificate,request.csr,authority.hostname,this.#now())){await this.#complete(job,async()=>{});return;}
  const certificate=await this.#issueCertificate({...authority,installationId:job.targetId,kind:'staff',csr:request.csr,signal});
  signal.throwIfAborted();
  await this.#complete(job,async client=>{
   await this.#store.publishAuthorizedCertificate(client,job.targetId,'staff',request.csr,authority,async()=>{
    // Taking the installation lock can outlive the claim or shutdown signal.
    if(!await this.#current(job,client))throw new Error('stale_claim');
    signal.throwIfAborted();await publishStaffCertificate(client,request,certificate);
   });
  });
 }
 async #complete(job:RemoteConfigurationJob,action:(client:PoolClient)=>Promise<void>,keepClaim=false){
  const interval=job.kind==='route'?'5 minutes':'1 day';
  return transaction(this.#pool,async client=>{
   if(!await this.#eligible(job,client))throw new Error('stale_configuration');
   const live=(await client.query(`SELECT 1 FROM remote_configuration_jobs WHERE kind=$1 AND target_id=$2 AND desired_digest=$3 AND claim_id=$4
    AND enabled AND status='running' AND lease_until>clock_timestamp() FOR UPDATE`,[job.kind,job.targetId,job.desiredDigest,job.claimId])).rows[0];
   if(!live)throw new Error('stale_claim');await action(client);
   if(keepClaim){await client.query('UPDATE remote_configuration_jobs SET applied_digest=desired_digest,last_success_at=clock_timestamp() WHERE kind=$1 AND target_id=$2 AND claim_id=$3',[job.kind,job.targetId,job.claimId]);return;}
   await client.query(`UPDATE remote_configuration_jobs SET status='pending',applied_digest=desired_digest,available_at=clock_timestamp()+$5::interval,
    claim_id=NULL,lease_until=NULL,attempts=0,last_error=NULL,last_success_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE kind=$1 AND target_id=$2 AND desired_digest=$3 AND claim_id=$4`,[job.kind,job.targetId,job.desiredDigest,job.claimId,interval]);
  });
 }
 async #release(job:RemoteConfigurationJob,cancelled:boolean){
  const attempts=job.attempts,status=job.kind!=='name'&&!cancelled&&attempts>=8?'failed':'pending';
  const seconds=cancelled?0:Math.min(900,30*2**Math.max(0,attempts-1));
  await this.#pool.query(`UPDATE remote_configuration_jobs SET status=$5,available_at=clock_timestamp()+$6*interval '1 second',claim_id=NULL,lease_until=NULL,
   attempts=CASE WHEN $7 THEN GREATEST(0,attempts-1) WHEN kind='name' THEN LEAST(attempts,7) ELSE attempts END,failures=failures+CASE WHEN $7 THEN 0 ELSE 1 END,
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
