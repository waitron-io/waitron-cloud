import type {Context} from 'hono';
import {RelayError,RelayMessageError,type RelayMessages,type RelayAction} from '@waitron-cloud/registration';
import {AccountHttpError} from './errors.ts';
import {readAccountBody} from './request.ts';
import type {RateRule} from './rate-limit.ts';
export async function relayMessageResponse(c:Context,options:{relay:RelayMessages;ip:string;consume:(rules:RateRule[])=>Promise<void>}){
 if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
 if(c.req.header('origin')!==undefined)throw new AccountHttpError(403,'forbidden');
 await options.consume([{scope:'installation-ip',subject:options.ip,limit:60,windowSeconds:60}]);
 const envelope=await readAccountBody(c.req.raw,['payload','signature']),action=('email-'+c.req.path.split('/').at(-1)) as RelayAction;
 const claims=await options.relay.authenticate(action,envelope);
 await options.consume([{scope:'installation-key',subject:claims.installationId,limit:30,windowSeconds:60}]);
 try{const result=await options.relay.execute(action,envelope);return c.json(result.status,result.created?202:200);}
 catch(error){
  if(error instanceof RelayError||error instanceof RelayMessageError){
   const code=error.code==='invalid_input'?'invalid_message':error.code;
   if(code==='invalid_message')throw new AccountHttpError(400,code);
   if(code==='grant_unavailable'||code==='relay_disabled')throw new AccountHttpError(403,code);
   if(code==='message_conflict')throw new AccountHttpError(409,code);
   if(code==='allowance_exhausted')throw new AccountHttpError(429,code,60);
   throw new AccountHttpError(503,'relay_unavailable',1);
  }
  throw error;
 }
}
