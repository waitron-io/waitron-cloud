import type {Context} from 'hono';
import type {Pool} from 'pg';
import {ReplacementStore} from '@waitron-cloud/backups/replacement';
import type {CaptureOptions} from '@waitron-cloud/backups/captures';
import {readAccountBody} from './request.ts';
import {AccountHttpError} from './errors.ts';
import type {RateRule} from './rate-limit.ts';
export async function replacementResponse(c:Context,options:{pool:Pool;origin:string;ip:string;captures?:CaptureOptions;consume:(rules:RateRule[])=>Promise<void>}){
 const action=c.req.path.split('/').at(-1)!;
 if(!['prepare','status'].includes(action))throw new AccountHttpError(404,'not_found');
 if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
 if(c.req.header('origin')!==undefined)throw new AccountHttpError(403,'forbidden');
 if(!options.captures)throw new AccountHttpError(503,'temporarily_unavailable');
 await options.consume([{scope:'replacement-ip',subject:options.ip,limit:30,windowSeconds:60}]);
 const body=await readAccountBody(c.req.raw,['id','payload','signature','keySignature']);
 const envelope={id:body.id!,payload:body.payload!,signature:body.signature!,keySignature:body.keySignature!},store=new ReplacementStore(options.pool,options.captures.vault,options.origin,options.captures.planMode);
 try{
  const claims=await store.authenticate(action as 'prepare'|'status',envelope);
  await options.consume([{scope:'replacement-key',subject:claims.publicKey,limit:30,windowSeconds:60}]);
  // The owner view names its selected source; Waitron's exact machine contract predates that field.
  const {source: _ownerSource, ...machineView}=await store.machine(action as 'prepare'|'status',envelope);
  return c.json(machineView);
 }catch(error){
  const code=error instanceof Error?error.message:'';
  const statuses:Record<string,400|401|403|409|410>={'backup.invalid_proof':401,'backup.permission_denied':403,'backup.local_integration_only':403,'backup.revoked':403,'backup.unavailable':410,'backup.conflict':409,'backup.target_not_fresh':409};
  if(statuses[code])throw new AccountHttpError(statuses[code],code.slice(7));throw error;
 }
}
