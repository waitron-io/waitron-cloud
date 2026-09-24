import type {Context} from 'hono';
import type {Pool} from 'pg';
import {resolveSession} from '@waitron-cloud/identity';
import {transaction} from '@waitron-cloud/registration';
import {RecoveryRequests} from '@waitron-cloud/backups/recovery-request';
import {BackupRecovery} from '@waitron-cloud/backups/recovery';
import type {CaptureOptions} from '@waitron-cloud/backups/captures';
import {readSessionCookie} from './cookies.ts';
import {readAccountBody} from './request.ts';
import {AccountHttpError} from './errors.ts';
import type {RateRule} from './rate-limit.ts';
export async function recoveryResponse(c:Context,options:{pool:Pool;origin:string;ip:string;captures?:CaptureOptions;consume:(rules:RateRule[])=>Promise<void>}){
 const {pool,origin,captures,consume}=options;
 if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
 if(!captures)throw new AccountHttpError(503,'temporarily_unavailable');
 const owner=c.req.path.startsWith('/api/account/'),action=c.req.path.split('/').at(-1)!;
 if(!(owner?['inspect','approve','close']:['start','status','info','read','restored']).includes(action))throw new AccountHttpError(404,'not_found');
 if(owner?c.req.header('origin')!==origin:c.req.header('origin')!==undefined)throw new AccountHttpError(403,'forbidden');
 const requests=new RecoveryRequests(pool,captures.vault,origin),recovery=new BackupRecovery(pool,captures.vault,origin);
 try{
  if(owner){
   const token=readSessionCookie(c,new URL(origin).protocol==='https:')??'',csrf=c.req.header('x-csrf-token')??'';
   const session=await transaction(pool,client=>resolveSession(client,token,{csrfToken:csrf,touch:false}));
   await consume([{scope:'recovery-account',subject:session.accountId,limit:30,windowSeconds:60}]);
   const body=await readAccountBody(c.req.raw,['requestId','code',...(action==='approve'?['pointId','oldServerUnavailable','acceptDataLoss']:[])]),id=body.requestId!,code=body.code!;
   if(action==='approve')return c.json(await requests.approve(id,code,token,csrf,{pointId:body.pointId!,oldServerUnavailable:body.oldServerUnavailable==='true',acceptDataLoss:body.acceptDataLoss==='true'}));
   const view=await requests.inspect(id,code,token,csrf);
   if(action==='close'){
    if(!view.operationId)throw new AccountHttpError(409,'approval_required');
    await recovery.close(token,csrf,view.operationId);return c.json(await requests.inspect(id,code,token,csrf));
   }
   return c.json(view);
  }
  await consume([{scope:'recovery-ip',subject:options.ip,limit:30,windowSeconds:60}]);
  const body=await readAccountBody(c.req.raw,action==='start'||action==='status'?['payload','signature']:['id','payload','signature']);
  const proof={payload:body.payload!,signature:body.signature!};
  if(action==='start'||action==='status')return c.json(await requests.machine(action,proof));
  if(action==='info')return c.json(await recovery.target(body.id!,'info',proof));
  if(action==='restored'){await recovery.target(body.id!,'restored',proof);return c.json({status:'restored'});}
  const first=await recovery.target(body.id!,'read',proof);
  const grant=await captures.grant(first.location,{kind:'restore',bucket:first.location.bucket,scope:first.point.objectKey});
  // Owner cancellation can commit while the provider issues credentials. Recheck before disclosing keys.
  const current=await recovery.target(body.id!,'read',proof),expires=Date.parse(grant.expiresAt);
  if(!Number.isFinite(expires)||expires<=Date.now()||expires>Date.now()+901000||!grant.credentials.accessKeyId||!grant.credentials.secretAccessKey||!grant.credentials.sessionToken)throw new AccountHttpError(503,'temporarily_unavailable');
  return c.json({point:current.point,location:current.location,recoveryKey:current.keys.recoveryKey,operationExpiresAt:current.operationExpiresAt,...grant});
 }catch(error){
  const code=error instanceof Error?error.message:'';
  const statuses:Record<string,400|401|403|409|410>={'backup.invalid_proof':401,'backup.permission_denied':403,'backup.local_integration_only':403,'backup.unavailable':410,'backup.conflict':409,'backup.target_not_fresh':409,'backup.recovery_active':409,'backup.confirmation_required':400,'backup.invalid_input':400,'backup.unverified':400};
  if(statuses[code])throw new AccountHttpError(statuses[code],code.slice(7));throw error;
 }
}
