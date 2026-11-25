import {organisationScopeSql} from '@waitron-cloud/identity';
import {guestMenuStatus} from '@waitron-cloud/remote-access/guest-menu';
import {boundedResolveCname,type ResolveCname} from '@waitron-cloud/remote-access/dns-lookup';
import type {Context} from 'hono';
import type {Pool,PoolClient} from 'pg';
import {resolveSession} from '@waitron-cloud/identity';
import {transaction,readVenuePlan,readVenuePermissions,requireConnectionProof,requirePendingConnectionProof,type PlanMode} from '@waitron-cloud/registration';
import {ForwardObservationStore} from '@waitron-cloud/remote-access/forward-observations';
import {RemoteAccessStore} from '@waitron-cloud/remote-access/placement';
import {isUuid,isHostname} from '@waitron-cloud/remote-access/manifest';
import {readSessionCookie} from './cookies.ts';
import {readAccountBody} from './request.ts';
import {AccountHttpError} from './errors.ts';
import type {RateRule} from './rate-limit.ts';
export type RemoteResolver=ResolveCname;
export async function remoteAccessResponse(c:Context,options:{pool:Pool;origin:string;consume:(rules:RateRule[])=>Promise<void>;resolve?:RemoteResolver;planMode?:PlanMode;guestOrigin?:string}):Promise<Response>{
 const {pool,origin,consume}=options,action=c.req.path.slice('/api/account/remote-access/'.length);
 if(!['status','dns','apply','recheck'].includes(action))throw new AccountHttpError(404,'not_found');
 if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
 if(c.req.header('origin')!==origin)throw new AccountHttpError(403,'forbidden');
 const fields=action==='status'?['installationId']:action==='recheck'?['installationId','kind']:action==='dns'?['installationId','kind','hostname']:['installationId','kind','hostname','expectedRevision'];
 const body=await readAccountBody(c.req.raw,fields),id=body.installationId!;
 if(!isUuid(id)||(action!=='status'&&!['staff','public'].includes(body.kind!))||((action==='dns'||action==='apply')&&!isHostname(body.hostname))||(action==='apply'&&(!/^\d+$/.test(body.expectedRevision!)||!Number.isSafeInteger(Number(body.expectedRevision)))))throw new AccountHttpError(400,'invalid_input');
 const token=readSessionCookie(c,new URL(origin).protocol==='https:')??'',csrfToken=c.req.header('x-csrf-token')??'';
 const ownership=async(client:PoolClient,accountId:string)=>{
  // Match revocation's account/session/membership/installation order; hold ownership through commit.
  const permission=await client.query(`SELECT m.account_id FROM organisation_memberships m JOIN venues v ON v.organisation_id=m.organisation_id JOIN installations i ON i.venue_id=v.id WHERE i.id=$1 AND m.account_id=$2 AND m.is_owner AND ${organisationScopeSql('m.account_id','m.organisation_id')} FOR SHARE OF m`,[id,accountId]);
  if(!permission.rowCount)throw new AccountHttpError(403,'permission_denied');return accountId;
 };
 const admitted=await transaction(pool,async client=>{
  const session=await resolveSession(client,token,{csrfToken,touch:false});
  await ownership(client,session.accountId);
  return session;
 });
 const account=admitted.accountId;
 await consume([{scope:'remote-account',subject:account,limit:30,windowSeconds:60}]);
 const proof=action==='apply'?await transaction(pool,async client=>{
  const proof=await requireConnectionProof(client,token,csrfToken);await ownership(client,proof.accountId);return proof;
 }):undefined;
 const authorize=async(client:PoolClient)=>{
  // Accepted hostname work retains its session authority through DNS, without a new idle or prompt deadline.
  if(proof){await requirePendingConnectionProof(client,proof.accountId,proof.sessionId,proof.securityRevision);return ownership(client,proof.accountId);}
  const session=await resolveSession(client,token,{csrfToken,touch:false});return ownership(client,session.accountId);
 };
 const status=()=>transaction(pool,async client=>{
  await authorize(client);
  const binding=(await client.query('SELECT venue_id FROM installations WHERE id=$1',[id])).rows[0];
  // Policy locks precede installation locks, including when existing-plan mode skips policy reads.
  await client.query('SELECT o.id FROM organisations o JOIN venues v ON v.organisation_id=o.id WHERE v.id=$1 ORDER BY o.id FOR SHARE OF o',[binding.venue_id]);
  const permission=options.planMode==='test-venue-levels'?await readVenuePermissions(client,binding.venue_id,options.planMode):undefined;
  const paid=permission?permission.level==='connected'||permission.level==='hosted':await readVenuePlan(client,binding.venue_id,options.planMode??'existing')==='paid';
  const installation=(await client.query('SELECT configuration_revision,revoked_at,lease_expires_at FROM installations WHERE id=$1 FOR SHARE',[id])).rows[0];
  const venueEmail=permission&&paid&&!installation.revoked_at?{available:true,
   replyTo:(await client.query<{waitron_mail_reply_to:string|null}>('SELECT waitron_mail_reply_to FROM venues WHERE id=$1',[binding.venue_id])).rows[0]!.waitron_mail_reply_to}:undefined;
  const names=(await client.query(`SELECT h.kind,h.assigned_hostname,h.hostname,h.record_moved_at
   FROM remote_placements p JOIN remote_hostnames h ON h.venue_id=p.venue_id
   WHERE p.installation_id=$1`,[id])).rows;
  const name=(kind:'staff'|'public')=>{
   const row=names.find(r=>r.kind===kind);
   return row?{assigned:row.assigned_hostname,current:row.hostname,recordMoved:row.hostname!==row.assigned_hostname&&row.record_moved_at!==null}:null;
  };
  const staff=name('staff'),publicName=name('public');
  const service=(await client.query("SELECT s.state,o.health,o.observed_at,o.received_at,o.revision FROM installation_services s LEFT JOIN installation_observations o USING(installation_id,service) WHERE s.installation_id=$1 AND s.service='remote_access'",[id])).rows[0];
  const includeForward=action==='status'||action==='recheck';
  const publicForward=includeForward?await new ForwardObservationStore(pool,options.planMode).readCurrent(client,id):undefined;
  await authorize(client);
  const deadline=Math.min(service?.observed_at?.getTime()+300000,service?.received_at?.getTime()+300000,installation.lease_expires_at?.getTime());
  const current=paid&&!installation.revoked_at&&service?.revision===installation.configuration_revision&&deadline>Date.now();
  return {...(venueEmail?{venueEmail}:{}),...(options.guestOrigin?{guestMenu:{venueId:binding.venue_id,...await guestMenuStatus(client,binding.venue_id,options.guestOrigin)}}:{}),...(includeForward?{publicForward}:{}),...(permission?.level==='registered'?{connectedRequired:true}:{}),installationId:id,revision:installation.configuration_revision,revoked:!!installation.revoked_at,names:staff&&publicName?{staff,public:publicName}:null,service:{state:paid?(service?.state??'unconfigured'):'unconfigured',health:current?service.health:'unknown',observedAt:service?.observed_at?.toISOString()??null,validUntil:current?new Date(deadline).toISOString():null}};
 });
 try{
  if(action==='status')return c.json(await status());
  const store=new RemoteAccessStore(pool,options.planMode),kind=body.kind as 'staff'|'public';
  if(action==='dns'){
   const records=await store.hostnameInstructions(id,kind,body.hostname!);await transaction(pool,authorize);
   return c.json({installationId:id,kind,hostname:body.hostname!,records});
  }
  if(action==='recheck'){
   await store.recheckHostname(id,kind,options.resolve,authorize);
   return c.json(await status());
  }
  await store.setHostname(id,kind,body.hostname!,Number(body.expectedRevision),name=>boundedResolveCname(name,options.resolve),authorize);
  return c.json(await status());
 }catch(error){
  if(error instanceof AccountHttpError)throw error;
  if(error instanceof Error){
   if(['invalid_hostname','hostname_conflict','dns_not_verified','invalid_placement'].includes(error.message))throw new AccountHttpError(400,error.message);
   if(error.message==='revision_conflict')throw new AccountHttpError(409,error.message);
   const refusal=error.message==='revoked'?'revoked':error.message==='permission_denied'?
    error.cause==='test_venue_required'?'remote_test_only':error.cause==='remote_plan_required'||error.cause==='remote_setup_required'?error.cause:undefined:undefined;
   if(refusal){
    // Store refusals can precede the post-DNS owner check; recheck before revealing their cause.
    await transaction(pool,authorize);
    throw new AccountHttpError(403,refusal);
   }
   if(error.message==='permission_denied')throw new AccountHttpError(403,'forbidden');
   if(error.message==='installation_unavailable')throw new AccountHttpError(409,'remote_not_placed');
  }
  throw error;
 }
}
