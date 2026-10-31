import type {PoolClient} from 'pg';
import {billingDate} from './billing-config.ts';
import {BillingError,type BillingContext,type BillingLevel,type BillingScope,type BillingValue,type PermissionCommand,type TrialView} from './billing-types.ts';
import {applyVenueCommand,readBillingVenue,readVenueHistory} from './billing-venues.ts';
import {effectiveVenueLevel,levelAllows,paidGrantWindow,type VenueService} from './venue-service-rules.ts';
import {planAllows,readVenuePlan,type PlanMode,type PlanService} from './organisation-plans.ts';

export type VenuePermission=BillingScope&{venueId:string;level:BillingLevel;revision:number};
type Authority={revision:string;setup_grant_active:boolean;setup_grant_until:string|null};
type Facts={level:BillingLevel;trials:TrialView[]};
const maxRevision=Number.MAX_SAFE_INTEGER;
function args(scope:BillingScope,venueId:string){return [scope.organisationId,scope.legalBusinessId,venueId];}
async function authority(client:PoolClient,scope:BillingScope,venueId:string):Promise<Authority|undefined>{
 return (await client.query<Authority>('SELECT revision,setup_grant_active,setup_grant_until::text FROM billing_service_authority WHERE organisation_id=$1 AND legal_business_id=$2 AND venue_id=$3 FOR UPDATE',args(scope,venueId))).rows[0];
}
async function facts(client:PoolClient,scope:BillingScope,venueId:string):Promise<Facts>{
 const context={client,scope};
 return {level:(await readBillingVenue(context,venueId)).level,trials:(await readVenueHistory(context,venueId)).trials};
}
async function today(client:PoolClient):Promise<string>{
 return billingDate((await client.query("SELECT (clock_timestamp() AT TIME ZONE 'UTC')::date::text AS day")).rows[0]?.day);
}
function elapsed(row:Authority,day:string):boolean{return row.setup_grant_active&&row.setup_grant_until!==null&&row.setup_grant_until<=day;}
function requireAdvance(row:Authority):void{
 if(Number(row.revision)>=maxRevision)throw new BillingError('billing_state_conflict');
}
async function installations(client:PoolClient,venueId:string,clear:boolean):Promise<void>{
 const rows=(await client.query('SELECT id FROM installations WHERE venue_id=$1 ORDER BY id FOR UPDATE',[venueId])).rows;
 for(const {id} of rows){
  await client.query('UPDATE installations SET configuration_revision=configuration_revision+1 WHERE id=$1',[id]);
  if(clear)await client.query("UPDATE installation_services SET state='unconfigured',configuration='{}' WHERE installation_id=$1 AND service IN ('continuous_backup','retained_snapshots','remote_access')",[id]);
 }
}
async function save(client:PoolClient,scope:BillingScope,venueId:string,row:Authority|undefined,current:Facts,day:string,advance:boolean,expired:boolean):Promise<number>{
 const window=paidGrantWindow(current.level,current.trials,day),revision=row?Number(row.revision)+(advance?1:0):1;
 if(row&&advance)requireAdvance(row);
 if(advance)await installations(client,venueId,expired||window===null);
 if(!row){
  await client.query('INSERT INTO billing_service_authority(organisation_id,legal_business_id,venue_id,revision,setup_grant_active,setup_grant_until) VALUES($1,$2,$3,$4,$5,$6)',[...args(scope,venueId),revision,window!==null,window?.until??null]);
 }else if(advance||row.setup_grant_active!==(window!==null)||row.setup_grant_until!==(window?.until??null)){
  await client.query('UPDATE billing_service_authority SET revision=$4,setup_grant_active=$5,setup_grant_until=$6 WHERE organisation_id=$1 AND legal_business_id=$2 AND venue_id=$3',[...args(scope,venueId),revision,window!==null,window?.until??null]);
 }
 return revision;
}

// The existing parent row fences absent authority and billing children before any setup lock.
export async function applyPermissionTransition(context:BillingContext,command:PermissionCommand,enrol:boolean):Promise<BillingValue>{
 const {client,scope}=context,venueId=command.venueId;
 const venue=(await client.query('SELECT environment FROM venues WHERE organisation_id=$1 AND legal_business_id=$2 AND id=$3 FOR NO KEY UPDATE',args(scope,venueId))).rows[0];
 if(!venue)throw new BillingError('billing_scope_not_found');
 let old=await authority(client,scope,venueId);
 if(!old&&!enrol)return applyVenueCommand(context,command);
 if(venue.environment!=='test')throw new Error('permission_denied');
 const day=await today(client),before=await facts(client,scope,venueId),expired=old?elapsed(old,day):false;
 // Overflow must refuse before either facts or persisted setup can be changed.
 if(old&&(expired||command.type!=='set_venue'||before.level!==command.value.level))requireAdvance(old);
 if(old&&expired){
  await installations(client,venueId,true);
  await client.query('UPDATE billing_service_authority SET revision=revision+1,setup_grant_active=false,setup_grant_until=NULL WHERE organisation_id=$1 AND legal_business_id=$2 AND venue_id=$3',args(scope,venueId));
  old={revision:String(Number(old.revision)+1),setup_grant_active:false,setup_grant_until:null};
 }
 const value=await applyVenueCommand(context,command),after=await facts(client,scope,venueId);
 const changed=!old||(!expired&&JSON.stringify(before)!==JSON.stringify(after));
 await save(client,scope,venueId,old,after,day,changed,expired);
 return value;
}

// Callers retain this transaction through their installation and service admission checks.
export async function readVenuePermissions(client:PoolClient,venueId:string,mode:'test-venue-levels'):Promise<VenuePermission>{
 if(mode!=='test-venue-levels')throw new Error('invalid_plan_mode');
 const resolved=(await client.query('SELECT organisation_id,legal_business_id FROM venues WHERE id=$1',[venueId])).rows[0];
 if(!resolved)throw new Error('permission_denied');
 await client.query('SELECT id FROM organisations WHERE id=$1 FOR SHARE',[resolved.organisation_id]);
 const venue=(await client.query('SELECT organisation_id,legal_business_id,environment FROM venues WHERE id=$1 FOR NO KEY UPDATE',[venueId])).rows[0];
 if(!venue||venue.organisation_id!==resolved.organisation_id||venue.legal_business_id!==resolved.legal_business_id||venue.environment!=='test')throw new Error('permission_denied');
 const scope={organisationId:venue.organisation_id,legalBusinessId:venue.legal_business_id},old=await authority(client,scope,venueId);
 if(!old)return {...scope,venueId,level:'registered',revision:0};
 const day=await today(client),current=await facts(client,scope,venueId),expired=elapsed(old,day);
 const revision=await save(client,scope,venueId,old,current,day,expired,expired);
 return {...scope,venueId,level:effectiveVenueLevel(current.level,current.trials,day),revision};
}
export async function requireVenueService(client:PoolClient,venueId:string,service:VenueService,mode:PlanMode,_lock?:'SHARE'|'NO KEY UPDATE'):Promise<void>{
 if(mode==='existing')return;
 if(mode==='test-free-paid'){
  if(!planAllows(await readVenuePlan(client,venueId,mode),service as PlanService))throw new Error('permission_denied');
  return;
 }
 if(mode!=='test-venue-levels')throw new Error('invalid_plan_mode');
 if(!levelAllows((await readVenuePermissions(client,venueId,mode)).level,service))throw new Error('permission_denied');
}
