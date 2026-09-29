import type {Context} from 'hono';
import {StaffCertificateError,type StaffCertificateExchange,type StaffCertificateAction} from '@waitron-cloud/remote-access/staff-exchange';
import {readAccountBody} from './request.ts';
import {AccountHttpError} from './errors.ts';
import type {RateRule} from './rate-limit.ts';
export async function staffCertificateResponse(c:Context,options:{exchange?:StaffCertificateExchange;ip:string;consume:(rules:RateRule[])=>Promise<void>}){
 if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
 if(c.req.header('origin')!==undefined)throw new AccountHttpError(403,'forbidden');
 if(!options.exchange)throw new AccountHttpError(503,'temporarily_unavailable');
 await options.consume([{scope:'installation-ip',subject:options.ip,limit:60,windowSeconds:60}]);
 const envelope=await readAccountBody(c.req.raw,['payload','signature']),action=c.req.path.slice('/api/installations/'.length) as StaffCertificateAction;
 const claims=await options.exchange.authenticate(action,envelope);
 await options.consume([{scope:'installation-key',subject:claims.installationId,limit:30,windowSeconds:60}]);
 try{return c.json(await options.exchange.execute(action,envelope));}
 catch(error){if(error instanceof StaffCertificateError)throw new AccountHttpError(error.code==='conflict'?409:400,error.code);throw error;}
}
