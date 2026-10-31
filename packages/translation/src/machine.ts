import type {Pool} from 'pg';
import {createLeaseTrust,InstallationError,InstallationStore,readMachineClaims,requireTestPlanVenue,requireVenueService,transaction,verifyLease,verifyMachine,type LeaseIssuer,type PlanMode} from '@waitron-cloud/registration';
import {hasConsent} from './consent.ts';
import {TranslationError} from './errors.ts';
import {parseJob,writtenItems} from './job-body.ts';
import {collectJob,createJob,findSubmitted,lockVenue,readJob,releaseJob,statusView,submitView} from './job-store.ts';
import {checkSubmitBody} from './submit-proof.ts';
import {maxCollectBytes,validateCollectLimit} from './collect-page.ts';
export type TranslationAction='translation-submit'|'translation-status'|'translation-collect'|'translation-release';
function fail(code:'invalid_request'):never{throw new TranslationError(code);}
const actions:readonly string[]=['translation-submit','translation-status','translation-collect','translation-release'];
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
function unambiguousReference(body:string):boolean{
 const fields=new Set<string>();let depth=0;
 // Repeated keys can differ between JSON readers. Nested cursor values still need ownership-first validation.
 for(let i=0;i<body.length;i++){
  const c=body[i];
  if(c==='"'){
   const start=i;
   for(i++;i<body.length;i++){if(body[i]==='\\')i++;else if(body[i]==='"')break;}
   if(depth!==1)continue;
   const tail=body.slice(i+1);if(!/^\s*:/.test(tail))continue;
   const key=JSON.parse(body.slice(start,i+1)) as string;
   if(fields.has(key))return false;fields.add(key);
   if(key==='version'&&!/^\s*:\s*1\s*[,}]/.test(tail))return false;
  }else if(c==='{'||c==='[')depth++;
  else if(c==='}'||c===']')depth--;
 }
 return true;
}
function jobReference(body:string,collect:boolean):{jobId:string;cursor:unknown}{
 let value:unknown;try{value=JSON.parse(body);}catch{return fail('invalid_request');}
 if(!value||typeof value!=='object'||Array.isArray(value)||!unambiguousReference(body))fail('invalid_request');
 const v=value as Record<string,unknown>,fields=Object.keys(v).sort().join(',');
 if((fields!=='jobId,version'&&(!collect||fields!=='cursor,jobId,version'))||v.version!==1||typeof v.jobId!=='string'||!uuid.test(v.jobId))fail('invalid_request');
 // Cursor values are checked only after the installation-scoped job lookup.
 return {jobId:v.jobId,cursor:Object.hasOwn(v,'cursor')?v.cursor:0};
}
function checkAction(action:TranslationAction){if(!actions.includes(action))throw new InstallationError('invalid_proof');}
export class TranslationMachine {
 readonly #pool:Pool;readonly #issuer:LeaseIssuer;readonly #origin:string;readonly #trusted:ReadonlyMap<string,string>;readonly #collectPageBytes:number;readonly #planMode:PlanMode;
 constructor(pool:Pool,issuer:LeaseIssuer,origin:string,trusted=createLeaseTrust(issuer),collectPageBytes:number=maxCollectBytes,planMode:PlanMode='existing'){
  requireTestPlanVenue('test',planMode);this.#planMode=planMode;
  validateCollectLimit(collectPageBytes);this.#collectPageBytes=collectPageBytes;
  this.#pool=pool;this.#issuer=issuer;this.#origin=origin;this.#trusted=trusted;
 }
 async authenticate(action:TranslationAction,envelope:unknown){
  checkAction(action);return new InstallationStore(this.#pool,this.#issuer,this.#origin,this.#trusted).authenticate(action,envelope);
 }
 async execute(action:TranslationAction,envelope:unknown,jobBody?:string):Promise<Record<string,unknown>>{
  checkAction(action);const routing=readMachineClaims(envelope);
  return transaction(this.#pool,async client=>{
   const query=`SELECT i.id,i.venue_id,i.public_key,i.revoked_at,v.environment,s.state AS translation_state
    FROM installations i JOIN venues v ON v.id=i.venue_id
    LEFT JOIN installation_services s ON s.installation_id=i.id AND s.service='content_translation'
    WHERE i.id=$1`;
   let row=(await client.query(query+(this.#planMode==='existing'?' FOR SHARE OF i':''),[routing.installationId])).rows[0];
   const authorize=(row:Record<string,any>)=>{
    if(!row)throw new InstallationError('invalid_proof');
    const claims=verifyMachine(envelope,row.public_key,this.#origin,action);
    if(row.revoked_at)throw new InstallationError('revoked');
    let encoded:unknown;try{encoded=JSON.parse(claims.lease);}catch{throw new InstallationError('invalid_proof');}
    if(JSON.stringify(encoded)!==claims.lease)throw new InstallationError('invalid_proof');
    const lease=verifyLease(encoded,this.#trusted,this.#origin);
    if(lease.installationId!==row.id||lease.venueId!==row.venue_id||lease.environment!==row.environment||lease.publicKey!==row.public_key)throw new InstallationError('invalid_proof');
    try{requireTestPlanVenue(row.environment,this.#planMode);}catch(error){if(error instanceof Error&&error.message==='permission_denied')throw new InstallationError('permission_denied');throw error;}
    return claims;
   };
   let claims=authorize(row);
   if(action==='translation-submit'){
    if(typeof jobBody!=='string')throw new InstallationError('invalid_proof');
    const fingerprint=checkSubmitBody(claims.body,jobBody),parsed=parseJob(jobBody);
    let allowed=true;
    if(this.#planMode!=='existing'){
     // A retry owns its durable job independently of today's permission and consent.
     const replay=await client.query('SELECT 1 FROM translation_jobs WHERE installation_id=$1 AND operation_id=$2',[row.id,claims.operationId]);
     if(!replay.rowCount){
      try{
       await requireVenueService(client,row.venue_id,'content_translation',this.#planMode);
      }catch(error){if(error instanceof Error&&error.message==='permission_denied')allowed=false;else throw error;}
     }
     row=(await client.query(query+' FOR SHARE OF i',[routing.installationId])).rows[0];claims=authorize(row);
    }
    await lockVenue(client,row.venue_id);
    const prior=await findSubmitted(client,row.id,claims.operationId,fingerprint);
    if(prior)return submitView(prior);
    if(!allowed||row.translation_state!=='ready')throw new InstallationError('permission_denied');
    if(!await hasConsent(client,row.venue_id))throw new TranslationError('consent_required');
    return submitView(await createJob(client,{installationId:row.id,venueId:row.venue_id,operationId:claims.operationId,fingerprint,body:jobBody,total:writtenItems(parsed).length}));
   }
   if(this.#planMode!=='existing'){
    row=(await client.query(query+' FOR SHARE OF i',[routing.installationId])).rows[0];claims=authorize(row);
   }
   const reference=jobReference(claims.body,action==='translation-collect');
   const job=await readJob(client,row.id,reference.jobId);
   if(action==='translation-status')return statusView(job);
   if(action==='translation-collect')return {...await collectJob(client,job,reference.cursor,this.#collectPageBytes)};
   return releaseJob(client,job);
  });
 }
}
