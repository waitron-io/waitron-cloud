import { createLocalAccountMailer } from './local-mailer.ts';
import { createSmtpAccountMailer } from './smtp-mailer.ts';
import {openSync,readSync,closeSync,fstatSync,constants} from 'node:fs';
import {validateSesFeedbackConfig,type SesFeedbackPolicy} from './ses-feedback-config.ts';
import {spainCountryPolicy} from './country-policy.ts';
import {RelayKeys,type RelayKeyConfig} from './relay-payload.ts';
import type {SesHandoffConfig} from './mail-attempts.ts';

/** Configuration files supply bindings, never the policy that qualifies those bindings. */
export function configuredSesHandoff(policy:SesFeedbackPolicy=spainCountryPolicy):SesHandoffConfig|undefined{
 const env=process.env;
 if(env.CLOUD_MAIL_PROVIDER!=='ses')return;
 let fd:number|undefined;
 try{
  if(env.CLOUD_MAIL_TRANSPORT!=='smtp'||!env.CLOUD_SES_FEEDBACK_CONFIG_FILE
   ||!env.CLOUD_MAIL_RECIPIENT_KEYS||!env.CLOUD_MAIL_RECIPIENT_ACTIVE_KEY_ID)throw Error();
  fd=openSync(env.CLOUD_SES_FEEDBACK_CONFIG_FILE,constants.O_RDONLY|constants.O_NONBLOCK);
  const stat=fstatSync(fd);if(!stat.isFile()||stat.size>65536)throw Error();
  const bytes=Buffer.alloc(65537),length=readSync(fd,bytes,0,bytes.length,0);if(length>65536)throw Error();
  const config=validateSesFeedbackConfig(policy,JSON.parse(bytes.subarray(0,length).toString('utf8')));
  if(!config.purposes.includes('cloud-account-email'))throw Error();
  const recipientKeys:RelayKeyConfig={activeKeyId:env.CLOUD_MAIL_RECIPIENT_ACTIVE_KEY_ID,keys:JSON.parse(env.CLOUD_MAIL_RECIPIENT_KEYS)};
  new RelayKeys(recipientKeys);
  return {config,recipientKeys};
 }catch{throw Error('Invalid SES mail configuration');}
 finally{if(fd!==undefined)closeSync(fd);}
}

export function configuredAccountMailer(ses?:SesHandoffConfig) {
  const env = process.env;
  if(env.CLOUD_MAIL_PROVIDER==='ses'&&(!ses||env.CLOUD_MAIL_TRANSPORT!=='smtp'))throw Error('Invalid SES mail configuration');
  if((env.CLOUD_MAIL_PROVIDER!==undefined&&!['ses','generic'].includes(env.CLOUD_MAIL_PROVIDER))
   ||(ses&&env.CLOUD_MAIL_PROVIDER!=='ses'))throw Error('Invalid email transport configuration');
  const mode = env.CLOUD_MAIL_TRANSPORT ?? (env.NODE_ENV === 'production' ? undefined : 'local');
  if (mode === 'smtp') return createSmtpAccountMailer({host: env.CLOUD_SMTP_HOST ?? '',
    port: Number(env.CLOUD_SMTP_PORT ?? 465), user: env.CLOUD_SMTP_USER ?? '', password: env.CLOUD_SMTP_PASSWORD ?? '',
    from: env.CLOUD_MAIL_FROM ?? '', portalOrigin: env.CLOUD_PORTAL_ORIGIN ?? ''},{},ses?.config);
  if (mode === 'local' && env.NODE_ENV !== 'production') return createLocalAccountMailer({port: Number(env.MAILPIT_SMTP_PORT ?? 1125), portalOrigin: env.CLOUD_PORTAL_ORIGIN});
  throw new Error('Invalid email transport configuration');
}
