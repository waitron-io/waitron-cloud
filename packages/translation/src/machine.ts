import type {Pool} from 'pg';
import {createLeaseTrust,InstallationError,InstallationStore,readMachineClaims,transaction,verifyLease,verifyMachine,type LeaseIssuer} from '@waitron-cloud/registration';
import {TranslationError} from './errors.ts';
import {parseJob,writtenItems} from './job-body.ts';
import {collectJob,createJob,findSubmitted,lockVenue,readJob,releaseJob,statusView,submitView} from './job-store.ts';
import {checkSubmitBody} from './submit-proof.ts';
export type TranslationAction='translation-submit'|'translation-status'|'translation-collect'|'translation-release';
function fail(code:'invalid_request'):never{throw new TranslationError(code);}
const actions:readonly string[]=['translation-submit','translation-status','translation-collect','translation-release'];
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
function jobReference(body:string,collect:boolean):{jobId:string;cursor:unknown}{
 let value:unknown;try{value=JSON.parse(body);}catch{return fail('invalid_request');}
 if(!value||typeof value!=='object'||Array.isArray(value))fail('invalid_request');
 const v=value as Record<string,unknown>,fields=Object.keys(v).sort().join(',');
 if((fields!=='jobId,version'&&(!collect||fields!=='cursor,jobId,version'))||v.version!==1||typeof v.jobId!=='string'||!uuid.test(v.jobId))fail('invalid_request');
 // Cursor values are checked only after the installation-scoped job lookup.
 return {jobId:v.jobId,cursor:Object.hasOwn(v,'cursor')?v.cursor:0};
}
function checkAction(action:TranslationAction){if(!actions.includes(action))throw new InstallationError('invalid_proof');}
export class TranslationMachine {
 readonly #pool:Pool;readonly #issuer:LeaseIssuer;readonly #origin:string;readonly #trusted:ReadonlyMap<string,string>;
 constructor(pool:Pool,issuer:LeaseIssuer,origin:string,trusted=createLeaseTrust(issuer)){this.#pool=pool;this.#issuer=issuer;this.#origin=origin;this.#trusted=trusted;}
 async authenticate(action:TranslationAction,envelope:unknown){
  checkAction(action);return new InstallationStore(this.#pool,this.#issuer,this.#origin,this.#trusted).authenticate(action,envelope);
 }
 async execute(action:TranslationAction,envelope:unknown,jobBody?:string):Promise<Record<string,unknown>>{
  checkAction(action);const routing=readMachineClaims(envelope);
  return transaction(this.#pool,async client=>{
   const row=(await client.query(`SELECT i.id,i.venue_id,i.public_key,i.revoked_at,v.environment,s.state AS translation_state
    FROM installations i JOIN venues v ON v.id=i.venue_id
    LEFT JOIN installation_services s ON s.installation_id=i.id AND s.service='content_translation'
    WHERE i.id=$1 FOR SHARE OF i`,[routing.installationId])).rows[0];
   if(!row)throw new InstallationError('invalid_proof');
   const claims=verifyMachine(envelope,row.public_key,this.#origin,action);
   if(row.revoked_at)throw new InstallationError('revoked');
   let encoded:unknown;try{encoded=JSON.parse(claims.lease);}catch{throw new InstallationError('invalid_proof');}
   if(JSON.stringify(encoded)!==claims.lease)throw new InstallationError('invalid_proof');
   const lease=verifyLease(encoded,this.#trusted,this.#origin);
   if(lease.installationId!==row.id||lease.venueId!==row.venue_id||lease.environment!==row.environment||lease.publicKey!==row.public_key)throw new InstallationError('invalid_proof');
   if(action==='translation-submit'){
    if(typeof jobBody!=='string')throw new InstallationError('invalid_proof');
    const fingerprint=checkSubmitBody(claims.body,jobBody),parsed=parseJob(jobBody);
    await lockVenue(client,row.venue_id);
    const prior=await findSubmitted(client,row.id,claims.operationId,fingerprint);
    if(prior)return submitView(prior);
    if(row.translation_state!=='ready')throw new InstallationError('permission_denied');
    return submitView(await createJob(client,{installationId:row.id,venueId:row.venue_id,operationId:claims.operationId,fingerprint,body:jobBody,total:writtenItems(parsed).length}));
   }
   const reference=jobReference(claims.body,action==='translation-collect');
   const job=await readJob(client,row.id,reference.jobId);
   if(action==='translation-status')return statusView(job);
   if(action==='translation-collect')return {...await collectJob(client,job,reference.cursor)};
   return releaseJob(client,job);
  });
 }
}
