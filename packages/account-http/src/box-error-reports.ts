import type {Context} from 'hono';
import {BoxErrorReportError,type BoxErrorReports} from '@waitron-cloud/registration';
import {AccountHttpError} from './errors.ts';
import {readAccountBody} from './request.ts';
import type {RateRule} from './rate-limit.ts';

export async function boxErrorResponse(c:Context,options:{machine?:BoxErrorReports;ip:string;consume:(rules:RateRule[])=>Promise<void>}){
 if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
 if(c.req.header('origin')!==undefined)throw new AccountHttpError(403,'forbidden');
 if(!options.machine)throw new AccountHttpError(503,'temporarily_unavailable');
 const action=c.req.path.endsWith('/error-report')?'error-report':'release-held';
 await options.consume([{scope:'box-error-ip',subject:options.ip,limit:60,windowSeconds:60}]);
 const envelope=await readAccountBody(c.req.raw,['payload','signature']),signed={payload:envelope.payload!,signature:envelope.signature!};
 const claims=await options.machine.authenticate(action,signed);
 await options.consume([{scope:action+'-key',subject:claims.installationId,limit:action==='error-report'?10:30,windowSeconds:60}]);
 try{return c.json(await options.machine.execute(action,signed));}
 catch(error){if(error instanceof BoxErrorReportError)throw new AccountHttpError(error.code==='conflict'?409:400,error.code);throw error;}
}
