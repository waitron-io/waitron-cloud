import {organisationScopeSql} from '@waitron-cloud/identity';
import {createHash,randomUUID} from 'node:crypto';
import type {Context} from 'hono';
import type {Pool,PoolClient} from 'pg';
import {resolveSession} from '@waitron-cloud/identity';
import {BillingStore,BillingError,LifecycleStore,LifecycleError,lifecycleDownloadDeadline,requireConnectionProof,transaction,readBillingVenue,readBillingPrice,chargeTotals,readVenueHistory,effectiveVenueLevel,mayStartTrial,type TrialView,type BillingLevel} from '@waitron-cloud/registration';
import {readAccountBody} from './request.ts';
import {readSessionCookie} from './cookies.ts';
import {AccountHttpError} from './errors.ts';
import type {BillingAccountOptions} from './config.ts';
import type {RateRule} from './rate-limit.ts';

const backupEndPath='/api/account/billing/schedule-test-backup-end';
const backupEndOperation='894e1a8b-639f-40a3-808a-8f9a4f6e70d7';
export const billingAccountPaths=['/api/account/billing/read','/api/account/billing/start-trial','/api/account/billing/tax/save',backupEndPath];
type VenueRow={id:string;organisation_id:string;legal_business_id:string;environment:string};
type TaxProfile={legalName:string|null;address:string|null;taxNumber:string|null};
type ConnectedPrice={currency:'EUR';netCents:number;grossCents:number};
type MethodPanel={selected:'card'|'direct_debit'|null;setup:{kind:'card'|'direct_debit';state:'pending'|'failed'|'verified'}|null};
type BackupDates={effectiveEndAt:string;deadlineAt:string};
type ExitState={revision:number;blocked:boolean;effective_end_at:Date|null;deadline_at:Date|null};
export type BillingAccountView={venues:{venueId:string;level:BillingLevel;trial:TrialView|null;canStartTrial:boolean;connectedPrice?:ConnectedPrice;paymentMethods?:MethodPanel;taxProfile?:TaxProfile;backupEnd?:BackupDates&{scheduled:boolean}}[]};
function denied():never{throw new AccountHttpError(403,'permission_denied');}
function conflict():never{throw new AccountHttpError(409,'conflict');}
async function verified(client:PoolClient,accountId:string):Promise<void>{
 if(!(await client.query('SELECT account_id FROM cloud_credentials WHERE account_id=$1 AND email_verified_at IS NOT NULL FOR SHARE',[accountId])).rowCount)denied();
}
async function membership(client:PoolClient,accountId:string,organisationId:string):Promise<void>{
 if(!(await client.query(`SELECT account_id FROM organisation_memberships WHERE account_id=$1 AND organisation_id=$2 AND is_owner AND ${organisationScopeSql('account_id','organisation_id')} FOR SHARE`,[accountId,organisationId])).rowCount)denied();
}
async function exitState(client:PoolClient,venueId:string,lock=false):Promise<ExitState|undefined>{
 const {rows:[state]}=await client.query<ExitState>(`SELECT l.revision, o.effective_end_at, o.deadline_at,
  (l.state<>'active' OR l.effective_end_at IS NOT NULL OR EXISTS(SELECT 1 FROM data_lifecycle_operations
   WHERE venue_id=l.venue_id AND kind IN ('cancel','delete'))) AS blocked
  FROM data_lifecycles l LEFT JOIN data_lifecycle_operations o ON o.venue_id=l.venue_id AND o.operation_id=$2 AND o.kind='cancel'
  WHERE l.venue_id=$1 ${lock?'FOR UPDATE OF l':''}`,[venueId,backupEndOperation]);
 return state;
}
function savedBackupEnd(state:ExitState|undefined):BackupDates|undefined{
 if(state?.effective_end_at&&state.deadline_at)return {effectiveEndAt:state.effective_end_at.toISOString(),deadlineAt:state.deadline_at.toISOString()};
}
async function scheduleBackupEnd(client:PoolClient,store:LifecycleStore,accountId:string,token:string,csrfToken:string,venueId:string,trialEndsOn:string){
 const proof=async()=>{if((await requireConnectionProof(client,token,csrfToken)).accountId!==accountId)denied();};
 await proof();
 await verified(client,accountId);
 const {rows:[venue]}=await client.query<VenueRow>("SELECT id,organisation_id,legal_business_id,environment FROM venues WHERE id=$1 AND environment='test'",[venueId]);
 if(!venue)denied();
 await membership(client,accountId,venue.organisation_id);
 if(!(await client.query('SELECT id FROM organisations WHERE id=$1 FOR SHARE',[venue.organisation_id])).rowCount)denied();
 const scope=[venue.organisation_id,venue.legal_business_id,venueId];
 if(!(await client.query("SELECT id FROM venues WHERE organisation_id=$1 AND legal_business_id=$2 AND id=$3 AND environment='test' FOR UPDATE",scope)).rowCount)denied();
 const state=await exitState(client,venueId,true),saved=savedBackupEnd(state),effectiveEndAt=`${trialEndsOn}T00:00:00.000Z`;
 if(saved){
  if(saved.effectiveEndAt!==effectiveEndAt)conflict();
  await proof();
  return {venueId,...saved};
 }
 if(state?.blocked)conflict();
 const {rows:[trial]}=await client.query<{ends_on:string}>(`SELECT ends_on::text FROM billing_trials
  WHERE organisation_id=$1 AND legal_business_id=$2 AND venue_id=$3 AND level='connected' AND state='active'
   AND (clock_timestamp() AT TIME ZONE 'UTC')::date>=started_on AND (clock_timestamp() AT TIME ZONE 'UTC')::date<ends_on FOR SHARE`,scope);
 if(trial?.ends_on!==trialEndsOn)conflict();
 await store.requestOn(client,{venueId,operationId:backupEndOperation,expectedRevision:state?.revision??0,kind:'cancel',
  fingerprint:createHash('sha256').update(trialEndsOn).digest('hex'),effectiveEndAt});
 const dates=savedBackupEnd(await exitState(client,venueId));
 if(!dates)conflict();
 // A request that waited for locks cannot commit using proof or a trial that expired in the meantime.
 await proof();
 if(!(await client.query('SELECT 1 WHERE clock_timestamp()<$1::timestamptz',[effectiveEndAt])).rowCount)conflict();
 return {venueId,...dates};
}
async function readConnectedPrice(client:PoolClient,venueId:string,on:string):Promise<ConnectedPrice|undefined>{
 try{
  const price=await readBillingPrice(client,{on});
  const {netCents,grossCents}=chargeTotals([{venueId,kind:'connected_month',quantity:1,cents:price.prices.connectedMonthlyCents}],price.vatRateBasisPoints);
  return {currency:price.currency,netCents,grossCents};
 }catch(error){
  if(error instanceof BillingError&&error.code==='billing_price_unavailable')return undefined;
  throw error;
 }
}
async function readView(client:PoolClient,accountId:string,methodsEnabled=false,backupEndEnabled=false):Promise<BillingAccountView>{
 await verified(client,accountId);
 const venues=(await client.query<VenueRow>(`SELECT v.id,v.organisation_id,v.legal_business_id,v.environment FROM venues v
  JOIN organisation_memberships m ON m.organisation_id=v.organisation_id AND m.account_id=$1 AND m.is_owner AND ${organisationScopeSql('m.account_id','m.organisation_id')} ORDER BY v.id`,[accountId])).rows;
 for(const organisationId of [...new Set(venues.map(row=>row.organisation_id))].sort())await membership(client,accountId,organisationId);
 const today=(await client.query("SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS day")).rows[0].day;
 const pricedVenue=venues.find(row=>row.environment==='test');
 const connectedPrice=pricedVenue?await readConnectedPrice(client,pricedVenue.id,today):undefined;
 const result:BillingAccountView={venues:[]};
 for(const row of venues){
  const scope={organisationId:row.organisation_id,legalBusinessId:row.legal_business_id},context={client,scope};
  const venue=await readBillingVenue(context,row.id),history=await readVenueHistory(context,row.id);
  const trial=history.trials.find(trial=>trial.level==='connected'&&trial.state==='active'&&trial.startedOn<=today&&today<trial.endsOn)??null;
  let backupEnd:BackupDates&{scheduled:boolean}|undefined;
  if(backupEndEnabled&&row.environment==='test'){
   const state=await exitState(client,row.id),saved=savedBackupEnd(state);
   if(saved)backupEnd={...saved,scheduled:true};
   else if(trial&&!state?.blocked){
    const end=new Date(`${trial.endsOn}T00:00:00.000Z`);
    backupEnd={effectiveEndAt:end.toISOString(),deadlineAt:lifecycleDownloadDeadline(end).toISOString(),scheduled:false};
   }
  }
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
  const taxProfile=row.environment==='test'?(await client.query<TaxProfile>(`SELECT name AS "legalName",billing_address AS address,tax_number AS "taxNumber"
   FROM legal_businesses b WHERE b.id=$1 AND b.organisation_id=$2 AND NOT EXISTS(
    SELECT 1 FROM venues v WHERE v.legal_business_id=b.id AND v.organisation_id=b.organisation_id AND v.environment<>'test')`,[row.legal_business_id,row.organisation_id])).rows[0]:undefined;
  result.venues.push({...(row.environment==='test'&&connectedPrice?{connectedPrice}:{}),
   ...(paymentMethods?{paymentMethods}:{}),...(taxProfile?{taxProfile}:{}),venueId:row.id,level:effectiveVenueLevel(venue.level,history.trials,today),
   ...(backupEnd?{backupEnd}:{}),trial,
   canStartTrial:row.environment==='test'&&mayStartTrial('connected',{trialled:history.trials.map(trial=>trial.level),paid:history.paid.map(period=>period.level)})});
 }
 return result;
}
export async function billingAccountResponse(c:Context,options:{pool:Pool;origin:string;consume:(rules:RateRule[])=>Promise<void>;billing?:Readonly<BillingAccountOptions>;methodsEnabled?:boolean;backupEndEnabled?:boolean}):Promise<Response>{
 const {pool,origin,consume,billing}=options;
 if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
 if(c.req.header('origin')!==origin)throw new AccountHttpError(403,'forbidden');
 if(!billing)throw new AccountHttpError(503,'temporarily_unavailable');
 const token=readSessionCookie(c,new URL(origin).protocol==='https:')??'',proof={touch:false,csrfToken:c.req.header('x-csrf-token')??''};
 const initial=await transaction(pool,client=>resolveSession(client,token,proof));
 if(!billing.accountIds.includes(initial.accountId))denied();
 await consume([{scope:'billing-account',subject:initial.accountId,limit:30,windowSeconds:60}]);
 const start=c.req.path==='/api/account/billing/start-trial',saveTax=c.req.path==='/api/account/billing/tax/save',schedule=c.req.path===backupEndPath;
 if(schedule&&!options.backupEndEnabled)throw new AccountHttpError(503,'temporarily_unavailable');
 const body=await readAccountBody(c.req.raw,saveTax?['venueId','legalName','address','taxNumber']:schedule?['venueId','trialEndsOn']:start?['venueId']:[]);
 if((start||saveTax||schedule)&&!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(body.venueId!))throw new AccountHttpError(400,'invalid_input');
 if(schedule&&(!/^\d{4}-\d{2}-\d{2}$/.test(body.trialEndsOn!)||!Number.isFinite(Date.parse(body.trialEndsOn!))||new Date(body.trialEndsOn!).toISOString().slice(0,10)!==body.trialEndsOn))throw new AccountHttpError(400,'invalid_input');
 if(saveTax)for(const [field,limit] of Object.entries({legalName:200,address:600,taxNumber:32})){
  const value=body[field]!;if(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value)||!value.trim()||value.trim().length>limit)throw new AccountHttpError(400,'invalid_input');
  body[field]=value.trim();
 }
 const read=()=>transaction(pool,async client=>{
  const session=await resolveSession(client,token,proof);if(session.accountId!==initial.accountId)denied();
  const view=await readView(client,session.accountId,options.methodsEnabled,options.backupEndEnabled);await resolveSession(client,token,proof);return view;
 });
 try{
  if(schedule)return c.json(await transaction(pool,client=>scheduleBackupEnd(client,new LifecycleStore(pool),initial.accountId,token,proof.csrfToken,body.venueId!,body.trialEndsOn!)));
  if(saveTax)return c.json(await transaction(pool,async client=>{
   const session=await resolveSession(client,token,proof);if(session.accountId!==initial.accountId)denied();
   await verified(client,session.accountId);
   const venue=(await client.query<VenueRow>('SELECT id,organisation_id,legal_business_id,environment FROM venues WHERE id=$1',[body.venueId])).rows[0];
   if(!venue||venue.environment!=='test')denied();
   await membership(client,session.accountId,venue.organisation_id);
   await client.query('SELECT id FROM organisations WHERE id=$1 FOR SHARE',[venue.organisation_id]);
   if(!(await client.query('SELECT id FROM legal_businesses WHERE id=$1 AND organisation_id=$2 FOR UPDATE',[venue.legal_business_id,venue.organisation_id])).rowCount)denied();
   // The business lock prevents a new venue's foreign-key check from passing during the save.
   const current=await client.query(`SELECT id FROM venues WHERE id=$1 AND organisation_id=$2 AND legal_business_id=$3 AND environment='test'
    AND NOT EXISTS(SELECT 1 FROM venues WHERE organisation_id=$2 AND legal_business_id=$3 AND environment<>'test')`,[venue.id,venue.organisation_id,venue.legal_business_id]);
   if(!current.rowCount)denied();
   await client.query('UPDATE legal_businesses SET name=$1,billing_address=$2,tax_number=$3 WHERE id=$4 AND organisation_id=$5',
    [body.legalName,body.address,body.taxNumber,venue.legal_business_id,venue.organisation_id]);
   const view=await readView(client,session.accountId,options.methodsEnabled,options.backupEndEnabled);
   await resolveSession(client,token,proof);return view;
  }));
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
   const view=await readView(client,session.accountId,options.methodsEnabled,options.backupEndEnabled);
   await resolveSession(client,token,proof);
   const finalDay=(await client.query("SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS day")).rows[0].day;
   if(finalDay!==on)throw new AccountHttpError(409,'conflict');
   return view;
  }));
 }catch(error){
  if(schedule&&(error instanceof LifecycleError||error instanceof AccountHttpError&&error.status===409))conflict();
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
