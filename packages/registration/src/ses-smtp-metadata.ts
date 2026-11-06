import {EmailDeliveryError} from './email-delivery.ts';
import type {HandoffAdmission} from './mail-attempts.ts';
import {isValidatedSesFeedbackConfig,type SesFeedbackConfig} from './ses-feedback-config.ts';

export interface SesProviderReceipt {provider:'ses';messageId:string}

/** Only deployment configuration and the committed attempt may select SES event metadata. */
export function sesSmtpHeaders(config:SesFeedbackConfig,admission:HandoffAdmission|undefined):Record<string,string>{
 if(!isValidatedSesFeedbackConfig(config)||!admission||admission.configurationSet!==config.configurationSet
  ||typeof admission.attemptTag!=='string'||! /^[A-Za-z0-9_-]{43}$/.test(admission.attemptTag)
  ||Buffer.from(admission.attemptTag,'base64url').toString('base64url')!==admission.attemptTag)throw new EmailDeliveryError('delivery_configuration');
 return {'X-SES-CONFIGURATION-SET':config.configurationSet,'X-SES-MESSAGE-TAGS':`waitron-attempt=${admission.attemptTag}`};
}

/** Acceptance is authoritative even when optional provider metadata cannot be interpreted. */
export function sesProviderReceipt(response:unknown):SesProviderReceipt|undefined{
 if(typeof response!=='string'||response.length>263)return;
 const id=/^250 Ok ([A-Za-z0-9_-]{1,256})$/.exec(response)?.[1];
 return id?{provider:'ses',messageId:id}:undefined;
}
