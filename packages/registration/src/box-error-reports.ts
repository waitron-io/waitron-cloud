import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {isPairingUuid} from './pairing-proof.ts';
import {InstallationStore} from './installations.ts';
import {createLeaseTrust,InstallationError,readMachineClaims,verifyMachine,verifyLease,type LeaseIssuer,type SignedEnvelope} from './installation-proof.ts';
import {transaction} from './transaction.ts';

type Action='error-report'|'release-held'|'staff-report'|'staff-description';
interface Report {code:string;source:string;version:string;time:number;count:number;logs:{level:string;code:string;source:string}[]}
interface Installation {public_key:string;venue_id:string;revoked_at:Date|null;superseded_by:string|null}
export class BoxErrorReportError extends Error{
 readonly code:'invalid_input'|'conflict'|'report_not_found';
 constructor(code:BoxErrorReportError['code']){super(code);this.code=code;}
}
function invalid():never{throw new BoxErrorReportError('invalid_input');}
function object(value:unknown,keys:string[]):value is Record<string,unknown>{
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
}
function code(value:unknown):value is string{return typeof value==='string'&&value.length<=128&&/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/.test(value);}
function source(value:unknown):value is string{
 if(typeof value!=='string'||!value.length||value.length>160)return false;
 const parts=value.split('#');if(parts.length>2||(parts.length===2&&!/^[A-Za-z_$][A-Za-z0-9_$.-]*$/.test(parts[1]!)))return false;
 return parts[0]!.split('/').every(p=>p!=='.'&&p!=='..'&&/^[A-Za-z0-9_$.-]+$/.test(p));
}
function version(value:unknown):number[]{
 if(typeof value!=='string'||! /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(value))return invalid();
 const result=value.split('.').map(Number);if(result.some(n=>!Number.isSafeInteger(n)||n>2147483647))return invalid();return result;
}
interface StaffReport {version:string;time:number;logs:Report['logs'];details:{device:string;equipment:string[];upgradedAt:number|null;hosting:string};description?:string}
interface StaffDescription {reportId:string;description:string}
// Node 26 provides this check; its type stays local to this validator.
const isWellFormed=(text:string)=>(text as string & {isWellFormed():boolean}).isWellFormed();
function description(value:unknown):value is string{
 return typeof value==='string'&&isWellFormed(value)&&value.trim().length>0&&[...value].length<=2000
  &&Buffer.byteLength(value)<=8192&&!/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/u.test(value);
}
function staffBody(action:'staff-report'|'staff-description',signed:string,text:string|undefined,now:number):StaffReport|StaffDescription{
 let fingerprint:unknown,value:unknown;try{fingerprint=JSON.parse(signed);}catch{throw new InstallationError('invalid_proof');}
 if(!object(fingerprint,['version','bodySha256','bodyBytes'])||fingerprint.version!==1||typeof fingerprint.bodySha256!=='string'
  ||!/^[a-f0-9]{64}$/.test(fingerprint.bodySha256)||!Number.isSafeInteger(fingerprint.bodyBytes)||Number(fingerprint.bodyBytes)<1)throw new InstallationError('invalid_proof');
 if(Number(fingerprint.bodyBytes)>16384)return invalid();
 if(typeof text!=='string'||!isWellFormed(text)||Buffer.byteLength(text)!==fingerprint.bodyBytes
  ||createHash('sha256').update(text).digest('hex')!==fingerprint.bodySha256)throw new InstallationError('invalid_proof');
 try{value=JSON.parse(text);}catch{return invalid();}
 if(action==='staff-description'){
  if(!object(value,['reportId','description'])||!isPairingUuid(value.reportId)||!description(value.description))return invalid();
  return value as unknown as StaffDescription;
 }
 const keys=['version','time','logs','details'];
 if(value&&typeof value==='object'&&'description' in value)keys.push('description');
 if(!object(value,keys)||!Number.isSafeInteger(value.time)||Number(value.time)<0||Number(value.time)>now+60000
  ||!Array.isArray(value.logs)||value.logs.length>8)return invalid();
 version(value.version);
 for(const log of value.logs)if(!object(log,['level','code','source'])||typeof log.level!=='string'||!['debug','info','warn','error'].includes(log.level)||!code(log.code)||!source(log.source))return invalid();
 const d=value.details;
 if(!object(d,['device','equipment','upgradedAt','hosting'])||typeof d.device!=='string'||!['till','dashboard','setup','server','unknown'].includes(d.device)
  ||!Array.isArray(d.equipment)||d.equipment.length>16||d.equipment.some(k=>!['printer','card_reader','other'].includes(k))
  ||typeof d.hosting!=='string'||!['hosted','on_prem','unknown'].includes(d.hosting)
  ||(d.upgradedAt!==null&&(!Number.isSafeInteger(d.upgradedAt)||Number(d.upgradedAt)<0||Number(d.upgradedAt)>now+60000))
  ||('description' in value&&!description(value.description)))return invalid();
 return value as unknown as StaffReport;
}
function body(action:Action,text:string,now:number):Report|{version:string}{
 let v:unknown;try{v=JSON.parse(text);}catch{return invalid();}
 if(Buffer.byteLength(text)>4096||JSON.stringify(v)!==text)return invalid();
 if(action==='release-held'){
  if(!object(v,['version']))return invalid();version(v.version);return v as {version:string};
 }
 if(!object(v,['code','source','version','time','count','logs'])||!code(v.code)||!source(v.source)
  ||!Number.isSafeInteger(v.time)||Number(v.time)<0||Number(v.time)>now+60000
  ||!Number.isSafeInteger(v.count)||Number(v.count)<1||Number(v.count)>1000000||!Array.isArray(v.logs)||v.logs.length>8)return invalid();
 version(v.version);
 for(const log of v.logs)if(!object(log,['level','code','source'])||!['debug','info','warn','error'].includes(String(log.level))||!code(log.code)||!source(log.source))return invalid();
 return v as unknown as Report;
}

