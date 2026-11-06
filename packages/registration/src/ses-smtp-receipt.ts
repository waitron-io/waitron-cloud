import type {Pool} from 'pg';
import type {HandoffAdmission} from './mail-attempts.ts';
import {bindProviderId} from './mail-attempts.ts';
import {transaction} from './transaction.ts';

/** Persist optional evidence after queue settlement; malformed metadata cannot recall acceptance. */
export async function bindSesProviderReceipt(pool:Pool,admission:HandoffAdmission|undefined,receipt:unknown):Promise<void>{
 if(!admission||!receipt||typeof receipt!=='object')return;
 const value=receipt as {provider?:unknown;messageId?:unknown};
 if(value.provider!=='ses'||typeof value.messageId!=='string'||!/^[A-Za-z0-9_-]{1,256}$/.test(value.messageId))return;
 const id=value.messageId;
 try{await transaction(pool,c=>bindProviderId(c,admission.attemptTag,id));}
 catch(error){
  if(!(error instanceof Error)||error.message!=='mail_provider_conflict')throw error;
  console.error('Email provider receipt conflict');
 }
}
