import type {Context} from 'hono';
import type {Pool} from 'pg';
import {resolveSession} from '@waitron-cloud/identity';
import {transaction} from '@waitron-cloud/registration';
import {readAccountBody} from './request.ts';
import {readSessionCookie} from './cookies.ts';
import {AccountHttpError} from './errors.ts';
import type {RateRule} from './rate-limit.ts';
export async function alertPreferencesResponse(c:Context,options:{pool:Pool;origin:string;consume:(rules:RateRule[])=>Promise<void>}){
 const {pool,origin,consume}=options,write=c.req.method==='POST';
 if(!['GET','POST'].includes(c.req.method))throw new AccountHttpError(405,'method_not_allowed');
 if(write&&c.req.header('origin')!==origin)throw new AccountHttpError(403,'forbidden');
 const token=readSessionCookie(c,new URL(origin).protocol==='https:')??'';
 const proof={touch:false,...(write?{csrfToken:c.req.header('x-csrf-token')??''}:{})};
 const identity=await transaction(pool,client=>resolveSession(client,token,proof));
 await consume([{scope:'alert-preferences-account',subject:identity.accountId,limit:30,windowSeconds:60}]);
 const body=write?await readAccountBody(c.req.raw,['enabled','locale']):undefined;
 if(body&&(!['on','off'].includes(body.enabled!)||!['en','es'].includes(body.locale!)))throw new AccountHttpError(400,'invalid_input');
 return c.json(await transaction(pool,async client=>{
  const session=await resolveSession(client,token,proof);
  if(body)await client.query(`INSERT INTO account_alert_preferences(account_id,enabled,locale) VALUES($1,$2,$3)
   ON CONFLICT(account_id) DO UPDATE SET enabled=EXCLUDED.enabled,locale=EXCLUDED.locale`,[session.accountId,body.enabled==='on',body.locale]);
  const result=(await client.query('SELECT enabled,locale FROM account_alert_preferences WHERE account_id=$1',[session.accountId])).rows[0]??{enabled:false,locale:'en'};
  await resolveSession(client,token,proof);return result;
 }));
}
