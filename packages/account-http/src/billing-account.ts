import {randomUUID} from 'node:crypto';
import type {Context} from 'hono';
import type {Pool,PoolClient} from 'pg';
import {resolveSession} from '@waitron-cloud/identity';
import {BillingStore,BillingError,transaction,readBillingVenue,readVenueHistory,effectiveVenueLevel,mayStartTrial,type TrialView,type BillingLevel} from '@waitron-cloud/registration';
import {readAccountBody} from './request.ts';
import {readSessionCookie} from './cookies.ts';
import {AccountHttpError} from './errors.ts';
import type {BillingAccountOptions} from './config.ts';
import type {RateRule} from './rate-limit.ts';

export const billingAccountPaths=['/api/account/billing/read','/api/account/billing/start-trial'];
type VenueRow={id:string;organisation_id:string;legal_business_id:string;environment:string};
type MethodPanel={selected:'card'|'direct_debit'|null;setup:{kind:'card'|'direct_debit';state:'pending'|'failed'|'verified'}|null};
export type BillingAccountView={venues:{venueId:string;level:BillingLevel;trial:TrialView|null;canStartTrial:boolean;paymentMethods?:MethodPanel}[]};
function denied():never{throw new AccountHttpError(403,'permission_denied');}
async function verified(client:PoolClient,accountId:string):Promise<void>{
 if(!(await client.query('SELECT account_id FROM cloud_credentials WHERE account_id=$1 AND email_verified_at IS NOT NULL FOR SHARE',[accountId])).rowCount)denied();
}
async function membership(client:PoolClient,accountId:string,organisationId:string):Promise<void>{
 if(!(await client.query('SELECT account_id FROM organisation_memberships WHERE account_id=$1 AND organisation_id=$2 AND is_owner FOR SHARE',[accountId,organisationId])).rowCount)denied();
}
async function readView(client:PoolClient,accountId:string,methodsEnabled=false):Promise<BillingAccountView>{
 await verified(client,accountId);
 const venues=(await client.query<VenueRow>(`SELECT v.id,v.organisation_id,v.legal_business_id,v.environment FROM venues v
  JOIN organisation_memberships m ON m.organisation_id=v.organisation_id AND m.account_id=$1 AND m.is_owner ORDER BY v.id`,[accountId])).rows;
 for(const organisationId of [...new Set(venues.map(row=>row.organisation_id))].sort())await membership(client,accountId,organisationId);
 const today=(await client.query("SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS day")).rows[0].day;
 const result:BillingAccountView={venues:[]};
 for(const row of venues){
  const scope={organisationId:row.organisation_id,legalBusinessId:row.legal_business_id},context={client,scope};
  const venue=await readBillingVenue(context,row.id),history=await readVenueHistory(context,row.id);
  let paymentMethods:MethodPanel|undefined;
  if(methodsEnabled&&row.environment==='test'){
   const method=(await client.query(`SELECT selected.kind AS selected,setup.kind AS setup_kind,
    completed.id AS completed
    FROM legal_businesses business
    LEFT JOIN billing_businesses billing ON billing.organisation_id=business.organisation_id AND billing.legal_business_id=business.id
    LEFT JOIN billing_payment_methods selected ON selected.organisation_id=business.organisation_id AND selected.legal_business_id=business.id AND selected.id=billing.current_method_id
    LEFT JOIN billing_method_setups setup ON setup.organisation_id=business.organisation_id AND setup.legal_business_id=business.id AND setup.owner_id=$3
    LEFT JOIN billing_payment_methods completed ON completed.organisation_id=business.organisation_id AND completed.legal_business_id=business.id AND completed.id=setup.method_id
    WHERE business.organisation_id=$1 AND business.id=$2`,[scope.organisationId,scope.legalBusinessId,accountId])).rows[0];
   // A saved intent does not say whether the provider is still working or has refused it.
   paymentMethods={selected:method?.selected??null,setup:method?.setup_kind?{kind:method.setup_kind,
    state:method.completed?'verified':'pending'}:null};
  }
  result.venues.push({...(paymentMethods?{paymentMethods}:{}),venueId:row.id,level:effectiveVenueLevel(venue.level,history.trials,today),
   trial:history.trials.find(trial=>trial.level==='connected'&&trial.state==='active'&&trial.startedOn<=today&&today<trial.endsOn)??null,
   canStartTrial:row.environment==='test'&&mayStartTrial('connected',{trialled:history.trials.map(trial=>trial.level),paid:history.paid.map(period=>period.level)})});
 }
 return result;
}
export async function billingAccountResponse(c:Context,options:{pool:Pool;origin:string;consume:(rules:RateRule[])=>Promise<void>;billing?:Readonly<BillingAccountOptions>;methodsEnabled?:boolean}):Promise<Response>{
 const {pool,origin,consume,billing}=options;
 if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
 if(c.req.header('origin')!==origin)throw new AccountHttpError(403,'forbidden');
 if(!billing)throw new AccountHttpError(503,'temporarily_unavailable');
 const token=readSessionCookie(c,new URL(origin).protocol==='https:')??'',proof={touch:false,csrfToken:c.req.header('x-csrf-token')??''};
 const initial=await transaction(pool,client=>resolveSession(client,token,proof));
 if(!billing.accountIds.includes(initial.accountId))denied();
 await consume([{scope:'billing-account',subject:initial.accountId,limit:30,windowSeconds:60}]);
 const start=c.req.path==='/api/account/billing/start-trial',body=await readAccountBody(c.req.raw,start?['venueId']:[]);
 if(start&&!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(body.venueId!))throw new AccountHttpError(400,'invalid_input');
 const read=()=>transaction(pool,async client=>{
  const session=await resolveSession(client,token,proof);if(session.accountId!==initial.accountId)denied();
  const view=await readView(client,session.accountId,options.methodsEnabled);await resolveSession(client,token,proof);return view;
 });
 try{
  if(!start)return c.json(await read());
  const store=new BillingStore(pool);
  return c.json(await transaction(pool,async client=>{
   const session=await resolveSession(client,token,proof);if(session.accountId!==initial.accountId)denied();
   await verified(client,session.accountId);
   const venue=(await client.query<VenueRow>('SELECT id,organisation_id,legal_business_id,environment FROM venues WHERE id=$1',[body.venueId])).rows[0];
   if(!venue||venue.environment!=='test')denied();
   await membership(client,session.accountId,venue.organisation_id);
   const scope={organisationId:venue.organisation_id,legalBusinessId:venue.legal_business_id};
   const event=()=>({key:randomUUID(),occurredAt:new Date().toISOString(),source:{kind:'internal' as const}});
   await store.executeOn(client,scope,event(),{type:'ensure_business'});
   const now:Date=(await client.query('SELECT clock_timestamp() AS now')).rows[0].now,on=now.toISOString().slice(0,10);
   await store.transitionOn(client,scope,{key:randomUUID(),occurredAt:now.toISOString(),source:{kind:'internal'}},{type:'start_trial',venueId:venue.id,level:'connected',on});
   const view=await readView(client,session.accountId,options.methodsEnabled);
   await resolveSession(client,token,proof);
   const finalDay=(await client.query("SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS day")).rows[0].day;
   if(finalDay!==on)throw new AccountHttpError(409,'conflict');
   return view;
  }));
 }catch(error){
  if(error instanceof BillingError){
   if(error.code==='billing_scope_not_found')denied();
   if(error.code==='invalid_billing_input')throw new AccountHttpError(400,'invalid_input');
   return c.json({error:'conflict',...await read()},409);
  }
  if(error instanceof Error&&error.message==='permission_denied')denied();
  if(error instanceof AccountHttpError&&error.status===409)return c.json({error:'conflict',...await read()},409);
  throw error;
 }
}
