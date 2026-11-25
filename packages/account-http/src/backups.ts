import {Readable} from 'node:stream';
import {organisationScopeSql} from '@waitron-cloud/identity';
import type {BackupCatalogue} from '@waitron-cloud/backups/catalogue';
import {retentionExpirySql} from '@waitron-cloud/backups/retention';
import type {Context} from 'hono';
import type {Pool,PoolClient} from 'pg';
import {resolveSession} from '@waitron-cloud/identity';
import {LifecycleStore,requireConnectionProof,transaction} from '@waitron-cloud/registration';
import {readSessionCookie} from './cookies.ts';
import {readAccountBody} from './request.ts';
import {AccountHttpError} from './errors.ts';
import {securityHeaders} from './portal.ts';
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
async function ownerVenue(client:PoolClient,venueId:string,accountId:string):Promise<string>{
 // Hold ownership through the metadata read so a concurrent revocation cannot pass unnoticed.
 const {rows}=await client.query(`SELECT v.environment FROM organisation_memberships m JOIN venues v ON v.organisation_id=m.organisation_id WHERE v.id=$1 AND m.account_id=$2 AND m.is_owner AND ${organisationScopeSql('m.account_id','m.organisation_id')} FOR SHARE OF m`,[venueId,accountId]);
 if(!rows[0])throw new AccountHttpError(403,'permission_denied');
 return rows[0].environment;
}
export async function backupResponse(c:Context,options:{pool:Pool;origin:string;consume:(rules:RateRule[])=>Promise<void>;exitDownloads?:BackupCatalogue|undefined}):Promise<Response>{
 const {pool,origin,consume,exitDownloads}=options;
 const action=c.req.path.slice('/api/account/backups/'.length);
 if(action!=='list'&&(!exitDownloads||!['download','download-key'].includes(action)))throw new AccountHttpError(404,'not_found');
 if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
 if(c.req.header('origin')!==origin)throw new AccountHttpError(403,'forbidden');
 const token=readSessionCookie(c,new URL(origin).protocol==='https:')??'',csrfToken=c.req.header('x-csrf-token')??'';
 const body=await readAccountBody(c.req.raw,action==='list'?['venueId']:['venueId','pointId'],action==='list'?['cursor']:[]),venueId=body.venueId!;
 if(!uuid(venueId))throw new AccountHttpError(400,'invalid_input');
 const after=action==='list'?cursor(body.cursor,venueId):null;
 const identity=await transaction(pool,client=>resolveSession(client,token,{csrfToken,touch:false}));
 await consume([{scope:'backup-account',subject:identity.accountId,limit:30,windowSeconds:60}]);
 if(action!=='list'&&exitDownloads){
  const pointId=body.pointId!;
  if(!uuid(pointId))throw new AccountHttpError(400,'invalid_input');
  const fence=async(client:PoolClient)=>{
   const proof=await requireConnectionProof(client,token,csrfToken);
   if(await ownerVenue(client,venueId,proof.accountId)!=='test')throw new AccountHttpError(403,'permission_denied');
   if(!(await LifecycleStore.readExitRecovery(client,venueId)).allowed)throw new AccountHttpError(410,'unavailable');
  };
  try{
   if(action==='download-key'){
    const key=await exitDownloads.exitArchiveKey(venueId,pointId,fence);
    return new Response(key+'\n',{headers:{...securityHeaders,'content-type':'text/plain; charset=utf-8',
     'content-disposition':`attachment; filename="waitron-backup-${pointId}.key"`}});
   }
   const source=await exitDownloads.exitArchive(venueId,pointId,fence,c.req.raw.signal);
   try{
    const stream=source.open();
    stream.once('close',()=>{void source.dispose().catch(()=>{});});
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>,{headers:{...securityHeaders,
     'content-type':'application/octet-stream','content-length':String(source.receipt.size),
     'content-disposition':`attachment; filename="waitron-backup-${pointId}.backup.enc"`}});
   }catch(error){await source.dispose();throw error;}
  }catch(error){
   switch(error instanceof Error?error.message:''){
    case 'backup.unverified':throw new AccountHttpError(400,'unverified');
    case 'backup.download_too_large':throw new AccountHttpError(413,'download_too_large');
    case 'backup.local_integration_only':throw new AccountHttpError(403,'permission_denied');
    case 'backup.unavailable':throw new AccountHttpError(410,'unavailable');
    case 'backup.cancelled':case 'backup.key_unavailable':case 'backup.object_invalid':throw new AccountHttpError(503,'temporarily_unavailable',1);
    default:throw error;
   }
  }
 }
 return c.json(await transaction(pool,async client=>{
  const session=await resolveSession(client,token,{csrfToken,touch:false});
  const environment=await ownerVenue(client,venueId,session.accountId);
  // Tombstoned points retain their ordering key, so a cleanup between pages cannot skip history.
  if(after&&!(await client.query('SELECT 1 FROM backup_points WHERE id=$1 AND venue_id=$2',[after,venueId])).rowCount)throw new AccountHttpError(400,'invalid_input');
  const result=await client.query(`SELECT p.id,p.captured_at,COALESCE(qualification.current_verification,'pending') AS verification,p.retention,
   ${retentionExpirySql} AS expires_at,
   CASE WHEN EXISTS(SELECT 1 FROM backup_recoveries r WHERE r.point_id=p.id AND r.status<>'closed' AND r.expires_at>clock_timestamp()) THEN 'recovery'
    WHEN p.id=(SELECT q.id FROM backup_points q WHERE q.venue_id=$1 AND q.kind='snapshot' AND NOT q.deleting AND q.deleted_at IS NULL ORDER BY EXISTS(SELECT 1 FROM backup_verifications v WHERE v.point_id=q.id AND v.outcome='verified') DESC,q.captured_at DESC,q.id DESC LIMIT 1) THEN 'fallback' ELSE NULL END AS protection
   FROM backup_points p LEFT JOIN backup_point_qualification qualification ON qualification.point_id=p.id WHERE p.venue_id=$1 AND p.kind='snapshot' AND NOT p.deleting AND p.deleted_at IS NULL
   AND ($2::uuid IS NULL OR (p.captured_at,p.id)<(SELECT captured_at,id FROM backup_points WHERE id=$2 AND venue_id=$1))
   ORDER BY p.captured_at DESC,p.id DESC LIMIT 51`,[venueId,after]);
  const defaultPoint=(await client.query("SELECT p.id FROM backup_points p JOIN backup_point_qualification q ON q.point_id=p.id WHERE p.venue_id=$1 AND q.current_verification='verified' ORDER BY p.captured_at DESC,p.id DESC LIMIT 1",[venueId])).rows[0];
  const stream=(await client.query(`SELECT s.recoverable_at,s.observed_at,s.source_node_id FROM backup_managed_streams s
   JOIN backup_locations l ON l.venue_id=s.venue_id AND l.installation_id=s.installation_id
   JOIN installations i ON i.id=s.installation_id AND i.configuration_revision=s.configuration_revision
   WHERE s.venue_id=$1 AND i.revoked_at IS NULL AND i.superseded_by IS NULL AND s.generation IS NOT NULL
   AND s.observed_at>clock_timestamp()-interval '5 minutes'`,[venueId])).rows[0];
  const points=result.rows.slice(0,50).map(p=>({id:p.id as string,capturedAt:p.captured_at.toISOString() as string,verification:p.verification as string,retention:p.retention as string,expiresAt:p.expires_at.toISOString() as string,protection:p.protection as string|null}));
  const exit=exitDownloads&&environment==='test'?await LifecycleStore.readExitRecovery(client,venueId):undefined;
  await resolveSession(client,token,{csrfToken,touch:false});
  return {venueId,points,...(exit?.allowed?{exitDownloadAvailable:true}:{}),...(exit?.window?{exitRecovery:exit.window}:{}),
   nextCursor:result.rows.length>50?Buffer.from(JSON.stringify([venueId,points.at(-1)!.id])).toString('base64url'):null,defaultPointId:defaultPoint?.id??null,
   continuousRecovery:stream?{recoverableAt:stream.recoverable_at.toISOString(),checkedAt:stream.observed_at.toISOString(),sourceNodeId:stream.source_node_id}:null};
 }));
}
