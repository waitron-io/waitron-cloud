import type {Context} from 'hono';
import type {Pool} from 'pg';
import {BillingDisplayMachine,BillingDisplayError,InstallationError,type LeaseIssuer} from '@waitron-cloud/registration';
import {readAccountBody} from './request.ts';
import {AccountHttpError} from './errors.ts';
import type {RateRule} from './rate-limit.ts';

export type BillingDisplayOptions={countryCode:'ES';calendarTimeZone:string};
export function createBillingDisplayMachine(options:{pool:Pool;issuer?:LeaseIssuer;origin:string;display?:BillingDisplayOptions;trusted?:ReadonlyMap<string,string>}):BillingDisplayMachine|undefined{
 if(!options.issuer||!options.display)return undefined;
 try{return new BillingDisplayMachine(options.pool,options.issuer,options.origin,options.display,options.trusted);}
 catch(error){
  // A missing country calendar disables this read while existing account routes remain available.
  if(error instanceof BillingDisplayError)return undefined;
  throw error;
 }
}
export async function billingDisplayResponse(c:Context,options:{machine?:BillingDisplayMachine;ip:string;consume:(rules:RateRule[])=>Promise<void>}):Promise<Response>{
 if(c.req.method!=='POST')throw new AccountHttpError(405,'method_not_allowed');
 if(c.req.header('origin')!==undefined)throw new AccountHttpError(403,'forbidden');
 if(!options.machine)throw new AccountHttpError(503,'temporarily_unavailable');
 try{
  await options.consume([{scope:'installation-ip',subject:options.ip,limit:60,windowSeconds:60}]);
  const envelope=await readAccountBody(c.req.raw,['payload','signature']);
  const claims=await options.machine.authenticate(envelope);
  await options.consume([{scope:'installation-key',subject:claims.installationId,limit:30,windowSeconds:60}]);
  return c.json(await options.machine.read(envelope));
 }catch(error){
  if(error instanceof BillingDisplayError)throw new AccountHttpError(error.code==='temporarily_unavailable'?503:400,error.code);
  if(error instanceof InstallationError&&error.code==='unavailable')throw new AccountHttpError(503,'temporarily_unavailable');
  throw error;
 }
}
