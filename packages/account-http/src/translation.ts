import type {Context} from 'hono';
import {InstallationError} from '@waitron-cloud/registration';
import {TranslationError,type TranslationAction,type TranslationMachine} from '@waitron-cloud/translation';
import {readBoundedJsonObject} from './request.ts';
import {AccountHttpError,type ErrorStatus} from './errors.ts';
import type {RateRule} from './rate-limit.ts';
export const maxSubmitRequestBytes=2*1048576+16384,submitRequestMs=60000,submitSlots=4,submitPath='/api/installations/translation-submit';
export const translationPaths=['/api/installations/translation-submit','/api/installations/translation-status','/api/installations/translation-collect','/api/installations/translation-release'];
const codes:Record<TranslationError['code'],[ErrorStatus,string]>={invalid_request:[400,'invalid_request'],consent_required:[403,'translation_consent_required'],
 job_not_found:[404,'translation_job_not_found'],job_running:[409,'translation_job_running'],limit_reached:[409,'translation_limit_reached'],
 not_ready:[409,'translation_not_ready'],expired:[410,'translation_expired'],job_too_large:[413,'translation_job_too_large'],conflict:[409,'conflict'],forbidden:[403,'forbidden']};
export async function translationResponse(c:Context,options:{machine?:TranslationMachine;ip:string;consume:(rules:RateRule[])=>Promise<void>}){
 if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
 if(c.req.header('origin')!==undefined)throw new AccountHttpError(403,'forbidden');
 if(!options.machine)throw new AccountHttpError(503,'temporarily_unavailable');
 await options.consume([{scope:'installation-ip',subject:options.ip,limit:60,windowSeconds:60}]);
 const action=c.req.path.slice('/api/installations/'.length) as TranslationAction,submit=action==='translation-submit';
 let parsed:Record<string,unknown>;
 try{parsed=await readBoundedJsonObject(c.req.raw,submit?maxSubmitRequestBytes:16384,submit?submitRequestMs:5000);}
 catch(error){if(submit&&error instanceof AccountHttpError&&error.status===413)throw new AccountHttpError(413,'translation_job_too_large');throw error;}
 const fields=submit?['body','payload','signature']:['payload','signature'];
 if(Object.keys(parsed).sort().join(',')!==fields.join(',')||fields.some(f=>typeof parsed[f]!=='string'))throw new InstallationError('invalid_proof');
 const envelope={payload:parsed.payload as string,signature:parsed.signature as string};
 const claims=await options.machine.authenticate(action,envelope);
 await options.consume([{scope:'installation-key',subject:claims.installationId,limit:30,windowSeconds:60}]);
 try{return c.json(await options.machine.execute(action,envelope,submit?parsed.body as string:undefined));}
 catch(error){
  if(!(error instanceof TranslationError))throw error;
  const [status,code]=codes[error.code];
  if(error.code==='limit_reached')return c.json({error:code,fits:error.fits},409);
  throw new AccountHttpError(status,code);
 }
}
