import type {Context} from 'hono';
import type {Pool} from 'pg';
import {resolveSession} from '@waitron-cloud/identity';
import {transaction,UsageStore} from '@waitron-cloud/registration';
import {readSessionCookie} from './cookies.ts';
import {AccountHttpError} from './errors.ts';
import type {RateRule} from './rate-limit.ts';
import {readBoundedJsonObject} from './request.ts';

export async function usageResponse(c:Context,options:{pool:Pool;origin:string;secure:boolean;consume:(rules:RateRule[])=>Promise<void>}):Promise<Response>{
 if(c.req.path!=='/api/account/usage/read')throw new AccountHttpError(404,'not_found');
 if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
 if(c.req.header('origin')!==options.origin)throw new AccountHttpError(403,'forbidden');
 const body=await readBoundedJsonObject(c.req.raw),keys=Object.keys(body);
 if(keys.length!==1||keys[0]!=='organisationId'||typeof body.organisationId!=='string')throw new AccountHttpError(400,'invalid_input');
 const token=readSessionCookie(c,options.secure)??'',csrf=c.req.header('x-csrf-token')??'';
 const session=await transaction(options.pool,client=>resolveSession(client,token,{csrfToken:csrf,touch:false}));
 await options.consume([{scope:'usage-account',subject:session.accountId,limit:30,windowSeconds:60}]);
 return c.json(await new UsageStore(options.pool).summary(token,{organisationId:body.organisationId}));
}
