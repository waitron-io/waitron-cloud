import type {Pool,PoolClient} from 'pg';
import type {Context} from 'hono';
import {admitAddressLookup,AddressLookupAdmissionError,AllowanceError,InstallationError,InstallationStore,
 createLeaseTrust,readMachineClaims,transaction,verifyMachine,verifyLease,type AddressLookupCap,type AddressLookupPolicy,type EmailOutbox,type LeaseIssuer,type SignedEnvelope} from '@waitron-cloud/registration';
import {AddressLookupError,checkInput,createGoogleAddressClient} from './address-lookup-google.ts';
import {AccountHttpError} from './errors.ts';
import {AccountRateLimiter,type RateRule} from './rate-limit.ts';
import {readAccountBody} from './request.ts';
import {operatorNoticeRecipient} from './signup-limits.ts';

type RegisteredBox={id:string;venue_id:string;public_key:string;revoked_at:Date|null;superseded_by:string|null;
 environment:string;account_id:string|null;verified:boolean};
type AddressProvider=Pick<ReturnType<typeof createGoogleAddressClient>,'suggest'|'validate'>;
export type AddressLookupOptions={provider:AddressProvider;policy:AddressLookupPolicy};
type Body={version:1;kind:'available'}
 |{version:1;kind:'suggest';workflowId:string;query:string;language:'es'|'en'}
 |{version:1;kind:'validate';workflowId:string;selectedText:string};
type AddressLookupBox={accountId:string;venueId:string;installationId:string};
type LookupConnection=Pick<PoolClient,'query'>;
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const spendBuckets=['cloudDay','cloudMonth','freeDay','freeMonth'] as const;
const spendFields=['freeSuggestions','freeValidations','limitMicros'] as const;
const quantityBuckets=['paidVenueMonth','freeAccountMonth'] as const;
const quantityFields=['suggestions','validations'] as const;
const policyFields=['suggestionMicros','validationMicros',...spendBuckets,...quantityBuckets] as const;
const pacificDate=new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'});

function hasFields(value:unknown,fields:readonly string[]):value is Record<string,unknown>{
 return !!value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).length===fields.length&&fields.every(field=>Object.hasOwn(value,field));
}
function validPolicy(value:unknown):value is AddressLookupPolicy{
 if(!hasFields(value,policyFields))return false;
 const units=(input:unknown,minimum:number)=>typeof input==='number'&&Number.isSafeInteger(input)&&input>=minimum;
 const validBucket=(name:string,fields:readonly string[])=>{
  const bucket=value[name];return hasFields(bucket,fields)&&fields.every(field=>units(bucket[field],0));
 };
 if(!units(value.suggestionMicros,1)||!units(value.validationMicros,1)
  ||!spendBuckets.every(name=>validBucket(name,spendFields))||!quantityBuckets.every(name=>validBucket(name,quantityFields)))return false;
 const {cloudDay,cloudMonth,freeDay,freeMonth}=value as AddressLookupPolicy;
 return spendFields.every(field=>cloudDay[field]<=cloudMonth[field]&&freeMonth[field]<=cloudMonth[field]
  &&freeDay[field]<=cloudDay[field]&&freeDay[field]<=freeMonth[field]);
}
export function addressLookupOptionsFromEnv(environment:NodeJS.ProcessEnv):AddressLookupOptions|undefined{
 if(environment.NODE_ENV==='production'||!environment.CLOUD_ADDRESS_LOOKUP_SETTINGS||!environment.GOOGLE_MAPS_SERVER_KEY)return;
 try{
  const settings:unknown=JSON.parse(environment.CLOUD_ADDRESS_LOOKUP_SETTINGS);
  if(!hasFields(settings,['environment',...policyFields])||settings.environment!=='test')return;
  const {environment:_,...policy}=settings;
  if(!validPolicy(policy))return;
  return {provider:createGoogleAddressClient({apiKey:environment.GOOGLE_MAPS_SERVER_KEY,fetcher:fetch}),policy};
 }catch{return;}
}
function parseBody(raw:string):Body{
 let value:unknown;try{value=JSON.parse(raw);}catch{throw new AccountHttpError(400,'invalid_input');}
 if(!value||typeof value!=='object'||Array.isArray(value)||JSON.stringify(value)!==raw)throw new AccountHttpError(400,'invalid_input');
 const v=value as Record<string,unknown>,suggest=v.kind==='suggest';
 if(v.version===1&&v.kind==='available'&&Object.keys(v).length===2)return {version:1,kind:'available'};
 if(v.version!==1||(!suggest&&v.kind!=='validate')||typeof v.workflowId!=='string'||!uuid.test(v.workflowId)
  ||Object.keys(v).sort().join(',')!==(suggest?'kind,language,query,version,workflowId':'kind,selectedText,version,workflowId'))throw new AccountHttpError(400,'invalid_input');
 // Validate before reserving a call that the provider would refuse without sending.
 checkInput(suggest?v.query:v.selectedText,!suggest);
 if(suggest&&v.language!=='es'&&v.language!=='en')throw new AccountHttpError(400,'invalid_input');
 return v as Body;
}
function isAvailability(raw:string):boolean{
 try{return parseBody(raw).kind==='available';}catch{return false;}
}
async function instant(client:LookupConnection):Promise<Date>{return (await client.query('SELECT clock_timestamp() AS now')).rows[0].now;}
function httpError(error:unknown):never{
 if(error instanceof AllowanceError&&error.code==='allowance_scope_not_found')throw new InstallationError('permission_denied');
 if(!(error instanceof AddressLookupAdmissionError))throw error;
 if(error.code==='conflict')throw new AccountHttpError(409,'conflict');
 if(error.code==='forbidden')throw new AccountHttpError(403,'forbidden');
 if(error.code==='expired')throw new AccountHttpError(410,'expired');
 throw new AccountHttpError(429,'rate_limited',60);
}

