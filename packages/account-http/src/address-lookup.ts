import {setTimeout as delay} from 'node:timers/promises';
import type {Pool,PoolClient} from 'pg';
import type {Context} from 'hono';
import {AllowanceError,InstallationError,InstallationStore,createLeaseTrust,readMachineClaims,verifyMachine,verifyLease,
 reserveAllowance,spendAllowance,recordAllowanceAttempt,type LeaseIssuer,type SignedEnvelope} from '@waitron-cloud/registration';
import {AddressLookupError,checkInput,type createGoogleAddressClient} from './address-lookup-google.ts';
import {AccountHttpError} from './errors.ts';
import {AccountRateLimiter,type RateRule} from './rate-limit.ts';
import {readAccountBody} from './request.ts';

export type AddressLookupOptions={accountId:string;venueId:string;installationId:string;provider:ReturnType<typeof createGoogleAddressClient>};
type Body={version:1;kind:'suggest'|'validate';workflowId:string;query?:string;selectedText?:string;language?:'es'|'en'};
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
function conflict():never{throw new AccountHttpError(409,'conflict');}
function parseBody(raw:string):Body{
 let value:unknown;try{value=JSON.parse(raw);}catch{throw new AccountHttpError(400,'invalid_input');}
 if(!value||typeof value!=='object'||Array.isArray(value)||JSON.stringify(value)!==raw)throw new AccountHttpError(400,'invalid_input');
 const v=value as Record<string,unknown>,suggest=v.kind==='suggest';
 if(v.version!==1||(!suggest&&v.kind!=='validate')||typeof v.workflowId!=='string'||!uuid.test(v.workflowId)
  ||Object.keys(v).sort().join(',')!==(suggest?'kind,language,query,version,workflowId':'kind,selectedText,version,workflowId'))throw new AccountHttpError(400,'invalid_input');
 // Malformed input must not consume a hold that the transport would refuse without sending.
 checkInput(suggest?v.query:v.selectedText,'input-validation',!suggest);
 if(suggest&&v.language!=='es'&&v.language!=='en')throw new AccountHttpError(400,'invalid_input');
 return v as Body;
}
async function instant(client:PoolClient):Promise<Date>{return (await client.query('SELECT clock_timestamp() AS now')).rows[0].now;}
function newBinding(now:Date):string{
 const end=new Date(now);end.setUTCDate(1);end.setUTCHours(0,0,0,0);end.setUTCMonth(end.getUTCMonth()+1);
 return JSON.stringify({version:1,createdAt:now.toISOString(),expiresAt:new Date(Math.min(now.getTime()+900000,end.getTime())).toISOString()});
}
function expiry(binding:string):string{
 try{
  const value=JSON.parse(binding);
  if(value.version!==1||Object.keys(value).sort().join(',')!=='createdAt,expiresAt,version'
   ||new Date(value.createdAt).toISOString()!==value.createdAt||new Date(value.expiresAt).toISOString()!==value.expiresAt
   ||Date.parse(value.expiresAt)<=Date.parse(value.createdAt)||Date.parse(value.expiresAt)-Date.parse(value.createdAt)>900000)throw Error();
  return value.expiresAt;
 }catch{throw new AccountHttpError(503,'temporarily_unavailable');}
}
function allowanceError(error:AllowanceError):never{
 if(error.code==='allowance_exhausted')throw new AccountHttpError(429,'rate_limited',60);
 if(error.code==='allowance_conflict')conflict();
 if(error.code==='allowance_scope_not_found')throw new InstallationError('permission_denied');
 throw new AccountHttpError(503,'temporarily_unavailable');
}

