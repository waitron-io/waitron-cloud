import type {Context} from 'hono';
import {OwnerRecoveryError,InstallationError,type OwnerRecoveryStore,type MachineAction} from '@waitron-cloud/registration';
import {readAccountBody} from './request.ts';
import {AccountHttpError} from './errors.ts';
import {writeSessionCookies} from './cookies.ts';
import type {RateRule} from './rate-limit.ts';
export async function ownerRecoveryResponse(c:Context,o:{store?:OwnerRecoveryStore;origin:string;secure:boolean;ip:string;consume:(rules:RateRule[])=>Promise<void>}):Promise<Response>{
 const machine=c.req.path.startsWith('/api/installations/'),action=c.req.path.slice((machine?'/api/installations/':'/api/account/owner-recovery/').length);
 if(!(machine?['owner-recovery-read','owner-recovery-approve','owner-recovery-refuse']:['begin','select','status','complete']).includes(action))throw new AccountHttpError(404,'not_found');
 if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
 if(machine?c.req.header('origin')!==undefined:c.req.header('origin')!==o.origin)throw new AccountHttpError(403,'forbidden');
 if(!o.store)throw new AccountHttpError(503,'temporarily_unavailable');
 try{
  if(machine){
   await o.consume([{scope:'installation-ip',subject:o.ip,limit:60,windowSeconds:60}]);
   const body=await readAccountBody(c.req.raw,['payload','signature']);
   const claims=await o.store.authenticate(action as MachineAction,body);
   await o.consume([{scope:'installation-key',subject:claims.installationId,limit:30,windowSeconds:60}]);
   return c.json(await o.store.machine(action as MachineAction,body));
  }
  const body=await readAccountBody(c.req.raw,action==='select'?['token','installationId']:action==='complete'?['token','password']:['token'],action==='complete'?['locale']:[]);
  const budget=action==='status'?'/owner-recovery/status':'/password-reset/complete';
  await o.consume([{scope:budget+'-ip',subject:o.ip,limit:10,windowSeconds:900},{scope:budget+'-token',subject:body.token!,limit:10,windowSeconds:900}]);
  if(action==='begin')return c.json(await o.store.begin(body.token!));
  if(action==='select')return c.json(await o.store.select(body.token!,body.installationId!));
  if(action==='status')return c.json(await o.store.status(body.token!));
  const result=await o.store.complete(body.token!,body.password!,body.locale as 'en'|'es'|undefined);
  writeSessionCookies(c,o.secure,result);return c.json({accountId:result.accountId,enrollmentRequired:true});
 }catch(error){
  if(error instanceof InstallationError&&error.code==='conflict')throw new AccountHttpError(409,'conflict');
  if(error instanceof OwnerRecoveryError)throw new AccountHttpError(error.code==='recovery_unavailable'?404:error.code==='recovery_scope_limited'?403:error.code==='password_screening_unavailable'?503:400,error.code);
  throw error;
 }
}
