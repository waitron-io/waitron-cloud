import type {MailPurpose} from '../../src/ses-feedback-config.ts';
import type {CountryPolicy} from '../../src/country-policy.ts';

// Synthetic qualification exercises local validation, never a deployed supplier grant.
export function feedbackFixture(region='eu-north-1',purposes=['cloud-account-email']) {
  const account='123456789012';
  const arn=(service:string,resource:string)=>`arn:aws:${service}:${region}:${account}:${resource}`;
  const queueUrl=`https://sqs.${region}.amazonaws.com/${account}/mail-feedback`;
  const dlqUrl=`https://sqs.${region}.amazonaws.com/${account}/mail-feedback-dead`;
  const flows=purposes.flatMap(serviceId=>[
    {serviceId,supplierId:'amazon-ses',dataClass:serviceId==='cloud-account-email'?'account-email':'venue-email',endpoint:`https://email.${region}.amazonaws.com/`},
    {serviceId,supplierId:'amazon-ses',dataClass:'email-metadata',endpoint:`https://email.${region}.amazonaws.com/`},
    {serviceId,supplierId:'amazon-sns',dataClass:'email-metadata',endpoint:`https://sns.${region}.amazonaws.com/`},
    ...[queueUrl,dlqUrl].map(endpoint=>({serviceId,supplierId:'amazon-sqs',dataClass:'email-metadata',endpoint})),
  ]).map(flow=>({...flow,country:'ES',policyRevision:3,accountId:account,region}));
  const policy={country:'ES',revision:3,homeRegion:'eu-south-2',backupRegions:[],
    flows:flows.map((flow,i)=>({...flow,dataClasses:[flow.dataClass],regions:[region],evidenceId:`synthetic-evidence-${i}`,qualified:true})),
    smtpBindings:purposes.map(purpose=>({purpose:purpose as MailPurpose,evidenceId:`synthetic-evidence-${flows.findIndex(flow=>flow.serviceId===purpose&&flow.dataClass!=='email-metadata')}`,
      host:`email-smtp.${region}.amazonaws.com`,port:465})),
  };
  const input={scope:{country:'ES',providerAccountId:account,region},policyRevision:3,revision:'synthetic-config-1',purposes,flows,
    identityArn:arn('ses','identity/mail.example.test'),configurationSet:'transactional',configurationSetArn:arn('ses','configuration-set/transactional'),
    topicArn:arn('sns','mail-feedback'),queueArn:arn('sqs','mail-feedback'),queueUrl,dlqArn:arn('sqs','mail-feedback-dead'),
    smtpHost:`email-smtp.${region}.amazonaws.com`,smtpPort:465};
  const countryPolicy:CountryPolicy=policy;
  const boundPolicy={...countryPolicy,smtpBindings:policy.smtpBindings!.map(binding=>({...binding,revision:input.revision,
    identityArn:input.identityArn,configurationSetArn:input.configurationSetArn,topicArn:input.topicArn,queueArn:input.queueArn,dlqArn:input.dlqArn}))};
  return {policy:boundPolicy,input};
}

export const attemptTag='A'.repeat(43);
export function feedbackEvent() {
  const {input}=feedbackFixture();
  return {eventType:'Bounce',mail:{timestamp:'2026-11-04T10:00:00.000Z',messageId:'ses-message-1',sendingAccountId:'123456789012',
    sourceArn:input.identityArn,destination:['Owner@Example.test'],tags:{'ses:configuration-set':['transactional'],'waitron-attempt':[attemptTag]}},
    bounce:{bounceType:'Permanent',bounceSubType:'General',timestamp:'2026-11-04T10:01:00.000Z',feedbackId:'bounce-1',
      bouncedRecipients:[{emailAddress:'owner@example.test'}]}};
}
export function feedbackEnvelope(event:unknown=feedbackEvent()) {
  return {Type:'Notification',MessageId:'sns-message-1',TopicArn:feedbackFixture().input.topicArn,
    Timestamp:'2026-11-04T10:02:00.000Z',Message:JSON.stringify(event)};
}
