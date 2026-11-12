import type {Context} from 'hono';
import type {Pool} from 'pg';
import {resolveSession} from '@waitron-cloud/identity';
import {AccountActionProofStore,PasskeyStore,PasskeyError,transaction} from '@waitron-cloud/registration';
import {AccountHttpError} from './errors.ts';
import {readSessionCookie} from './cookies.ts';
import {readBoundedJsonObject} from './request.ts';
import {authentication} from './passkeys.ts';
import type {RateRule} from './rate-limit.ts';
export async function accountActionProofResponse(c:Context,o:{pool:Pool;store:AccountActionProofStore;passkeys:PasskeyStore;origin:string;secure:boolean;ip:string;consume:(rules:RateRule[])=>Promise<void>}){
  const path=c.req.path.slice('/api/account/action-proof'.length),token=readSessionCookie(c,o.secure)??'',csrfToken=c.req.header('x-csrf-token')??'';
  if(!['','/email','/email/verify','/factor','/passkey/options','/passkey/verify'].includes(path))throw new AccountHttpError(404,'not_found');
  if(c.req.method!==(path===''?'GET':'POST'))throw new AccountHttpError(405,'method_not_allowed');
  if(path==='')return c.json(await o.store.status(token));
  if(c.req.header('origin')!==o.origin)throw new AccountHttpError(403,'forbidden');
  const body=await readBoundedJsonObject(c.req.raw);
  const fields=path==='/email'&&Object.hasOwn(body,'locale')?['locale']:path==='/email/verify'?['challengeToken','code']:path==='/factor'?['kind','code']:path==='/passkey/verify'?['ceremonyId','response']:[];
  if(Object.keys(body).sort().join(',')!==fields.sort().join(','))throw new AccountHttpError(400,'invalid_input');
  const session=await transaction(o.pool,client=>resolveSession(client,token,{csrfToken,touch:false}));
  await o.consume([{scope:'action-proof-ip',subject:o.ip,limit:10,windowSeconds:60},{scope:'action-proof-account',subject:session.accountId,limit:20,windowSeconds:300}]);
  if(path==='/email'){if(body.locale!==undefined&&!['en','es'].includes(String(body.locale)))throw new AccountHttpError(400,'invalid_input');return c.json(await o.store.email(token,csrfToken,body.locale as 'en'|'es'|undefined));}
  if(path==='/passkey/options')return c.json(await o.passkeys.authenticationOptions(token,csrfToken));
  if(path==='/email/verify'){
    if(typeof body.challengeToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(body.challengeToken)||typeof body.code!=='string'||!/^\d{6}$/.test(body.code))throw new AccountHttpError(400,'invalid_input');
    await o.store.completeEmail(token,csrfToken,body.challengeToken,body.code);
  }else if(path==='/factor'){
    if(!['totp','recovery'].includes(String(body.kind))||typeof body.code!=='string'||body.code.length>64)throw new AccountHttpError(400,'invalid_input');
    await o.store.factor(token,csrfToken,{kind:body.kind as 'totp'|'recovery',code:body.code});
  }else{
    if(typeof body.ceremonyId!=='string'||body.ceremonyId.length!==36)throw new AccountHttpError(400,'invalid_input');
    try{await o.passkeys.reprove(token,csrfToken,body.ceremonyId,authentication(body.response));}
    catch(error){if(error instanceof PasskeyError)throw new AccountHttpError(403,'proof_required');throw error;}
  }
  return c.body(null,204);
}
