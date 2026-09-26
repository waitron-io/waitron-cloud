import type {Context} from 'hono';
import type {Pool} from 'pg';
import {resolveSession} from '@waitron-cloud/identity';
import {SecurityAuditStore,transaction} from '@waitron-cloud/registration';
import {readSessionCookie} from './cookies.ts';
import {AccountHttpError} from './errors.ts';
import type {RateRule} from './rate-limit.ts';
import {readBoundedJsonObject} from './request.ts';

export async function securityAuditResponse(c:Context,options:{pool:Pool;origin:string;secure:boolean;consume:(rules:RateRule[])=>Promise<void>}):Promise<Response>{
 if(c.req.path!=='/api/account/security-audit/read')throw new AccountHttpError(404,'not_found');
 if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
 if(c.req.header('origin')!==options.origin)throw new AccountHttpError(403,'forbidden');
 const body=await readBoundedJsonObject(c.req.raw),keys=Object.keys(body);
 if(keys.some(key=>!['organisationId','cursor','limit'].includes(key))||typeof body.organisationId!=='string'
  ||(body.cursor!==undefined&&typeof body.cursor!=='string')||(body.limit!==undefined&&typeof body.limit!=='number'))throw new AccountHttpError(400,'invalid_input');
 const token=readSessionCookie(c,options.secure)??'',csrf=c.req.header('x-csrf-token')??'';
 const session=await transaction(options.pool,client=>resolveSession(client,token,{csrfToken:csrf,touch:false}));
 await options.consume([{scope:'security-audit-account',subject:session.accountId,limit:30,windowSeconds:60}]);
 return c.json(await new SecurityAuditStore(options.pool).page(token,{organisationId:body.organisationId,limit:body.limit??50,...(body.cursor===undefined?{}:{cursor:body.cursor})}));
}
