import {decideCountryFlow} from './country-policy.ts';
import type {CountryPolicy,FlowRequest} from './country-policy.ts';

export type MailPurpose='cloud-account-email'|'venue-email';
export interface MailScope {readonly country:string;readonly providerAccountId:string;readonly region:'eu-north-1'|'eu-west-3';}
export interface SesFeedbackConfig {
  readonly scope:MailScope;readonly policyRevision:number;readonly revision:string;
  readonly purposes:readonly MailPurpose[];readonly flows:readonly FlowRequest[];
  readonly identityArn:string;readonly configurationSet:string;readonly configurationSetArn:string;
  readonly topicArn:string;readonly queueArn:string;readonly queueUrl:string;readonly dlqArn:string;
  readonly smtpHost:string;readonly smtpPort:number;
}
// SMTP qualification belongs to trusted evidence, never the supplied configuration or event.
export interface SesFeedbackPolicy extends CountryPolicy {
  readonly smtpBindings?:readonly {readonly purpose:MailPurpose;readonly evidenceId:string;readonly host:string;readonly port:number;
    readonly revision:string;readonly identityArn:string;readonly configurationSetArn:string;readonly topicArn:string;
    readonly queueArn:string;readonly dlqArn:string}[];
}
const validated=new WeakSet<object>();
export function isValidatedSesFeedbackConfig(value:SesFeedbackConfig):boolean{return validated.has(value);}
const refuse=():never=>{throw new Error('Invalid SES feedback configuration');};
function object(value:unknown):Record<string,unknown>{
  return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:refuse();
}
function name(value:unknown):string {
  return typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value)?value:refuse();
}
function resource(value:unknown,prefix:string,identity=false):string {
  if(typeof value!=='string'||!value.startsWith(prefix))return refuse();
  const tail=value.slice(prefix.length);
  if(identity?!/^[A-Za-z0-9@._+-]{1,254}$/.test(tail):!/^[A-Za-z0-9_-]{1,80}$/.test(tail))return refuse();
  return value;
}

/** Validate trusted deployment settings; this does not qualify effective AWS policies. */
export function validateSesFeedbackConfig(policy:SesFeedbackPolicy,input:unknown):SesFeedbackConfig {
  const i=object(input),s=object(i.scope);
  const region=s.region===undefined?'eu-north-1':s.region;
  if(region!=='eu-north-1'&&region!=='eu-west-3')return refuse();
  if(typeof s.country!=='string'||!/^[A-Z]{2}$/.test(s.country)||s.country!==policy.country
    ||typeof s.providerAccountId!=='string'||!/^\d{12}$/.test(s.providerAccountId)
    ||i.policyRevision!==policy.revision||!Number.isSafeInteger(i.policyRevision)||policy.revision<1)return refuse();
  const scope=Object.freeze({country:s.country,providerAccountId:s.providerAccountId,region});
  const revision=name(i.revision),configurationSet=name(i.configurationSet);
  if(!Array.isArray(i.purposes)||i.purposes.length===0||i.purposes.length>2
    ||new Set(i.purposes).size!==i.purposes.length||i.purposes.some(p=>p!=='cloud-account-email'&&p!=='venue-email'))return refuse();
  const purposes=Object.freeze([...i.purposes]) as readonly MailPurpose[];
  const arn=(service:string)=>`arn:aws:${service}:${region}:${scope.providerAccountId}:`;
  const identityArn=resource(i.identityArn,arn('ses')+'identity/',true);
  if(i.configurationSetArn!==arn('ses')+'configuration-set/'+configurationSet)return refuse();
  const topicArn=resource(i.topicArn,arn('sns'));
  const queueArn=resource(i.queueArn,arn('sqs')),dlqArn=resource(i.dlqArn,arn('sqs'));
  if(queueArn===dlqArn)return refuse();
  const queueUrl=`https://sqs.${region}.amazonaws.com/${scope.providerAccountId}/${queueArn.slice(arn('sqs').length)}`;
  const dlqUrl=`https://sqs.${region}.amazonaws.com/${scope.providerAccountId}/${dlqArn.slice(arn('sqs').length)}`;
  const smtpHost=`email-smtp.${region}.amazonaws.com`;
  if(i.queueUrl!==queueUrl||i.smtpHost!==smtpHost||i.smtpPort!==465||!Array.isArray(i.flows))return refuse();
  const flows:FlowRequest[]=[];
  for(const purpose of purposes) {
    const requirements=[
      ['amazon-ses',purpose==='cloud-account-email'?'account-email':'venue-email',`https://email.${region}.amazonaws.com/`],
      ['amazon-ses','email-metadata',`https://email.${region}.amazonaws.com/`],
      ['amazon-sns','email-metadata',`https://sns.${region}.amazonaws.com/`],
      ['amazon-sqs','email-metadata',queueUrl],['amazon-sqs','email-metadata',dlqUrl],
    ] as const;
    for(const [supplierId,dataClass,endpoint] of requirements) {
      const expected:FlowRequest={country:scope.country,policyRevision:policy.revision,serviceId:purpose,supplierId,
        accountId:scope.providerAccountId,dataClass,endpoint,region};
      const matches=i.flows.filter(raw=>{const flow=object(raw);return Object.entries(expected).every(([key,value])=>flow[key]===value);});
      if(matches.length!==1)return refuse();
      const decision=decideCountryFlow(policy,expected);
      if(!decision.allowed)return refuse();
      if(supplierId==='amazon-ses'&&dataClass!=='email-metadata'
        &&!policy.smtpBindings?.some(b=>b.purpose===purpose&&b.evidenceId===decision.evidenceId&&b.host===smtpHost&&b.port===465
          &&b.revision===revision&&b.identityArn===identityArn&&b.configurationSetArn===i.configurationSetArn
          &&b.topicArn===topicArn&&b.queueArn===queueArn&&b.dlqArn===dlqArn))return refuse();
      flows.push(Object.freeze(expected));
    }
  }
  if(i.flows.length!==flows.length)return refuse();
  const config:SesFeedbackConfig=Object.freeze({scope,policyRevision:policy.revision,revision,purposes,flows:Object.freeze(flows),
    identityArn,configurationSet,configurationSetArn:i.configurationSetArn,topicArn,queueArn,queueUrl,dlqArn,smtpHost,smtpPort:465});
  validated.add(config);return config;
}
