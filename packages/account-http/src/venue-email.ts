import {organisationScopeSql,resolveSession} from '@waitron-cloud/identity';
import {normaliseEmail,readVenuePermissions,transaction} from '@waitron-cloud/registration';
import {isUuid} from '@waitron-cloud/remote-access/manifest';
import type {Context} from 'hono';
import type {Pool} from 'pg';
import {readSessionCookie} from './cookies.ts';
import {AccountHttpError} from './errors.ts';
import type {RateRule} from './rate-limit.ts';
import {readAccountBody} from './request.ts';

export async function venueEmailResponse(c:Context, options:{pool:Pool;origin:string;secure:boolean;ip:string;consume:(rules:RateRule[])=>Promise<void>}):Promise<Response>{
 const {pool,origin,secure,ip,consume}=options;
 if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
 if(c.req.header('origin')!==origin)throw new AccountHttpError(403,'forbidden');
 await consume([{scope:'venue-email-ip',subject:ip,limit:60,windowSeconds:60}]);
 const body=await readAccountBody(c.req.raw,['installationId','replyTo']);
 const installationId=body.installationId!,replyTo=normaliseEmail(body.replyTo);
 if(!isUuid(installationId)||!replyTo)throw new AccountHttpError(400,'invalid_input');
 const token=readSessionCookie(c,secure)??'',csrfToken=c.req.header('x-csrf-token')??'';
 return c.json(await transaction(pool,async client=>{
  const session=await resolveSession(client,token,{csrfToken,touch:false});
  const venue=(await client.query<{id:string;organisation_id:string}>(`SELECT v.id,v.organisation_id
   FROM organisation_memberships m JOIN venues v ON v.organisation_id=m.organisation_id JOIN installations i ON i.venue_id=v.id
   WHERE i.id=$1 AND v.environment='test' AND m.account_id=$2 AND m.is_owner AND ${organisationScopeSql('m.account_id','m.organisation_id')}
   FOR SHARE OF m`,[installationId,session.accountId])).rows[0];
  if(!venue)throw new AccountHttpError(403,'permission_denied');
  // Hold ownership and venue policy through the save. Policy locks precede the installation lock.
  const permission=await readVenuePermissions(client,venue.id,'test-venue-levels');
  const active=(await client.query(`SELECT 1 FROM installations WHERE id=$1 AND venue_id=$2
   AND revoked_at IS NULL AND superseded_by IS NULL FOR SHARE`,[installationId,venue.id])).rowCount;
  if(!active||permission.organisationId!==venue.organisation_id)throw new AccountHttpError(403,'permission_denied');
  if(permission.level!=='connected'&&permission.level!=='hosted')throw new AccountHttpError(403,'permission_denied');
  await client.query('UPDATE venues SET waitron_mail_reply_to=$2 WHERE id=$1',[venue.id,replyTo]);
  return {available:true,replyTo};
 }));
}
