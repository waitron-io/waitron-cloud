import type {Context} from 'hono';
import {resolveSession} from '@waitron-cloud/identity';
import {transaction,type CloudActions,type CloudActionProposal,type CloudActionDecision} from '@waitron-cloud/registration';
import type {Pool} from 'pg';
import {AccountHttpError} from './errors.ts';
import {readSessionCookie} from './cookies.ts';
import {readBoundedJsonObject} from './request.ts';
import type {RateRule} from './rate-limit.ts';

export async function cloudActionsResponse(c:Context,actions:CloudActions,o:{pool:Pool;secure:boolean;origin:string;ip:string;consume:(rules:RateRule[])=>Promise<void>}){
 const path=c.req.path.slice('/api/account/operator/actions'.length),token=readSessionCookie(c,o.secure)??'';
 if(c.req.path==='/api/account/operator/actions'){
  if(c.req.method!=='GET')throw new AccountHttpError(405,'method_not_allowed');
  return c.json(await actions.read(token));
 }
 if(!c.req.path.startsWith('/api/account/operator/actions/')||!['/requests','/decide'].includes(path))throw new AccountHttpError(404,'not_found');
 if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
 if(c.req.header('origin')!==o.origin)throw new AccountHttpError(403,'forbidden');
 const body=await readBoundedJsonObject(c.req.raw),csrf=c.req.header('x-csrf-token')??'';
 const session=await transaction(o.pool,client=>resolveSession(client,token,{csrfToken:csrf,touch:false}));
 await o.consume([{scope:'cloud-action-ip',subject:o.ip,limit:20,windowSeconds:60},{scope:'cloud-action-account',subject:session.accountId,limit:30,windowSeconds:300}]);
 if(path==='/requests')return c.json(await actions.propose(token,csrf,body as CloudActionProposal),201);
 return c.json(await actions.decide(token,csrf,body as CloudActionDecision));
}
