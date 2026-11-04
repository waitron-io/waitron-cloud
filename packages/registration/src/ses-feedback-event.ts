import {createHash} from 'node:crypto';
import {normaliseEmail} from './account-input.ts';
import {isValidatedSesFeedbackConfig} from './ses-feedback-config.ts';
import type {SesFeedbackConfig} from './ses-feedback-config.ts';

export type FeedbackKind='delivery'|'hard_bounce'|'complaint'|'provider_suppressed'|'temporary'|'unclassified';
export interface ParsedFeedback {
  readonly snsId:string;readonly contentDigest:string;readonly kind:FeedbackKind;readonly eventId:string|null;
  readonly eventTime:string;readonly attemptTag:string;readonly providerMessageId:string;readonly recipient:string|null;
}
const refuse=():never=>{throw new Error('Invalid SES feedback event');};
function object(value:unknown):Record<string,unknown>{
  return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:refuse();
}
function identifier(value:unknown):string{return typeof value==='string'&&/^[!-~]{1,256}$/.test(value)?value:refuse();}
function timestamp(value:unknown):string {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))return refuse();
  const time=new Date(value);
  if(!Number.isFinite(time.getTime())||time.toISOString()!==value.replace(/(?:\.(\d{1,3}))?Z$/,(_all,fraction:string|undefined)=>`.${(fraction??'').padEnd(3,'0')}Z`))return refuse();
  return time.toISOString();
}
function json(value:unknown,limit:number):Record<string,unknown> {
  if(typeof value!=='string'||Buffer.byteLength(value,'utf8')>limit)return refuse();
  let parsed:unknown;try{parsed=JSON.parse(value);}catch{return refuse();}
  // JSON.parse keeps the last duplicate member; ambiguous attempt tags must instead refuse.
  const stack:(Set<string>|null)[]=[];
  const tokens=/"(?:[^"\\]|\\[\s\S])*"|[{}\[\]]/g;
  for(const token of value.matchAll(tokens)) {
    const t=token[0];
    if(t==='{'||t==='[') {stack.push(t==='{'?new Set():null);if(stack.length>32)return refuse();}
    else if(t==='}'||t===']')stack.pop();
    else if(/^\s*:/.test(value.slice(token.index+t.length))) {
      const keys=stack.at(-1);if(!keys)return refuse();
      const key=JSON.parse(t) as string;if(keys.has(key))return refuse();keys.add(key);
    }
  }
  return object(parsed);
}
function tag(tags:Record<string,unknown>,key:string):string {
  const values=tags[key];return Array.isArray(values)&&values.length===1&&typeof values[0]==='string'?values[0]:refuse();
}
const suppressed=new Set(['Suppressed','OnAccountSuppressionList','OnTenantSuppressionList','EmailValidationSuppressed']);

/** Only the trusted SQS consumer may supply envelopes; these checks do not authenticate AWS. */
export function parseSesFeedback(body:string,config:SesFeedbackConfig):ParsedFeedback {
  if(!isValidatedSesFeedbackConfig(config))return refuse();
  const envelope=json(body,256*1024);
  if(envelope.Type!=='Notification'||envelope.TopicArn!==config.topicArn)return refuse();
  const snsId=identifier(envelope.MessageId);timestamp(envelope.Timestamp);
  const event=json(envelope.Message,128*1024),mail=object(event.mail),tags=object(mail.tags);
  if(mail.sendingAccountId!==config.scope.providerAccountId||mail.sourceArn!==config.identityArn
    ||tag(tags,'ses:configuration-set')!==config.configurationSet)return refuse();
  const attemptTag=tag(tags,'waitron-attempt');
  if(!/^[A-Za-z0-9_-]{43}$/.test(attemptTag)||Buffer.from(attemptTag,'base64url').toString('base64url')!==attemptTag)return refuse();
  const providerMessageId=identifier(mail.messageId),mailTime=timestamp(mail.timestamp);
  const eventType=identifier(event.eventType);
  let kind:FeedbackKind='unclassified',eventId:string|null=null,eventTime=mailTime;
  const recipients:string[]=[];
  function recipientList(value:unknown,objects:boolean,redacted=false,required=false):void {
    if(value===undefined&&!required)return;
    if(!Array.isArray(value)||value.length>1||(required&&value.length!==1))return refuse();
    for(const item of value) {
      const address=objects?object(item).emailAddress:item;
      if(redacted&&(address===undefined||address==='REDACTED'))continue;
      const email=normaliseEmail(address);if(!email)return refuse();recipients.push(email);
    }
  }
  const complaint=eventType==='Complaint';
  recipientList(mail.destination,false,complaint,!complaint);
  for(const [key,list] of [['bounce','bouncedRecipients'],['complaint','complainedRecipients'],['delivery','recipients'],['deliveryDelay','delayedRecipients']] as const) {
    if(event[key]!==undefined)recipientList(object(event[key])[list],key!=='delivery',key==='complaint',eventType===({bounce:'Bounce',complaint:'Complaint',delivery:'Delivery',deliveryDelay:'DeliveryDelay'}[key])&&key!=='complaint');
  }
  if(eventType==='Bounce') {
    const bounce=object(event.bounce),type=identifier(bounce.bounceType),subtype=identifier(bounce.bounceSubType);
    eventId=identifier(bounce.feedbackId);eventTime=timestamp(bounce.timestamp);
    kind=type==='Permanent'?(suppressed.has(subtype)?'provider_suppressed':'hard_bounce'):type==='Transient'?'temporary':'unclassified';
  } else if(complaint) {
    const report=object(event.complaint);eventId=identifier(report.feedbackId);eventTime=timestamp(report.timestamp);
    kind=report.complaintSubType==='OnAccountSuppressionList'||report.complaintSubType==='OnTenantSuppressionList'?'provider_suppressed'
      :report.complaintFeedbackType==='not-spam'?'unclassified':'complaint';
  } else if(eventType==='Delivery') {eventTime=timestamp(object(event.delivery).timestamp);kind='delivery';}
  else if(eventType==='DeliveryDelay') {eventTime=timestamp(object(event.deliveryDelay).timestamp);kind='temporary';}
  if(new Set(recipients).size>1||(!complaint&&recipients.length===0))return refuse();
  return Object.freeze({snsId,contentDigest:createHash('sha256').update(body,'utf8').digest('hex'),kind,eventId,eventTime,attemptTag,
    providerMessageId,recipient:recipients[0]??null});
}
