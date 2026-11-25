import {organisationScopeSql} from '@waitron-cloud/identity';
import type {Context} from 'hono';
import type {Pool} from 'pg';
import {resolveSession} from '@waitron-cloud/identity';
import {InstallationError,transaction} from '@waitron-cloud/registration';
import {GuestMenuError,type GuestMenuMachine,type GuestMenuAction,guestMenuStatus,writeGuestMenuBlocked} from '@waitron-cloud/remote-access/guest-menu';
import {isUuid} from '@waitron-cloud/remote-access/manifest';
import {readSessionCookie} from './cookies.ts';
import {readAccountBody,readBoundedJsonObject} from './request.ts';
import {AccountHttpError} from './errors.ts';

export async function guestMenuResponse(c:Context,options:{pool:Pool;origin:string;guestOrigin?:string;liveGuestMenu?:boolean}):Promise<Response>{
 const action=c.req.path.slice('/api/account/guest-menu/'.length);
 if(!['takedown','enable'].includes(action))throw new AccountHttpError(404,'not_found');
 if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
 if(c.req.header('origin')!==options.origin)throw new AccountHttpError(403,'forbidden');
 if(!options.guestOrigin&&!options.liveGuestMenu)throw new AccountHttpError(503,'unavailable');
 const body=await readAccountBody(c.req.raw,['venueId']);if(!isUuid(body.venueId))throw new AccountHttpError(400,'invalid_input');
 const token=readSessionCookie(c,new URL(options.origin).protocol==='https:')??'',csrfToken=c.req.header('x-csrf-token')??'';
 return c.json(await transaction(options.pool,async client=>{
  const session=await resolveSession(client,token,{csrfToken,touch:false});
  const owner=await client.query(`SELECT v.environment FROM organisation_memberships m JOIN venues v ON v.organisation_id=m.organisation_id
   WHERE v.id=$1 AND m.account_id=$2 AND m.is_owner AND ($3 OR v.environment='test') AND ${organisationScopeSql('m.account_id','m.organisation_id')} FOR SHARE OF m`,[body.venueId,session.accountId,!!options.guestOrigin]);
  if(!owner.rowCount)throw new AccountHttpError(403,'permission_denied');
  await writeGuestMenuBlocked(client,body.venueId!,action==='takedown');
  const value=await guestMenuStatus(client,body.venueId!,options.guestOrigin??null);
  await resolveSession(client,token,{csrfToken,touch:false});
  return {venueId:body.venueId,...value,...(options.liveGuestMenu&&owner.rows[0].environment==='test'?{live:true}:{})};
 }));
}

export const guestMenuPublishPath='/api/installations/guest-menu-publish',guestMenuReadMs=60000;
export async function guestMenuDeliveryResponse(c:Context,machine?:GuestMenuMachine):Promise<Response>{
 if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
 if(c.req.header('origin')!==undefined)throw new AccountHttpError(403,'forbidden');
 if(!machine)throw new AccountHttpError(503,'unavailable');
 const action=c.req.path.slice('/api/installations/'.length) as GuestMenuAction,publish=action==='guest-menu-publish';
 try{
  const parsed=await readBoundedJsonObject(c.req.raw,publish?12*1048576+16384:16384,publish?guestMenuReadMs:5000);
  const fields=publish?['body','payload','signature']:['payload','signature'];
  if(Object.keys(parsed).sort().join(',')!==fields.join(',')||fields.some(k=>typeof parsed[k]!=='string'))throw new AccountHttpError(400,'invalid_input');
  return c.json(await machine.execute(action,{payload:parsed.payload,signature:parsed.signature},publish?parsed.body as string:undefined));
 }catch(error){
  if(error instanceof GuestMenuError)throw new AccountHttpError(error.code==='blocked'?423:error.code==='conflict'?409:error.code==='forbidden'||error.code==='guest_menu_plan_required'?403:error.code==='too_large'?413:400,error.code);
  if(error instanceof InstallationError)throw new AccountHttpError(403,'forbidden');
  if(error instanceof AccountHttpError){if(error.status===413)throw new AccountHttpError(413,'too_large');throw error;}
  throw new AccountHttpError(503,'unavailable');
 }
}
