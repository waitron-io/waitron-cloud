import type {Context} from 'hono';
import type {Pool,PoolClient} from 'pg';
import {resolveSession} from '@waitron-cloud/identity';
import {BillingError,transaction,type PlanMode} from '@waitron-cloud/registration';
import {BillingMethodSetups,type MethodSetup} from './billing-method-binding.ts';
import {createTestBillingMethodClient} from './billing-method-providers.ts';
import {parseTestBillingProviderAccount,type BillingAccountOptions} from './config.ts';
import {AccountHttpError} from './errors.ts';
import {readSessionCookie} from './cookies.ts';
import {readAccountBody} from './request.ts';
import type {RateRule} from './rate-limit.ts';

export type BillingMethodsOptions={stripeAccount:string;sumupAccount:string;client:ReturnType<typeof createTestBillingMethodClient>};
export function validateBillingMethodsOptions(value:BillingMethodsOptions|undefined,mode:PlanMode,billing:Readonly<BillingAccountOptions>|undefined):Readonly<BillingMethodsOptions>|undefined{
 if(value===undefined)return undefined;
 if(mode!=='test-venue-levels'||!billing)throw new Error('billing_methods.test_mode_required');
 try{
  if(parseTestBillingProviderAccount(value.stripeAccount).provider!=='stripe'||parseTestBillingProviderAccount(value.sumupAccount).provider!=='sumup'
   ||typeof value.client.start!=='function'||typeof value.client.verify!=='function')throw new Error();
 }catch{throw new Error('billing_methods.invalid_config');}
 return Object.freeze({stripeAccount:value.stripeAccount,sumupAccount:value.sumupAccount,
  client:Object.freeze({start:value.client.start.bind(value.client),verify:value.client.verify.bind(value.client)})});
}
export function billingMethodsOptionsFromEnv(env:NodeJS.ProcessEnv,mode:PlanMode,billing:Readonly<BillingAccountOptions>|undefined,portalOrigin:string):Readonly<BillingMethodsOptions>|undefined{
 const selected=env.CLOUD_BILLING_METHODS_MODE??'off';
 if(selected==='off')return undefined;
 if(selected!=='test')throw new Error('billing_methods.invalid_config');
 if(mode!=='test-venue-levels'||!billing)throw new Error('billing_methods.test_mode_required');
 return validateBillingMethodsOptions({stripeAccount:'stripe-test:'+(env.CLOUD_BILLING_STRIPE_TEST_ACCOUNT??''),
  sumupAccount:'sumup-sandbox:'+(env.CLOUD_BILLING_SUMUP_SANDBOX_MERCHANT??''),
  client:createTestBillingMethodClient({stripeKey:env.CLOUD_BILLING_STRIPE_TEST_KEY??'',sumupKey:env.CLOUD_BILLING_SUMUP_SANDBOX_KEY??'',portalOrigin})},mode,billing);
}
type Venue={id:string;organisation_id:string;legal_business_id:string;environment:string};
function denied():never{throw new AccountHttpError(403,'permission_denied');}
function conflict():never{throw new AccountHttpError(409,'conflict');}
function same(a:MethodSetup|null,b:MethodSetup){if(!a||Object.keys(b).some(key=>a[key as keyof MethodSetup]!==b[key as keyof MethodSetup]))conflict();}

