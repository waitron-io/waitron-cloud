import type {Context} from 'hono';
import type {Pool} from 'pg';
import {resolveSession} from '@waitron-cloud/identity';
import {transaction} from '@waitron-cloud/registration';
import {readSessionCookie} from './cookies.ts';
import {readAccountBody} from './request.ts';
import {AccountHttpError} from './errors.ts';
import type {RateRule} from './rate-limit.ts';
const uuid=(s:string)=>/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(s);
function cursor(value:string|undefined,venueId:string):string|null{
 if(value===undefined)return null;
 try{
  if(!value.length||value.length>256||!/^[A-Za-z0-9_-]+$/.test(value))throw Error();
  const decoded=Buffer.from(value,'base64url');if(decoded.toString('base64url')!==value)throw Error();
  const fields:unknown=JSON.parse(decoded.toString('utf8'));
  if(!Array.isArray(fields)||fields.length!==2||fields[0]!==venueId||typeof fields[1]!=='string'||!uuid(fields[1]))throw Error();
  return fields[1];
 }catch{throw new AccountHttpError(400,'invalid_input');}
}
export async function backupResponse(c:Context,options:{pool:Pool;origin:string;consume:(rules:RateRule[])=>Promise<void>}):Promise<Response>{
 const {pool,origin,consume}=options;
 if(c.req.path!=='/api/account/backups/list')throw new AccountHttpError(404,'not_found');
 if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
 if(c.req.header('origin')!==origin)throw new AccountHttpError(403,'forbidden');
 const token=readSessionCookie(c,new URL(origin).protocol==='https:')??'',csrfToken=c.req.header('x-csrf-token')??'';
 const body=await readAccountBody(c.req.raw,['venueId'],['cursor']),venueId=body.venueId!;
 if(!uuid(venueId))throw new AccountHttpError(400,'invalid_input');
 const after=cursor(body.cursor,venueId);
 const identity=await transaction(pool,client=>resolveSession(client,token,{csrfToken,touch:false}));
 await consume([{scope:'backup-account',subject:identity.accountId,limit:30,windowSeconds:60}]);
 return c.json(await transaction(pool,async client=>{
  const session=await resolveSession(client,token,{csrfToken,touch:false});
  const permission=await client.query(`SELECT m.account_id FROM organisation_memberships m JOIN venues v ON v.organisation_id=m.organisation_id WHERE v.id=$1 AND m.account_id=$2 AND m.is_owner FOR SHARE OF m`,[venueId,session.accountId]);
  if(!permission.rowCount)throw new AccountHttpError(403,'forbidden');
  // Tombstoned points retain their ordering key, so a cleanup between pages cannot skip history.
  if(after&&!(await client.query('SELECT 1 FROM backup_points WHERE id=$1 AND venue_id=$2',[after,venueId])).rowCount)throw new AccountHttpError(400,'invalid_input');
  const result=await client.query(`SELECT p.id,p.captured_at,p.verification,p.retention,
   p.captured_at+CASE p.retention WHEN 'daily' THEN interval '30 days' ELSE interval '12 months' END AS expires_at,
   CASE WHEN EXISTS(SELECT 1 FROM backup_recoveries r WHERE r.point_id=p.id AND r.status<>'closed' AND r.expires_at>clock_timestamp()) THEN 'recovery'
    WHEN p.id=(SELECT q.id FROM backup_points q WHERE q.venue_id=$1 AND q.kind='snapshot' AND NOT q.deleting AND q.deleted_at IS NULL ORDER BY EXISTS(SELECT 1 FROM backup_verifications v WHERE v.point_id=q.id AND v.outcome='verified') DESC,q.captured_at DESC,q.id DESC LIMIT 1) THEN 'fallback' ELSE NULL END AS protection
   FROM backup_points p WHERE p.venue_id=$1 AND p.kind='snapshot' AND NOT p.deleting AND p.deleted_at IS NULL
   AND ($2::uuid IS NULL OR (p.captured_at,p.id)<(SELECT captured_at,id FROM backup_points WHERE id=$2 AND venue_id=$1))
   ORDER BY p.captured_at DESC,p.id DESC LIMIT 51`,[venueId,after]);
  const defaultPoint=(await client.query("SELECT id FROM backup_points WHERE venue_id=$1 AND kind='snapshot' AND verification='verified' AND NOT deleting AND deleted_at IS NULL ORDER BY captured_at DESC,id DESC LIMIT 1",[venueId])).rows[0];
  const points=result.rows.slice(0,50).map(p=>({id:p.id as string,capturedAt:p.captured_at.toISOString() as string,verification:p.verification as string,retention:p.retention as string,expiresAt:p.expires_at.toISOString() as string,protection:p.protection as string|null}));
  await resolveSession(client,token,{csrfToken,touch:false});
  return {venueId,points,nextCursor:result.rows.length>50?Buffer.from(JSON.stringify([venueId,points.at(-1)!.id])).toString('base64url'):null,defaultPointId:defaultPoint?.id??null,continuousRecoveryAvailable:false};
 }));
}
