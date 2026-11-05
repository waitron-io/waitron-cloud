import type {HandoffAdmission} from './mail-attempts.ts';
import type {SesFeedbackConfig} from './ses-feedback-config.ts';
import type {SesProviderReceipt} from './ses-smtp-metadata.ts';
import {createSmtpDelivery,type SmtpAccountMailConfig} from './smtp-mailer.ts';
import {relayTemplate,type RelayContent,type RelayDelivery} from './relay-smtp.ts';
import type {Pool} from 'pg';
import {bindSesProviderReceipt} from './ses-smtp-receipt.ts';

export type RelaySesResult={outcome:RelayDelivery;providerReceipt?:SesProviderReceipt};
/** Queue outcome settlement stays independent of optional accepted-provider evidence. */
export async function settleSesRelayReceipt(pool:Pool,admission:HandoffAdmission|undefined,result:RelaySesResult):Promise<void>{
 if(result.outcome==='accepted')await bindSesProviderReceipt(pool,admission,result.providerReceipt);
}
class RelaySmtpFailure extends Error{
 readonly outcome:RelayDelivery;
 constructor(outcome:RelayDelivery){super('relay_smtp_failed');this.outcome=outcome;}
}
function failure(error:unknown):Error{
 const e=error&&typeof error==='object'?error as {responseCode?:number;command?:string;code?:string}:{};
 if(e.responseCode&&e.responseCode>=500&&e.responseCode<600)return new RelaySmtpFailure('refused');
 if(e.responseCode&&e.responseCode>=400&&e.responseCode<500)return new RelaySmtpFailure('temporary');
 if(e.code==='EAUTH'||(e.code&&/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY_LEAF_SIGNATURE/.test(e.code)))return new RelaySmtpFailure('refused');
 if(e.code==='ECONNREFUSED'||['EHLO','HELO','MAIL FROM','RCPT TO'].includes(e.command??''))return new RelaySmtpFailure('temporary');
 return new RelaySmtpFailure('uncertain');
}

/** Internal adapter only. Production relay grant and startup composition remain separately gated. */
export function createSesRelaySender(config:SesFeedbackConfig,smtp:SmtpAccountMailConfig,trust:{ca?:string|Buffer}={}){
 const deliver=createSmtpDelivery(smtp,trust,config,'venue-email',failure),domain=smtp.from.split('@')[1]!;
 return async(content:RelayContent,admission:HandoffAdmission,signal:AbortSignal):Promise<RelaySesResult>=>{
  const rendered=relayTemplate(content);
  try{
   const result=await deliver(content.recipient,()=>rendered,`<${content.messageId}@${domain}>`,{deliveryId:content.messageId,signal,ses:admission});
   return {outcome:'accepted',...(result.providerReceipt?{providerReceipt:result.providerReceipt}:{})};
  }catch(error){if(error instanceof RelaySmtpFailure)return {outcome:error.outcome};throw error;}
 };
}
