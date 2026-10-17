import type {Context} from 'hono';
import type {BackupCaptures,CaptureAction} from '@waitron-cloud/backups/captures';
import {readAccountBody} from './request.ts';
import {AccountHttpError} from './errors.ts';
import type {RateRule} from './rate-limit.ts';
export async function captureResponse(c:Context,options:{captures?:BackupCaptures;ip:string;consume:(rules:RateRule[])=>Promise<void>}){
 if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
 if(c.req.header('origin')!==undefined)throw new AccountHttpError(403,'forbidden');
 if(!options.captures)throw new AccountHttpError(503,'temporarily_unavailable');
 await options.consume([{scope:'installation-ip',subject:options.ip,limit:60,windowSeconds:60}]);
 const envelope=await readAccountBody(c.req.raw,['payload','signature']);const action=c.req.path.slice('/api/installations/'.length) as CaptureAction;
 const claims=await options.captures.authenticate(action,envelope);
 await options.consume([{scope:'installation-key',subject:claims.installationId,limit:30,windowSeconds:60}]);
 try{return c.json(await options.captures.execute(action,envelope));}
 catch(error){
  const code=error instanceof Error?error.message:'';
  const status:Record<string,400|403|409|410>={'backup.invalid_metadata':400,'backup.object_mismatch':409,'backup.conflict':409,'backup.capture_expired':410,'backup.permission_denied':403,'backup.revoked':403,'backup.local_integration_only':403};
  if(status[code])throw new AccountHttpError(status[code],code.slice(7));throw error;
 }
}