export async function warnAboutAddressCap(pool:Pool,limiter:AccountRateLimiter,outbox:EmailOutbox,operator:string|undefined,cap:AddressLookupCap,venueId:string,operatorVenues=false){
 try{
  const first=await transaction(pool,async client=>{
   const claim=await limiter.consume([{scope:'address-lookup-cap-warning',subject:JSON.stringify([cap.bucket,cap.scope,cap.period]),limit:1,windowSeconds:32*86400}],client);
   if(!claim.allowed)return false;
   const recipient=operator?await operatorNoticeRecipient(client,operator):undefined;
   if(operator&&recipient)await outbox.enqueue(client,'operator_notice',{
    email:recipient.email,locale:recipient.locale??'en',event:'address_cap',accountId:operator,bucket:cap.bucket,period:cap.period,
    ...(cap.scope==='*'?{}:{venueId,...(operatorVenues?{operatorVenueLink:true}:{})}),
   });
   return true;
  });
  if(first)console.warn('Cloud address lookup cap refused',cap.bucket,cap.period);
 }catch{
  console.warn('Cloud address lookup cap warning failed',cap.bucket,cap.period);
 }
}

export class AddressLookupMachine{
 readonly #pool:Pool;readonly #issuer:LeaseIssuer;readonly #origin:string;readonly #trusted:ReadonlyMap<string,string>;
 readonly #provider:AddressProvider;readonly #limiter:AccountRateLimiter;readonly #policy:AddressLookupPolicy;
 readonly #warnCap:((cap:AddressLookupCap,venueId:string)=>Promise<void>)|undefined;
 constructor(pool:Pool,issuer:LeaseIssuer,origin:string,rateKey:string,options:AddressLookupOptions,trusted=createLeaseTrust(issuer),
  warnCap?:(cap:AddressLookupCap,venueId:string)=>Promise<void>){
  this.#warnCap=warnCap;
  if(typeof options?.provider?.suggest!=='function'||typeof options?.provider?.validate!=='function'||!validPolicy(options.policy))throw new Error('invalid_address_lookup_configuration');
  this.#pool=pool;this.#issuer=issuer;this.#origin=origin;this.#trusted=trusted;this.#provider=options.provider;
  this.#policy=structuredClone(options.policy);this.#limiter=new AccountRateLimiter(pool,rateKey);
 }
 authenticate(envelope:SignedEnvelope){
  return new InstallationStore(this.#pool,this.#issuer,this.#origin,this.#trusted).authenticate('address-lookup',envelope);
 }
 async #authorize(client:LookupConnection,envelope:SignedEnvelope,installationId:string,now:Date):Promise<AddressLookupBox>{
  const {rows}=await client.query<RegisteredBox>(`SELECT i.id,i.venue_id,i.public_key,i.revoked_at,i.superseded_by,v.environment,
   m.account_id,c.email_verified_at IS NOT NULL AND a.disabled_at IS NULL AS verified
   FROM installations i JOIN venues v ON v.id=i.venue_id
   LEFT JOIN organisation_memberships m ON m.organisation_id=v.organisation_id AND m.is_owner
   LEFT JOIN cloud_accounts a ON a.id=m.account_id
   LEFT JOIN cloud_credentials c ON c.account_id=a.id
   WHERE i.id=$1 LIMIT 2`,[installationId]);
  const row=rows.length===1?rows[0]:undefined;
  if(!row||row.environment!=='test'||!row.account_id||!row.verified)throw new InstallationError('permission_denied');
  if(row.revoked_at||row.superseded_by)throw new InstallationError('revoked');
  const claims=verifyMachine(envelope,row.public_key,this.#origin,'address-lookup',now.getTime());
  if(claims.installationId!==row.id)throw new InstallationError('invalid_proof');
  let encoded:unknown;try{encoded=JSON.parse(claims.lease);}catch{throw new InstallationError('invalid_proof');}
  if(JSON.stringify(encoded)!==claims.lease)throw new InstallationError('invalid_proof');
  const lease=verifyLease(encoded,this.#trusted,this.#origin,now.getTime());
  if(lease.installationId!==row.id||lease.venueId!==row.venue_id||lease.publicKey!==row.public_key||lease.environment!==row.environment)throw new InstallationError('invalid_proof');
  return {accountId:row.account_id,venueId:row.venue_id,installationId};
 }
 async #admit(envelope:SignedEnvelope,body:Body,box:AddressLookupBox,operationId:string){
  const client=await this.#pool.connect();
  let discard=false;
  const onError=()=>{discard=true;};client.on('error',onError);
  try{
   await client.query('BEGIN');
   const admission=await admitAddressLookup(client,box,body.kind==='available'?body:{kind:body.kind,workflowId:body.workflowId,operationId},this.#policy)
    .catch(error=>{if(error instanceof AddressLookupAdmissionError&&error.cap)return error;throw error;});
   const now=await instant(client),confirmed=await this.#authorize(client,envelope,box.installationId,now);
   if(confirmed.accountId!==box.accountId||confirmed.venueId!==box.venueId)throw new InstallationError('permission_denied');
   if(admission instanceof AddressLookupAdmissionError)throw admission;
   if(admission&&now>=admission.expiresAt)throw new AccountHttpError(410,'expired');
   if(admission&&pacificDate.format(now)!==admission.day)throw new AccountHttpError(503,'temporarily_unavailable');
   if(discard)throw new AddressLookupError('unavailable',false);
   await client.query('COMMIT');
   return admission;
  }catch(error){
   try{await client.query('ROLLBACK');}catch{discard=true;}
   throw error;
  }finally{
   client.release(discard);client.removeListener('error',onError);
   if(discard)throw new AddressLookupError('unavailable',false);
  }
 }
 async execute(envelope:SignedEnvelope){
  const claims=readMachineClaims(envelope);
  const box=await this.#authorize(this.#pool,envelope,claims.installationId,await instant(this.#pool));
  if(!isAvailability(claims.body)){
   // Stop at the box limit before charging the allowance its owner shares with other boxes.
   for(const rule of [
    {scope:'address-lookup-box',subject:box.installationId,limit:30,windowSeconds:60},
    {scope:'address-lookup-owner',subject:box.accountId,limit:60,windowSeconds:60},
   ]){
    const limit=await this.#limiter.consume([rule]);
    if(!limit.allowed)throw new AccountHttpError(429,'rate_limited',limit.retryAfterSeconds);
   }
  }
  const body=parseBody(claims.body);
  const admission=await this.#admit(envelope,body,box,claims.operationId).catch(async error=>{
   if(error instanceof AddressLookupAdmissionError&&error.cap)await this.#warnCap?.(error.cap,box.venueId);
   httpError(error);
  });
  if(!admission)return {available:true};
  if(body.kind==='available')throw new Error('Unexpected address lookup admission');
  const result=body.kind==='suggest'
   ?await this.#provider.suggest({query:body.query,language:body.language})
   :await this.#provider.validate({selectedText:body.selectedText});
  return {workflowId:body.workflowId,expiresAt:admission.expiresAt.toISOString(),...result};
 }
}
export async function addressLookupResponse(c:Context,options:{machine?:AddressLookupMachine;ip:string;consume:(rules:RateRule[])=>Promise<void>}){
 if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
 if(c.req.header('origin')!==undefined)throw new AccountHttpError(403,'forbidden');
 if(!options.machine)throw new AccountHttpError(503,'temporarily_unavailable');
 const envelope=await readAccountBody(c.req.raw,['payload','signature']);
 const signed={payload:envelope.payload!,signature:envelope.signature!};
 let availability=false;
 try{availability=isAvailability(readMachineClaims(signed).body);}catch{}
 await options.consume([{scope:availability?'installation-ip':'address-lookup-network',subject:options.ip,limit:60,windowSeconds:60}]);
 const claims=await options.machine.authenticate(signed);
 try{
  if(availability)await options.consume([{scope:'installation-key',subject:claims.installationId,limit:30,windowSeconds:60}]);
  return c.json(await options.machine.execute(signed));
 }catch(error){
  if(!(error instanceof AddressLookupError))throw error;
  if(error.code==='rate_limited')c.header('Retry-After','1');
  return c.json({error:error.code,dispatched:error.dispatched},error.code==='invalid_input'?400:error.code==='rate_limited'?429:503);
 }
}
