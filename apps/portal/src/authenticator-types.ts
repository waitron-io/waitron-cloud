export type FactorProof={kind:'totp'|'recovery';code:string};
export type FactorChallenge={factorRequired:true;challengeToken:string;expiresAt:string};
export type PasswordLogin={accountId:string}|FactorChallenge;
export type FactorStatus={active:boolean;version:number;recoveryCodesRemaining:number;available:boolean};
export type FactorEnrolment={pendingToken:string;secret:string;uri:string;expiresAt:string};
export type FactorChange={status:'changed';active:true;recoveryCodes:string[]}|{status:'changed';active:false};
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exact=(value:Record<string,unknown>,keys:string[])=>Object.keys(value).sort().join(',')===keys.sort().join(',');
const token=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
const date=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value));
export function validPasswordLogin(value:unknown,status:number):value is PasswordLogin {
  if(!object(value))return false;
  if(status===200)return exact(value,['accountId'])&&typeof value.accountId==='string'&&value.accountId.length>0;
  return status===202&&exact(value,['factorRequired','challengeToken','expiresAt'])&&value.factorRequired===true&&token(value.challengeToken)&&date(value.expiresAt);
}
export function validFactorStatus(value:unknown):value is FactorStatus {
  return object(value)&&exact(value,['active','version','recoveryCodesRemaining','available'])&&typeof value.active==='boolean'&&typeof value.available==='boolean'
    &&Number.isSafeInteger(value.version)&&(value.version as number)>=0&&(!value.active||(value.version as number)>0)
    &&Number.isInteger(value.recoveryCodesRemaining)&&(value.recoveryCodesRemaining as number)>=0&&(value.recoveryCodesRemaining as number)<=10;
}
export function validFactorEnrolment(value:unknown):value is FactorEnrolment {
  if(!object(value)||!exact(value,['pendingToken','secret','uri','expiresAt'])||!token(value.pendingToken)||!date(value.expiresAt)
    ||typeof value.secret!=='string'||!/^[A-Z2-7]{16,128}$/.test(value.secret)||typeof value.uri!=='string'||value.uri.length>2048)return false;
  try{const uri=new URL(value.uri);return uri.protocol==='otpauth:'&&uri.hostname==='totp'&&!uri.username&&!uri.password&&!uri.hash&&uri.searchParams.get('secret')===value.secret;}catch{return false;}
}
export function validFactorChange(value:unknown,active:boolean):value is FactorChange {
  if(!object(value)||value.status!=='changed'||value.active!==active)return false;
  if(!active)return exact(value,['status','active']);
  return exact(value,['status','active','recoveryCodes'])&&Array.isArray(value.recoveryCodes)&&value.recoveryCodes.length===10
    &&value.recoveryCodes.every(code=>typeof code==='string'&&/^[A-F0-9]{32}$/.test(code))&&new Set(value.recoveryCodes).size===10;
}
