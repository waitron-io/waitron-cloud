import type {Context} from 'hono';
import type {Pool} from 'pg';
import {resolveSession} from '@waitron-cloud/identity';
import {transaction} from '@waitron-cloud/registration';
import {agreeConsent,listConsents,TranslationError,withdrawConsent} from '@waitron-cloud/translation';
import {readAccountBody} from './request.ts';
import {readSessionCookie} from './cookies.ts';
import {AccountHttpError} from './errors.ts';
import type {RateRule} from './rate-limit.ts';
export async function translationConsentResponse(c:Context,options:{pool:Pool;origin:string;consume:(rules:RateRule[])=>Promise<void>}){
 const {pool,origin,consume}=options,write=c.req.method==='POST';
 if(!['GET','POST'].includes(c.req.method))throw new AccountHttpError(405,'method_not_allowed');
 if(write&&c.req.header('origin')!==origin)throw new AccountHttpError(403,'forbidden');
 const token=readSessionCookie(c,new URL(origin).protocol==='https:')??'';
 const proof={touch:false,...(write?{csrfToken:c.req.header('x-csrf-token')??''}:{})};
 const identity=await transaction(pool,client=>resolveSession(client,token,proof));
 await consume([{scope:'translation-consent-account',subject:identity.accountId,limit:30,windowSeconds:60}]);
 const body=write?await readAccountBody(c.req.raw,['venueId','choice'],['consentVersion']):undefined;
 if(body&&(!['agree','withdraw'].includes(body.choice!)||(body.choice==='agree')!==(body.consentVersion!==undefined)))throw new AccountHttpError(400,'invalid_input');
 try{
  return c.json(await transaction(pool,async client=>{
   const session=await resolveSession(client,token,proof);
   if(body?.choice==='agree')await agreeConsent(client,session.accountId,{venueId:body.venueId!,consentVersion:body.consentVersion!});
   else if(body)await withdrawConsent(client,session.accountId,{venueId:body.venueId!});
   const consents=await listConsents(client,session.accountId);
   await resolveSession(client,token,proof);return {consents};
  }));
 }catch(error){
  if(error instanceof TranslationError)throw new AccountHttpError(error.code==='forbidden'?403:400,error.code==='forbidden'?'permission_denied':'invalid_input');
  throw error;
 }
}
