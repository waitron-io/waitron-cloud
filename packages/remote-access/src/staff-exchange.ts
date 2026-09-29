import {createHash} from 'node:crypto';
import type {Pool,PoolClient} from 'pg';
import {createLeaseTrust,InstallationError,InstallationStore,readMachineClaims,transaction,verifyLease,verifyMachine,type LeaseIssuer} from '@waitron-cloud/registration';
import {isUuid} from './manifest.ts';
import {validateCsr} from './certificates.ts';
import {certificateNeedsRenewal} from './renewal.ts';
export type StaffCertificateAction='staff-certificate-submit'|'staff-certificate-status';
export class StaffCertificateError extends Error {readonly code:'invalid_input'|'conflict';constructor(code:StaffCertificateError['code']){super(code);this.code=code;}}
export interface StaffCertificateRequest {installation_id:string;request_id:string;request_digest:string;revision:number;hostname:string;csr:string;certificate:string|null;certificate_request_id:string|null}
function fail(code:StaffCertificateError['code']):never{throw new StaffCertificateError(code);}
function object(value:unknown,fields:string[]):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...fields].sort().join(',');}
export async function readStaffRequest(client:Pool|PoolClient,id:string):Promise<StaffCertificateRequest|undefined>{return (await client.query('SELECT * FROM staff_certificate_exchange WHERE installation_id=$1',[id])).rows[0];}
export async function publishStaffCertificate(client:PoolClient,request:StaffCertificateRequest,certificate:string){
 if(Buffer.byteLength(certificate)>16384||certificateNeedsRenewal(certificate,request.csr,request.hostname))throw new Error('invalid_certificate');
 // The caller holds the installation and job locks; CAS also fences a replaced request.
 const result=await client.query(`UPDATE staff_certificate_exchange SET certificate=$3,certificate_request_id=$2,updated_at=clock_timestamp()
  WHERE installation_id=$1 AND request_id=$2 AND request_digest=$4`,[request.installation_id,request.request_id,certificate,request.request_digest]);
 if(result.rowCount!==1)fail('conflict');
}
export class StaffCertificateExchange {
 readonly #pool:Pool;readonly #issuer:LeaseIssuer;readonly #origin:string;readonly #trusted:ReadonlyMap<string,string>;
 constructor(pool:Pool,issuer:LeaseIssuer,origin:string,trusted=createLeaseTrust(issuer)){this.#pool=pool;this.#issuer=issuer;this.#origin=origin;this.#trusted=trusted;}
 authenticate(action:StaffCertificateAction,envelope:unknown){return new InstallationStore(this.#pool,this.#issuer,this.#origin,this.#trusted).authenticate(action,envelope);}
 async execute(action:StaffCertificateAction,envelope:unknown){
  const routing=readMachineClaims(envelope);
  return transaction(this.#pool,async client=>{
   const row=(await client.query(`SELECT i.*,v.environment,h.hostname,s.state FROM installations i JOIN venues v ON v.id=i.venue_id
    LEFT JOIN remote_placements p ON p.installation_id=i.id LEFT JOIN remote_hostnames h ON h.venue_id=p.venue_id AND h.kind='staff'
    JOIN installation_services s ON s.installation_id=i.id AND s.service='remote_access' WHERE i.id=$1 FOR UPDATE OF i`,[routing.installationId])).rows[0];
   if(!row)throw new InstallationError('invalid_proof');
   const claims=verifyMachine(envelope,row.public_key,this.#origin,action);
   if(row.revoked_at)throw new InstallationError('revoked');
   if(!row.hostname||row.state==='unconfigured')throw new InstallationError('permission_denied');
   let encodedLease:unknown;try{encodedLease=JSON.parse(claims.lease);}catch{throw new InstallationError('invalid_proof');}
   if(JSON.stringify(encodedLease)!==claims.lease)throw new InstallationError('invalid_proof');
   const lease=verifyLease(encodedLease,this.#trusted,this.#origin);
   if(lease.installationId!==row.id||lease.venueId!==row.venue_id||lease.environment!==row.environment||lease.publicKey!==row.public_key)throw new InstallationError('invalid_proof');
   let body:unknown;try{body=JSON.parse(claims.body);}catch{return fail('invalid_input');}
   let current=await readStaffRequest(client,row.id);
   if(action==='staff-certificate-submit'){
    if(!object(body,['version','hostname','revision','csr','previousRequestId'])||body.version!==1||typeof body.hostname!=='string'||typeof body.csr!=='string'
     ||!Number.isSafeInteger(body.revision)||Number(body.revision)<0||(body.previousRequestId!==null&&!isUuid(body.previousRequestId)))fail('invalid_input');
    if(body.hostname!==row.hostname||body.revision!==row.configuration_revision)fail('conflict');
    try{validateCsr(body.csr,row.hostname);}catch{return fail('invalid_input');}
    const digest=createHash('sha256').update(claims.body).digest('hex');
    if(current?.request_id===claims.operationId){if(current.request_digest!==digest)fail('conflict');}
    else{
     if(body.previousRequestId!==(current?.request_id??null))fail('conflict');
     try{await client.query(`INSERT INTO staff_certificate_exchange(installation_id,request_id,request_digest,revision,hostname,csr) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(installation_id) DO UPDATE SET request_id=EXCLUDED.request_id,request_digest=EXCLUDED.request_digest,revision=EXCLUDED.revision,hostname=EXCLUDED.hostname,csr=EXCLUDED.csr,updated_at=clock_timestamp()`,[row.id,claims.operationId,digest,body.revision,body.hostname,body.csr]);}
     catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='23505')return fail('conflict');throw error;}
     current=await readStaffRequest(client,row.id);
    }
   }else{
    if(!object(body,['version','requestId'])||body.version!==1||!isUuid(body.requestId))fail('invalid_input');
    if(current?.request_id!==body.requestId)fail('conflict');
   }
   if(!current||current.revision!==row.configuration_revision||current.hostname!==row.hostname)fail('conflict');
   // A chain for the preceding request stays stored during failure, but is never returned for a new key.
   const ready=current.certificate_request_id===current.request_id&&current.certificate!==null&&!certificateNeedsRenewal(current.certificate,current.csr,current.hostname);
   return {version:1,installationId:row.id,requestId:current.request_id,hostname:current.hostname,revision:current.revision,csrDigest:createHash('sha256').update(current.csr).digest('hex'),state:ready?'ready':'pending',...(ready?{certificate:current.certificate}:{})};
  });
 }
}
