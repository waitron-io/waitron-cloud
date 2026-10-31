import {Resolver} from 'node:dns/promises';
import type {Context} from 'hono';
import type {Pool,PoolClient} from 'pg';
import {resolveSession} from '@waitron-cloud/identity';
import {transaction,readVenuePlan,type PlanMode} from '@waitron-cloud/registration';
import {ForwardObservationStore} from '@waitron-cloud/remote-access/forward-observations';
import {RemoteAccessStore} from '@waitron-cloud/remote-access/placement';
import {isUuid,isHostname} from '@waitron-cloud/remote-access/manifest';
import {readSessionCookie} from './cookies.ts';
import {readAccountBody} from './request.ts';
import {AccountHttpError} from './errors.ts';
import type {RateRule} from './rate-limit.ts';
export type RemoteResolver=(hostname:string)=>Promise<string[]>;
async function boundedResolve(name:string,custom?:RemoteResolver):Promise<string[]>{
 const resolver=custom?undefined:new Resolver({timeout:1000,tries:1});let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([(custom??(n=>resolver!.resolveCname(n)))(name),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('dns_not_verified')),3000);})]);}
 finally{clearTimeout(timer);resolver?.cancel();}
}
export async function remoteAccessResponse(c:Context,options:{pool:Pool;origin:string;consume:(rules:RateRule[])=>Promise<void>;resolve?:RemoteResolver;planMode?:PlanMode}):Promise<Response>{
 const {pool,origin,consume}=options,action=c.req.path.slice('/api/account/remote-access/'.length);
 if(!['status','dns','apply'].includes(action))throw new AccountHttpError(404,'not_found');
 if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
 if(c.req.header('origin')!==origin)throw new AccountHttpError(403,'forbidden');
 const fields=action==='status'?['installationId']:action==='dns'?['installationId','kind','hostname']:['installationId','kind','hostname','expectedRevision'];
 const body=await readAccountBody(c.req.raw,fields),id=body.installationId!;
 if(!isUuid(id)||(action!=='status'&&(!['staff','public'].includes(body.kind!)||!isHostname(body.hostname)))||(action==='apply'&&(!/^\d+$/.test(body.expectedRevision!)||!Number.isSafeInteger(Number(body.expectedRevision)))))throw new AccountHttpError(400,'invalid_input');
 const token=readSessionCookie(c,new URL(origin).protocol==='https:')??'',csrfToken=c.req.header('x-csrf-token')??'';
 const authorize=async(client:PoolClient)=>{
  const session=await resolveSession(client,token,{csrfToken,touch:false});
  // Match revocation's account/session/membership/installation order; hold ownership through commit.
  const permission=await client.query(`SELECT m.account_id FROM organisation_memberships m JOIN venues v ON v.organisation_id=m.organisation_id JOIN installations i ON i.venue_id=v.id WHERE i.id=$1 AND m.account_id=$2 AND m.is_owner FOR SHARE OF m`,[id,session.accountId]);
  if(!permission.rowCount)throw new AccountHttpError(403,'permission_denied');return session.accountId;
 };
 const account=await transaction(pool,authorize);
 await consume([{scope:'remote-account',subject:account,limit:30,windowSeconds:60}]);
 const status=()=>transaction(pool,async client=>{
  await authorize(client);
  const binding=(await client.query('SELECT venue_id FROM installations WHERE id=$1',[id])).rows[0];
  // Policy locks precede installation locks, including when existing-plan mode skips policy reads.
  await client.query('SELECT o.id FROM organisations o JOIN venues v ON v.organisation_id=o.id WHERE v.id=$1 ORDER BY o.id FOR SHARE OF o',[binding.venue_id]);
  const paid=await readVenuePlan(client,binding.venue_id,options.planMode??'existing')==='paid';
  const installation=(await client.query('SELECT configuration_revision,revoked_at,lease_expires_at FROM installations WHERE id=$1 FOR SHARE',[id])).rows[0];
  const p=(await client.query(`SELECT p.venue_id,c.suffix,s.hostname AS staff,u.hostname AS public FROM remote_placements p JOIN remote_cells c ON c.id=p.cell_id JOIN remote_hostnames s ON s.venue_id=p.venue_id AND s.kind='staff' JOIN remote_hostnames u ON u.venue_id=p.venue_id AND u.kind='public' WHERE p.installation_id=$1`,[id])).rows[0];
  const service=(await client.query("SELECT s.state,o.health,o.observed_at,o.received_at,o.revision FROM installation_services s LEFT JOIN installation_observations o USING(installation_id,service) WHERE s.installation_id=$1 AND s.service='remote_access'",[id])).rows[0];
  const publicForward=action==='status'?await new ForwardObservationStore(pool,options.planMode).readCurrent(client,id):undefined;
  await authorize(client);
  const deadline=Math.min(service?.observed_at?.getTime()+300000,service?.received_at?.getTime()+300000,installation.lease_expires_at?.getTime());
  const current=paid&&!installation.revoked_at&&service?.revision===installation.configuration_revision&&deadline>Date.now();
  return {...(action==='status'?{publicForward}:{}),installationId:id,revision:installation.configuration_revision,revoked:!!installation.revoked_at,names:p?{staff:{assigned:`staff-v-${p.venue_id}.${p.suffix}`,current:p.staff},public:{assigned:`v-${p.venue_id}.${p.suffix}`,current:p.public}}:null,service:{state:paid?(service?.state??'unconfigured'):'unconfigured',health:current?service.health:'unknown',observedAt:service?.observed_at?.toISOString()??null,validUntil:current?new Date(deadline).toISOString():null}};
 });
 try{
  if(action==='status')return c.json(await status());
  const store=new RemoteAccessStore(pool,options.planMode),kind=body.kind as 'staff'|'public';
  if(action==='dns'){
   const records=await store.hostnameInstructions(id,kind,body.hostname!);await transaction(pool,authorize);
   return c.json({installationId:id,kind,hostname:body.hostname!,records});
  }
  await store.setHostname(id,kind,body.hostname!,Number(body.expectedRevision),name=>boundedResolve(name,options.resolve),authorize);
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
