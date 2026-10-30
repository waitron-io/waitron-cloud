import type {RecoveryCodeKeys} from '@waitron-cloud/backups/recovery-codes';
import {ReplacementStore} from '@waitron-cloud/backups/replacement';
import type {Context} from 'hono';
import type {Pool} from 'pg';
import {resolveSession} from '@waitron-cloud/identity';
import {readVenuePermissions,transaction,type VenuePermission} from '@waitron-cloud/registration';
import {RecoveryRequests,verifyRecoveryRequest} from '@waitron-cloud/backups/recovery-request';
import {BackupRecovery,type RecoveryAccess} from '@waitron-cloud/backups/recovery';
import type {CaptureOptions} from '@waitron-cloud/backups/captures';
import {readSessionCookie} from './cookies.ts';
import {readRecoveryMachineBody} from './recovery-machine-body.ts';
import {readAccountBody} from './request.ts';
import {AccountHttpError} from './errors.ts';
import type {RateRule} from './rate-limit.ts';
function recoveryDestination(access:RecoveryAccess){
 return JSON.stringify('stream' in access
  ?[access.source,access.stream.venueId,access.stream.location,access.stream.prefix,access.stream.readerReference,access.stream.pointerSignerPublicKey,access.stream.localVenueId,access.stream.generation]
  :[access.source,access.point.venueId,access.location,access.point.objectKey,access.point.keyVersion,access.point.digest]);
}
export async function recoveryResponse(c:Context,options:{recoveryCodeKeys:RecoveryCodeKeys|null;pool:Pool;origin:string;ip:string;captures?:CaptureOptions;consume:(rules:RateRule[])=>Promise<void>}){
 const {pool,origin,captures,consume}=options;
 if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
 if(!captures)throw new AccountHttpError(503,'temporarily_unavailable');
 const owner=c.req.path.startsWith('/api/account/'),action=c.req.path.split('/').at(-1)!;
 if(!(owner?['inspect','approve','close','replace']:['start','status','info','read','restored']).includes(action))throw new AccountHttpError(404,'not_found');
 if(owner?c.req.header('origin')!==origin:c.req.header('origin')!==undefined)throw new AccountHttpError(403,'forbidden');
 const replacements=new ReplacementStore(pool,captures.vault,origin,captures.planMode);
 const requests=new RecoveryRequests(pool,captures.vault,origin,options.recoveryCodeKeys,captures.planMode),recovery=new BackupRecovery(pool,captures.vault,origin,undefined,captures.planMode);
 try{
  if(owner){
   const token=readSessionCookie(c,new URL(origin).protocol==='https:')??'',csrf=c.req.header('x-csrf-token')??'';
   const session=await transaction(pool,client=>resolveSession(client,token,{csrfToken:csrf,touch:false}));
   await consume([{scope:'recovery-account',subject:session.accountId,limit:30,windowSeconds:60}]);
   const body=await readAccountBody(c.req.raw,['requestId','code',...(action==='approve'?['oldServerUnavailable','acceptDataLoss']:action==='replace'?['oldInstallationId','oldServerUnavailable','confirmReplacement']:[])],action==='approve'?['source','pointId','venueId']:[]),id=body.requestId!,code=body.code!;
   const withReplacement=async(view:Awaited<ReturnType<typeof requests.inspect>>)=>({...view,replacement:view.operationId?await replacements.inspect(view.operationId,token,csrf):null});
   if(action==='approve'){
    const confirmation={oldServerUnavailable:body.oldServerUnavailable==='true',acceptDataLoss:body.acceptDataLoss==='true'};
    const selection=body.source==='continuous'&&body.venueId&&!body.pointId?{source:'continuous' as const,venueId:body.venueId,...confirmation}
     :(body.source===undefined||body.source==='snapshot')&&body.pointId&&!body.venueId?{source:'snapshot' as const,pointId:body.pointId,...confirmation}:null;
    if(!selection)throw new AccountHttpError(400,'invalid_input');
    return c.json(await withReplacement(await requests.approve(id,code,token,csrf,selection)));
   }
   const view=await requests.inspect(id,code,token,csrf);
   if(action==='replace'){
    if(!view.operationId)throw new AccountHttpError(409,'approval_required');
    await replacements.complete(view.operationId,token,csrf,{oldInstallationId:body.oldInstallationId!,oldServerUnavailable:body.oldServerUnavailable==='true',confirmReplacement:body.confirmReplacement==='true'});
    return c.json(await withReplacement(await requests.inspect(id,code,token,csrf)));
   }
   if(action==='close'){
    if(!view.operationId)throw new AccountHttpError(409,'approval_required');
    await recovery.close(token,csrf,view.operationId);return c.json(await withReplacement(await requests.inspect(id,code,token,csrf)));
   }
   return c.json(await withReplacement(view));
  }
  await consume([{scope:action==='start'?'recovery-start-ip':'recovery-ip',subject:options.ip,limit:action==='start'?10:30,windowSeconds:action==='start'?900:60}]);
  const body=await readRecoveryMachineBody(c.req.raw,action!=='start'&&action!=='status');
  const proof=body;
  const machineJson=(value:Record<string,unknown>)=>{
   if(body.version===2&&Buffer.byteLength(JSON.stringify(value))>65536)throw new AccountHttpError(503,'temporarily_unavailable');
   return c.json(value);
  };
  if(action==='start'||action==='status'){
   const identity=verifyRecoveryRequest(origin,action,proof);
   await consume([{scope:action==='start'?'recovery-start-key':'recovery-key',subject:identity.publicKey,limit:action==='start'?10:30,windowSeconds:action==='start'?900:60}]);
   return machineJson(await requests.machine(action,proof));
  }
  const identity=await recovery.authenticate(body.id!,action as 'info'|'read'|'restored',proof);
  await consume([{scope:'recovery-key',subject:identity.publicKey,limit:30,windowSeconds:60}]);
  if(action==='info')return machineJson(await recovery.target(body.id!,'info',proof));
  if(action==='restored'){await recovery.target(body.id!,'restored',proof);return machineJson({...('version' in body&&body.version===2?{version:2 as const}:{}),status:'restored'});}
  let permission:VenuePermission|undefined,destination:string|undefined;
  const read=async()=>{
   if(captures.planMode!=='test-venue-levels')return recovery.target(body.id!,'read',proof);
   return transaction(pool,async client=>{
    const access=await new BackupRecovery(pool,captures.vault,origin,client,captures.planMode).target(body.id!,'read',proof);
    // Target admission holds venue authority through this snapshot; provider work happens after commit.
    const current=await readVenuePermissions(client,'stream' in access?access.stream.venueId:access.point.venueId,'test-venue-levels');
    if(permission&&(current.revision!==permission.revision||current.organisationId!==permission.organisationId||current.legalBusinessId!==permission.legalBusinessId||current.venueId!==permission.venueId))throw new Error('backup.conflict');
    const currentDestination=recoveryDestination(access);
    if(destination!==undefined&&currentDestination!==destination)throw new Error('backup.conflict');
    permission??=current;destination??=currentDestination;
    return access;
   });
  };
  const first=await read();
  if('stream' in first){
   const reader=captures.managedStreams?.reader;if(!reader)throw new AccountHttpError(503,'temporarily_unavailable');
   const credentials=await reader({reference:first.stream.readerReference,venueId:first.stream.venueId,location:first.stream.location,prefix:first.stream.prefix});
   const current=await read();
   if(!('stream' in current)||!credentials||Object.keys(credentials).sort().join(',')!=='accessKeyId,secretAccessKey'||!credentials.accessKeyId||!credentials.secretAccessKey)throw new AccountHttpError(503,'temporarily_unavailable');
   const recoveryKit='WAITRON-RECOVERY-KIT-1:'+Buffer.from(JSON.stringify({version:1,venueId:current.stream.localVenueId,bucket:{...current.stream.location,prefix:current.stream.prefix,...credentials},recoveryKey:current.stream.recoveryKey,pointerSignerPublicKey:current.stream.pointerSignerPublicKey})).toString('base64url');
   return machineJson({source:current.source,recoveryKit,operationExpiresAt:current.operationExpiresAt});
  }
  const grant=await captures.grant(first.location,{kind:'restore',bucket:first.location.bucket,scope:first.point.objectKey});
  // Owner cancellation can commit while the provider issues credentials. Recheck before disclosing keys.
  const current=await read(),expires=Date.parse(grant.expiresAt);
  if(!Number.isFinite(expires)||expires<=Date.now()||expires>Date.now()+901000||!grant.credentials.accessKeyId||!grant.credentials.secretAccessKey||!grant.credentials.sessionToken)throw new AccountHttpError(503,'temporarily_unavailable');
  if(!('point' in current))throw new AccountHttpError(503,'temporarily_unavailable');
  return machineJson({...('version' in current&&current.version===2?{version:2 as const,verification:current.verification}:{}),point:current.point,location:current.location,recoveryKey:current.keys.recoveryKey,operationExpiresAt:current.operationExpiresAt,...grant});
 }catch(error){
  const code=error instanceof Error?error.message:'';
  const statuses:Record<string,400|401|403|409|410>={'backup.invalid_proof':401,'backup.revoked':403,'backup.permission_denied':403,'backup.local_integration_only':403,'backup.unavailable':410,'backup.conflict':409,'backup.target_not_fresh':409,'backup.recovery_active':409,'backup.confirmation_required':400,'backup.invalid_input':400,'backup.unverified':400};
  if(statuses[code])throw new AccountHttpError(statuses[code],code.slice(7));throw error;
 }
}
