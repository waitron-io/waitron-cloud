import {venueOverview} from './venue-overview.ts';
import type {Context} from 'hono';
import type {Pool} from 'pg';
import {resolveSession} from '@waitron-cloud/identity';
import {InstallationStore,transaction,type LeaseIssuer,type MachineAction} from '@waitron-cloud/registration';
import {readAccountBody} from './request.ts';
import {readSessionCookie} from './cookies.ts';
import {AccountHttpError} from './errors.ts';
import type {RateRule} from './rate-limit.ts';
export async function installationResponse(c:Context,options:{pool:Pool;issuer?:LeaseIssuer;origin:string;ip:string;consume:(rules:RateRule[])=>Promise<void>}):Promise<Response>{
 const {pool,issuer,origin,ip,consume}=options,machine=c.req.path.startsWith('/api/installations/');
 const action=c.req.path.slice((machine?'/api/installations/':'/api/account/installations').length);
 if(!(machine?['renew','configuration','report','revoke']:['','/revoke']).includes(action))throw new AccountHttpError(404,'not_found');
 if(c.req.method!==(action===''?'GET':'POST'))throw new AccountHttpError(405,'method_not_allowed');
 if(!issuer)throw new AccountHttpError(503,'temporarily_unavailable');
 const store=new InstallationStore(pool,issuer,origin);
 if(machine){
  if(c.req.header('origin')!==undefined)throw new AccountHttpError(403,'forbidden');
  await consume([{scope:'installation-ip',subject:ip,limit:60,windowSeconds:60}]);
  const body=await readAccountBody(c.req.raw,['payload','signature']);
  const claims=await store.authenticate(action as MachineAction,body);
  await consume([{scope:'installation-key',subject:claims.installationId,limit:30,windowSeconds:60}]);
  return c.json(await store.execute(action as MachineAction,body));
 }
 if(c.req.method==='POST'&&c.req.header('origin')!==origin)throw new AccountHttpError(403,'forbidden');
 const token=readSessionCookie(c,new URL(origin).protocol==='https:')??'',csrf=c.req.header('x-csrf-token')??'';
 const session=await transaction(pool,client=>resolveSession(client,token,{touch:false,...(action===''?{}:{csrfToken:csrf})}));
 await consume([{scope:'installation-account',subject:session.accountId,limit:30,windowSeconds:60}]);
 if(action==='')return c.json({installations:await venueOverview(pool,token,await store.listWithSession(token))});
 const body=await readAccountBody(c.req.raw,['installationId']);return c.json(await store.revokeWithSession(token,csrf,body.installationId!));
}
