import {createHash} from 'node:crypto';
import {InstallationError} from '@waitron-cloud/registration';
import {TranslationError} from './errors.ts';

export const maxJobBytes=1048576,maxJobItems=1000;
export interface SubmitFingerprint {jobSha256:string;jobBytes:number}
function invalid():never{throw new InstallationError('invalid_proof');}
export function jobFingerprint(body:string):SubmitFingerprint{
  const bytes=Buffer.from(body,'utf8');
  return {jobSha256:createHash('sha256').update(bytes).digest('hex'),jobBytes:bytes.length};
}
export function checkSubmitBody(signedBody:string,body:string):SubmitFingerprint{
  let value:unknown;
  try{value=JSON.parse(signedBody);}catch{return invalid();}
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='jobBytes,jobSha256,version')return invalid();
  const signed=value as Record<string,unknown>;
  if(signed.version!==1||typeof signed.jobSha256!=='string'||!/^[0-9a-f]{64}$/.test(signed.jobSha256)
    ||!Number.isSafeInteger(signed.jobBytes)||Number(signed.jobBytes)<1)return invalid();
  if(Number(signed.jobBytes)>maxJobBytes)throw new TranslationError('job_too_large');
  const actual=jobFingerprint(body);
  if(actual.jobBytes!==signed.jobBytes||actual.jobSha256!==signed.jobSha256)return invalid();
  return actual;
}
