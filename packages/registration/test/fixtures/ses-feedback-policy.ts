import {feedbackFixture} from './ses-feedback.ts';

// Hand-written AWS document subset; none of these identifiers denotes a deployment.
export function feedbackPolicyFixture(region='eu-north-1',purposes=['cloud-account-email']) {
 const {policy,input}=feedbackFixture(region,purposes);
 const role=(name:string)=>`arn:aws:iam::123456789012:role/${name}`;
 const keyArn=`arn:aws:kms:${region}:123456789012:key/11111111-2222-4333-8444-555555555555`;
 const identities={smtp:role('mail-smtp'),consumer:role('feedback-consumer'),health:role('feedback-health'),
  operator:role('feedback-operator'),keyAdministrator:role('feedback-key-admin')};
 const documents={version:1,revision:input.revision,countries:['ES'],
  configurationSet:{Arn:input.configurationSetArn,Enabled:true,TopicArn:input.topicArn,
   MatchingEventTypes:['BOUNCE','COMPLAINT','DELIVERY','DELIVERY_DELAY','REJECT']},
  topic:{TopicArn:input.topicArn,FifoTopic:false,Policy:{Version:'2012-10-17',Statement:[{
   Effect:'Allow',Principal:{Service:'ses.amazonaws.com'},Action:['sns:Publish'],Resource:input.topicArn,
   Condition:{StringEquals:{'AWS:SourceAccount':'123456789012','AWS:SourceArn':input.configurationSetArn}},
  }]}},
  subscription:{TopicArn:input.topicArn,Protocol:'sqs',Endpoint:input.queueArn,RawMessageDelivery:false},
  queue:{QueueArn:input.queueArn,FifoQueue:false,KmsMasterKeyId:keyArn,
   RedrivePolicy:{deadLetterTargetArn:input.dlqArn,maxReceiveCount:5},
   RedriveAllowPolicy:{redrivePermission:'denyAll'},
   Policy:{Version:'2012-10-17',Statement:[{
    Effect:'Allow',Principal:{Service:'sns.amazonaws.com'},Action:['sqs:SendMessage'],Resource:input.queueArn,
    Condition:{StringEquals:{'aws:SourceAccount':'123456789012','aws:SourceArn':input.topicArn}},
   }]}},
  dlq:{QueueArn:input.dlqArn,FifoQueue:false,KmsMasterKeyId:keyArn,
   RedriveAllowPolicy:{redrivePermission:'byQueue',sourceQueueArns:[input.queueArn]},
   Policy:{Version:'2012-10-17',Statement:[]}},
  identities,
  consumerPolicy:{Version:'2012-10-17',Statement:[
   {Effect:'Allow',Action:['sqs:ReceiveMessage','sqs:DeleteMessage','sqs:GetQueueAttributes'],Resource:input.queueArn},
   {Effect:'Allow',Action:['kms:Decrypt'],Resource:keyArn},
  ]},
  healthPolicy:{Version:'2012-10-17',Statement:[
   {Effect:'Allow',Action:['sqs:GetQueueAttributes'],Resource:input.dlqArn},
  ]},
  smtpPolicy:{Version:'2012-10-17',Statement:[
   {Effect:'Allow',Action:['ses:SendRawEmail'],Resource:input.identityArn},
  ]},
  key:{Arn:keyArn,KeyState:'Enabled',KeyManager:'CUSTOMER',KeySpec:'SYMMETRIC_DEFAULT',KeyUsage:'ENCRYPT_DECRYPT',
   Policy:{Version:'2012-10-17',Statement:[
    {Effect:'Allow',Principal:{AWS:identities.keyAdministrator},
     Action:['kms:DescribeKey','kms:GetKeyPolicy','kms:PutKeyPolicy','kms:EnableKey','kms:DisableKey','kms:ScheduleKeyDeletion','kms:CancelKeyDeletion'],Resource:'*'},
    {Effect:'Allow',Principal:{Service:'sns.amazonaws.com'},Action:['kms:GenerateDataKey','kms:Decrypt'],Resource:'*',
     Condition:{StringEquals:{'aws:SourceAccount':'123456789012','aws:SourceArn':input.topicArn}}},
    {Effect:'Allow',Principal:{AWS:identities.consumer},Action:['kms:Decrypt'],Resource:'*'},
   ]}},
 };
 return {policy,input,documents};
}