export class AddressLookupMachine{
 readonly #pool:Pool;readonly #issuer:LeaseIssuer;readonly #origin:string;readonly #trusted:ReadonlyMap<string,string>;
 readonly #trial:AddressLookupOptions;readonly #limiter:AccountRateLimiter;
 constructor(pool:Pool,issuer:LeaseIssuer,origin:string,rateKey:string,trial:AddressLookupOptions,trusted=createLeaseTrust(issuer)){
  if(!trial||![trial.accountId,trial.venueId,trial.installationId].every(id=>typeof id==='string'&&uuid.test(id))
   ||typeof trial.provider?.suggest!=='function'||typeof trial.provider.validate!=='function')throw new Error('invalid_address_lookup_configuration');
  this.#pool=pool;this.#issuer=issuer;this.#origin=origin;this.#trusted=trusted;this.#trial={...trial};this.#limiter=new AccountRateLimiter(pool,rateKey);
 }
 async authenticate(envelope:SignedEnvelope){
  const claims=await new InstallationStore(this.#pool,this.#issuer,this.#origin,this.#trusted).authenticate('address-lookup',envelope);
  if(claims.installationId!==this.#trial.installationId)throw new InstallationError('permission_denied');
  return claims;
 }
 async #authorize(client:PoolClient,envelope:SignedEnvelope,now:Date){
  const row=(await client.query(`SELECT i.*,v.environment FROM installations i JOIN venues v ON v.id=i.venue_id WHERE i.id=$1`,[this.#trial.installationId])).rows[0];
  if(!row||row.venue_id!==this.#trial.venueId||row.environment!=='test')throw new InstallationError('permission_denied');
  const claims=verifyMachine(envelope,row.public_key,this.#origin,'address-lookup',now.getTime());
  if(claims.installationId!==row.id)throw new InstallationError('invalid_proof');
  if(row.revoked_at||row.superseded_by)throw new InstallationError('revoked');
  let encoded:unknown;try{encoded=JSON.parse(claims.lease);}catch{throw new InstallationError('invalid_proof');}
  if(JSON.stringify(encoded)!==claims.lease)throw new InstallationError('invalid_proof');
  const lease=verifyLease(encoded,this.#trusted,this.#origin,now.getTime());
  if(lease.installationId!==row.id||lease.venueId!==row.venue_id||lease.publicKey!==row.public_key||lease.environment!==row.environment)throw new InstallationError('invalid_proof');
 }
 async execute(envelope:SignedEnvelope){
  const claims=readMachineClaims(envelope),body=parseBody(claims.body),trial=this.#trial;
  if(claims.installationId!==trial.installationId)throw new InstallationError('permission_denied');
  const client=await this.#pool.connect(),stop=new AbortController();let locked=false,discard=false,inTransaction=false,dispatched=false;
  const onError=()=>{discard=true;stop.abort();};client.on('error',onError);
  try{
   locked=(await client.query("SELECT pg_try_advisory_lock(hashtext(current_schema()),hashtext('address-lookup:google')) AS locked")).rows[0].locked;
   if(!locked)conflict();
   await delay(500,undefined,{signal:stop.signal});
   await client.query('BEGIN');inTransaction=true;
   const opened=await instant(client);
   await this.#authorize(client,envelope,opened);
   const prior=(await client.query("SELECT binding FROM billing_allowance_reservations WHERE installation_id=$1 AND operation_id=$2 AND service='address_lookup'",[trial.installationId,body.workflowId])).rows[0];
   if(!prior&&body.kind==='validate')conflict();
   const binding:string=prior?.binding??newBinding(opened),expiresAt=expiry(binding);
   const saved=await reserveAllowance(client,{accountId:trial.accountId,venueId:trial.venueId,installationId:trial.installationId,
    service:'address_lookup',operationId:body.workflowId,binding,units:1n});
   if(saved.state!=='held')conflict();
   const now=await instant(client),day=now.toISOString().slice(0,10);
   if(now.getTime()>=Date.parse(expiresAt))throw new AccountHttpError(410,'expired');
   const used=(await client.query("SELECT coalesce(sum(units),0)::text AS used FROM billing_allowance_reservations WHERE account_id=$1 AND service='address_lookup' AND month=$2::date AND state IN ('held','spent')",[trial.accountId,saved.month])).rows[0].used;
   if(BigInt(used)>10n)throw new AccountHttpError(429,'rate_limited',60);
   const call=await this.#limiter.consume([{scope:'address-lookup-call',subject:trial.installationId+':'+claims.operationId,limit:1,windowSeconds:300}],client);
   if(!call.allowed)conflict();
   if(body.kind==='suggest'){
    const decision=await this.#limiter.consume([{scope:'address-lookup-workflow',subject:saved.id,limit:8,windowSeconds:900},
     {scope:'address-lookup-day',subject:trial.accountId+':'+day,limit:20,windowSeconds:86400}],client);
    if(!decision.allowed)throw new AccountHttpError(429,'rate_limited',decision.retryAfterSeconds);
   }
   if(body.kind==='validate'){await spendAllowance(client,saved.id);await recordAllowanceAttempt(client,saved.id,(await instant(client)).toISOString());}
   const final=await instant(client);await this.#authorize(client,envelope,final);
   if(discard)throw new AccountHttpError(503,'temporarily_unavailable');
   if(final.getTime()>=Date.parse(expiresAt))throw new AccountHttpError(410,'expired');
   if(final.toISOString().slice(0,10)!==day)throw new AccountHttpError(503,'temporarily_unavailable');
   await client.query('COMMIT');inTransaction=false;
   dispatched=true;
   const result=body.kind==='suggest'
    ?await trial.provider.suggest({query:body.query!,language:body.language!,sessionToken:saved.id},stop.signal)
    :await trial.provider.validate({selectedText:body.selectedText!,sessionToken:saved.id},stop.signal);
   return {workflowId:body.workflowId,expiresAt,...result};
  }catch(error){
   if(inTransaction){try{await client.query('ROLLBACK');}catch{discard=true;}}
   if(error instanceof AllowanceError)allowanceError(error);
   throw error;
  }finally{
   try{if(locked&&!discard){const row=(await client.query("SELECT pg_advisory_unlock(hashtext(current_schema()),hashtext('address-lookup:google')) AS unlocked")).rows[0];if(!row.unlocked)discard=true;}}
   catch{discard=true;}
   finally{client.release(discard);client.removeListener('error',onError);}
   if(discard)throw new AddressLookupError('unavailable',dispatched);
  }
 }
}
export async function addressLookupResponse(c:Context,options:{machine?:AddressLookupMachine;ip:string;consume:(rules:RateRule[])=>Promise<void>}){
 if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
 if(c.req.header('origin')!==undefined)throw new AccountHttpError(403,'forbidden');
 if(!options.machine)throw new AccountHttpError(503,'temporarily_unavailable');
 await options.consume([{scope:'installation-ip',subject:options.ip,limit:60,windowSeconds:60}]);
 const envelope=await readAccountBody(c.req.raw,['payload','signature']);
 const signed={payload:envelope.payload!,signature:envelope.signature!};
 const claims=await options.machine.authenticate(signed);
 await options.consume([{scope:'installation-key',subject:claims.installationId,limit:30,windowSeconds:60}]);
 try{return c.json(await options.machine.execute(signed));}
 catch(error){
  if(!(error instanceof AddressLookupError))throw error;
  if(error.code==='rate_limited')c.header('Retry-After','1');
  return c.json({error:error.code,dispatched:error.dispatched},error.code==='invalid_input'?400:error.code==='rate_limited'?429:503);
 }
}
