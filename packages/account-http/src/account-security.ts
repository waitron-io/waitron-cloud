import type {Context} from 'hono';
import type {Pool} from 'pg';
import {resolveSession} from '@waitron-cloud/identity';
import {AccountSecurityStore,transaction} from '@waitron-cloud/registration';
import {AccountHttpError} from './errors.ts';
import {readSessionCookie,writeSessionCookies} from './cookies.ts';
import {readBoundedJsonObject} from './request.ts';
import type {RateRule} from './rate-limit.ts';

export async function accountSecurityResponse(c:Context,o:{pool:Pool;store:AccountSecurityStore;origin:string;secure:boolean;ip:string;consume:(rules:RateRule[])=>Promise<void>}){
  const path=c.req.path.slice('/api/account/security'.length);
  if(!['/password','/email','/email/verify'].includes(path))throw new AccountHttpError(404,'not_found');
  if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
  if(c.req.header('origin')!==o.origin)throw new AccountHttpError(403,'forbidden');
  const body=await readBoundedJsonObject(c.req.raw),verify=path==='/email/verify';
  const field=verify?'token':path==='/email'?'email':'password',fields=verify?['token']:Object.hasOwn(body,'locale')?[field,'locale']:[field];
  if(Object.keys(body).sort().join(',')!==fields.sort().join(',')||typeof body[field]!=='string'||body.locale!==undefined&&!['en','es'].includes(String(body.locale)))throw new AccountHttpError(400,'invalid_input');
  const token=readSessionCookie(c,o.secure)??'',csrf=c.req.header('x-csrf-token')??'';
  const session=await transaction(o.pool,client=>resolveSession(client,token,{csrfToken:csrf,touch:false}));
  await o.consume([{scope:'credential-change-ip',subject:o.ip,limit:10,windowSeconds:60},{scope:'credential-change-account',subject:session.accountId,limit:20,windowSeconds:300}]);
  if(path==='/email')return c.json(await o.store.email(token,csrf,body.email as string,body.locale as 'en'|'es'|undefined),202);
  if(verify)await o.store.completeEmail(token,csrf,body.token as string);
  else await o.store.password(token,csrf,body.password as string,body.locale as 'en'|'es'|undefined);
  writeSessionCookies(c,o.secure);return c.body(null,204);
}