export async function billingMethodsResponse(c:Context,options:{pool:Pool;origin:string;consume:(rules:RateRule[])=>Promise<void>;billing?:Readonly<BillingAccountOptions>;methods?:Readonly<BillingMethodsOptions>}):Promise<Response>{
 const {pool,origin,consume,billing,methods}=options;
 if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
 if(c.req.header('origin')!==origin)throw new AccountHttpError(403,'forbidden');
 if(!billing||!methods)throw new AccountHttpError(503,'temporarily_unavailable');
 const token=readSessionCookie(c,new URL(origin).protocol==='https:')??'',proof={touch:false,csrfToken:c.req.header('x-csrf-token')??''};
 const initial=await transaction(pool,client=>resolveSession(client,token,proof));
 if(!billing.accountIds.includes(initial.accountId))denied();
 await consume([{scope:'billing-account',subject:initial.accountId,limit:30,windowSeconds:60}]);
 const start=c.req.path.endsWith('/start'),body=await readAccountBody(c.req.raw,start?['venueId','kind']:['venueId']);
 if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(body.venueId!)
  ||start&&!['card','direct_debit'].includes(body.kind!))throw new AccountHttpError(400,'invalid_input');
 const setups=new BillingMethodSetups(pool);
 async function guard(client:PoolClient,expected?:MethodSetup){
  const session=await resolveSession(client,token,proof);if(session.accountId!==initial.accountId)denied();
  if(!(await client.query('SELECT account_id FROM cloud_credentials WHERE account_id=$1 AND email_verified_at IS NOT NULL FOR SHARE',[session.accountId])).rowCount)denied();
  const venue=(await client.query<Venue>('SELECT id,organisation_id,legal_business_id,environment FROM venues WHERE id=$1',[body.venueId])).rows[0];
  if(!venue||venue.environment!=='test')denied();
  if(expected&&(venue.organisation_id!==expected.organisationId||venue.legal_business_id!==expected.legalBusinessId))denied();
  if(!(await client.query('SELECT account_id FROM organisation_memberships WHERE account_id=$1 AND organisation_id=$2 AND is_owner FOR SHARE',[session.accountId,venue.organisation_id])).rowCount)denied();
  const scope={organisationId:venue.organisation_id,legalBusinessId:venue.legal_business_id},saved=await setups.readOn(client,scope);
  const final=(await client.query<Venue>('SELECT id,organisation_id,legal_business_id,environment FROM venues WHERE id=$1 FOR SHARE',[body.venueId])).rows[0];
  if(!final||final.environment!=='test'||final.organisation_id!==venue.organisation_id||final.legal_business_id!==venue.legal_business_id)denied();
  if(saved&&(!start||expected)&&(saved.ownerId!==session.accountId
   ||saved.providerAccountId!==(saved.kind==='card'?methods!.sumupAccount:methods!.stripeAccount)))denied();
  if(expected)same(saved,expected);
  await resolveSession(client,token,proof);
  return {scope,saved};
 }
 try{
  const setup=await transaction(pool,async client=>{
   const {scope,saved}=await guard(client);
   if(!start)return saved;
   const created=await setups.createOn(client,scope,initial.accountId,body.kind as 'card'|'direct_debit',body.kind==='card'?methods!.sumupAccount:methods!.stripeAccount);
   await guard(client,created);return created;
  });
  if(!setup||!start&&(!setup.customerId||!setup.providerReference))return c.json({state:'failed'});
  const authorize=()=>transaction(pool,async client=>{await guard(client,setup);});
  if(start){
   const result=await methods.client.start(setup,authorize);
   await transaction(pool,async client=>{await guard(client,setup);const bound=await setups.bindOn(client,setup,result);await guard(client,bound);});
   return c.json(result.presentation);
  }
  const complete=await transaction(pool,async client=>{
   await guard(client,setup);
   return !!(await client.query('SELECT id FROM billing_payment_methods WHERE organisation_id=$1 AND legal_business_id=$2 AND id=$3',[setup.organisationId,setup.legalBusinessId,setup.methodId])).rowCount;
  });
  if(complete)return c.json({state:'verified'});
  const result=await methods.client.verify(setup,authorize);
  await transaction(pool,async client=>{
   await guard(client,setup);
   if(result.state==='verified')await setups.completeOn(client,setup,result);
   await guard(client,setup);
  });
  return c.json({state:result.state});
 }catch(error){
  if(error instanceof BillingError){
   if(error.code==='billing_scope_not_found')denied();
   throw new AccountHttpError(409,'conflict');
  }
  if(error instanceof Error&&error.message==='permission_denied')denied();
  if(error instanceof Error&&error.message.startsWith('billing_methods.'))throw new AccountHttpError(503,'temporarily_unavailable');
  throw error;
 }
}
