import type {Context} from 'hono';
import {BoxErrorReportError,type BoxErrorReports} from '@waitron-cloud/registration';
import {AccountHttpError} from './errors.ts';
import {readAccountBody,readBoundedJsonObject} from './request.ts';
import type {RateRule} from './rate-limit.ts';

export async function boxErrorResponse(c:Context,options:{machine?:BoxErrorReports;ip:string;consume:(rules:RateRule[])=>Promise<void>}){
 if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
 if(c.req.header('origin')!==undefined)throw new AccountHttpError(403,'forbidden');
 if(!options.machine)throw new AccountHttpError(503,'temporarily_unavailable');
 const path=c.req.path.slice('/api/installations/'.length),staff=path==='staff-report'||path==='staff-description';
 const action=staff?path:path==='error-report'?'error-report':'release-held';
 await options.consume([{scope:'box-error-ip',subject:options.ip,limit:60,windowSeconds:60}]);
 let envelope:Record<string,unknown>;
 if(staff){
  envelope=await readBoundedJsonObject(c.req.raw,65536,5000);
  if(Object.keys(envelope).sort().join(',')!=='body,payload,signature'||['body','payload','signature'].some(k=>typeof envelope[k]!=='string'))throw new AccountHttpError(400,'invalid_input');
 }else envelope=await readAccountBody(c.req.raw,['payload','signature']);
 const signed={payload:envelope.payload as string,signature:envelope.signature as string};
 const claims=await options.machine.authenticate(action,signed);
 await options.consume([{scope:action+'-key',subject:claims.installationId,limit:action==='release-held'?30:10,windowSeconds:60}]);
 try{return c.json(await options.machine.execute(action,signed,staff?envelope.body as string:undefined));}
 catch(error){if(error instanceof BoxErrorReportError)throw new AccountHttpError(error.code==='conflict'?409:error.code==='report_not_found'?404:400,error.code);throw error;}
}