/** Report identities belong here: installation_operations also feeds customer usage. */
export class BoxErrorReports{
 readonly #pool:Pool;readonly #origin:string;readonly #trusted:ReadonlyMap<string,string>;readonly #installations:InstallationStore;
 constructor(pool:Pool,issuer:LeaseIssuer,origin:string,trusted=createLeaseTrust(issuer)){
  this.#pool=pool;this.#origin=origin;this.#trusted=trusted;this.#installations=new InstallationStore(pool,issuer,origin,trusted);
 }
 async authenticate(action:Action,envelope:SignedEnvelope){return this.#installations.authenticate(action,envelope);}
 #verify(action:Action,envelope:SignedEnvelope,row:Installation,environment:string,installationId:string){
  const now=Date.now(),claims=verifyMachine(envelope,row.public_key,this.#origin,action,now);
  if(row.revoked_at||row.superseded_by)throw new InstallationError('revoked');
  let lease:unknown;try{lease=JSON.parse(claims.lease);}catch{throw new InstallationError('invalid_proof');}
  if(JSON.stringify(lease)!==claims.lease)throw new InstallationError('invalid_proof');
  const live=verifyLease(lease,this.#trusted,this.#origin,now);
  if(live.installationId!==installationId||live.venueId!==row.venue_id||live.environment!==environment||live.publicKey!==row.public_key)throw new InstallationError('invalid_proof');
  return claims;
 }
 async execute(action:Action,envelope:SignedEnvelope,externalBody?:string):Promise<{accepted:true}|{received:true}|{version:string;held:boolean}>{
  const routing=readMachineClaims(envelope);
  return transaction(this.#pool,async client=>{
   const initial=(await client.query<Installation>('SELECT public_key,venue_id FROM installations WHERE id=$1',[routing.installationId])).rows[0];
   if(!initial)throw new InstallationError('invalid_proof');verifyMachine(envelope,initial.public_key,this.#origin,action);
   // Parent before child matches venue writers; the shared parent lock keeps lease environment stable.
   const venue=(await client.query('SELECT environment FROM venues WHERE id=$1 FOR SHARE',[initial.venue_id])).rows[0];
   const row=(await client.query<Installation>('SELECT public_key,venue_id,revoked_at,superseded_by FROM installations WHERE id=$1 FOR UPDATE',[routing.installationId])).rows[0];
   if(!row||!venue||row.venue_id!==initial.venue_id)throw new InstallationError('invalid_proof');
   const claims=this.#verify(action,envelope,row,venue.environment,routing.installationId);
   if(action==='staff-report'||action==='staff-description'){
    const value=staffBody(action,claims.body,externalBody,Date.now());
    await this.#staff(client,action,routing.installationId,venue.environment,claims.operationId,claims.body,value);
    this.#verify(action,envelope,row,venue.environment,routing.installationId);return {received:true};
   }
   const value=body(action,claims.body,Date.now());
   const parts=version(value.version);
   if(action==='error-report'){
    const report=value as Report,digest=createHash('sha256').update(JSON.stringify([action,claims.body])).digest('hex');
    const prior=(await client.query('SELECT digest,kind,operation_id FROM installation_error_reports WHERE installation_id=$1 AND (operation_id=$2 OR description_operation_id=$2)',[routing.installationId,claims.operationId])).rows[0];
    if(prior&&(prior.digest!==digest||prior.kind!=='automatic'||prior.operation_id!==claims.operationId))throw new BoxErrorReportError('conflict');
    if(!prior)await client.query(`INSERT INTO installation_error_reports(installation_id,operation_id,environment,digest,code,source,version_major,version_minor,version_patch,reported_at,occurrences,logs)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[routing.installationId,claims.operationId,venue.environment,digest,report.code,report.source,...parts,new Date(report.time),report.count,JSON.stringify(report.logs)]);
    this.#verify(action,envelope,row,venue.environment,routing.installationId);return {accepted:true};
   }
   const result=await client.query<{held:boolean}>(`WITH predecessor AS MATERIALIZED (
     SELECT version_major,version_minor,version_patch,count(DISTINCT installation_id)::numeric AS boxes
     FROM installation_error_reports WHERE environment=$1 AND kind='automatic'
      AND (version_major,version_minor,version_patch)<($2::integer,$3::integer,$4::integer)
      AND EXISTS(SELECT 1 FROM installation_error_reports WHERE environment=$1 AND kind='automatic'
       AND (version_major,version_minor,version_patch)=($2::integer,$3::integer,$4::integer))
     GROUP BY 1,2,3 HAVING count(DISTINCT installation_id)>=2
     ORDER BY version_major DESC,version_minor DESC,version_patch DESC LIMIT 1
    ), reports AS MATERIALIZED (
     SELECT installation_id,code,occurrences,version_major,version_minor,version_patch FROM installation_error_reports
     WHERE environment=$1 AND kind='automatic' AND (version_major,version_minor,version_patch)=($2::integer,$3::integer,$4::integer)
      AND EXISTS(SELECT 1 FROM predecessor)
     UNION ALL
     SELECT r.installation_id,r.code,r.occurrences,r.version_major,r.version_minor,r.version_patch
     FROM installation_error_reports r JOIN predecessor p USING(version_major,version_minor,version_patch) WHERE r.environment=$1 AND r.kind='automatic'
    ), versions AS (
     SELECT version_major,version_minor,version_patch,count(DISTINCT installation_id)::numeric AS boxes FROM reports GROUP BY 1,2,3
    ), current_errors AS (
     SELECT code,sum(occurrences)::numeric AS n,count(DISTINCT installation_id) AS boxes FROM reports
     WHERE version_major=$2 AND version_minor=$3 AND version_patch=$4 GROUP BY code
    ), prior_errors AS (
     SELECT r.code,sum(r.occurrences)::numeric AS n FROM reports r JOIN predecessor p USING(version_major,version_minor,version_patch) GROUP BY r.code
    ) SELECT EXISTS(SELECT 1 FROM current_errors c CROSS JOIN predecessor p
      JOIN versions v ON v.version_major=$2 AND v.version_minor=$3 AND v.version_patch=$4
      LEFT JOIN prior_errors old ON old.code=c.code
      WHERE c.n>=5 AND c.boxes>=2 AND (old.code IS NULL OR c.n*p.boxes>=2*old.n*v.boxes)) AS held`,[venue.environment,...parts]);
   this.#verify(action,envelope,row,venue.environment,routing.installationId);
   return {version:value.version,held:result.rows[0]!.held};
  });
 }
 async #staff(client:PoolClient,action:'staff-report'|'staff-description',installationId:string,environment:string,operationId:string,signed:string,value:StaffReport|StaffDescription){
  const digest=createHash('sha256').update(JSON.stringify([action,signed])).digest('hex');
  let target:Record<string,unknown>|undefined;
  if(action==='staff-description'){
   target=(await client.query("SELECT description FROM installation_error_reports WHERE installation_id=$1 AND operation_id=$2 AND environment=$3 AND kind='staff'",[installationId,(value as StaffDescription).reportId,environment])).rows[0];
   if(!target)throw new BoxErrorReportError('report_not_found');
  }
  // The installation lock serialises both operation-ID columns, including cross-kind retries.
  const prior=(await client.query('SELECT operation_id,environment,kind,digest,description_operation_id,description_digest FROM installation_error_reports WHERE installation_id=$1 AND (operation_id=$2 OR description_operation_id=$2)',[installationId,operationId])).rows[0];
  if(prior){
   const identical=action==='staff-report'?prior.operation_id===operationId&&prior.kind==='staff'&&prior.digest===digest
    :prior.description_operation_id===operationId&&prior.description_digest===digest;
   if(!identical||prior.environment!==environment)throw new BoxErrorReportError('conflict');return;
  }
  if(action==='staff-description'){
   if(target!.description!==null)throw new BoxErrorReportError('conflict');
   const d=value as StaffDescription;
   await client.query('UPDATE installation_error_reports SET description=$3,description_operation_id=$4,description_digest=$5 WHERE installation_id=$1 AND operation_id=$2',[installationId,d.reportId,d.description,operationId,digest]);
  }else{
   const r=value as StaffReport;
   await client.query(`INSERT INTO installation_error_reports(installation_id,operation_id,environment,digest,kind,version_major,version_minor,version_patch,reported_at,logs,details,description)
    VALUES($1,$2,$3,$4,'staff',$5,$6,$7,$8,$9,$10,$11)`,[installationId,operationId,environment,digest,...version(r.version),new Date(r.time),JSON.stringify(r.logs),JSON.stringify(r.details),r.description??null]);
  }
 }
}
