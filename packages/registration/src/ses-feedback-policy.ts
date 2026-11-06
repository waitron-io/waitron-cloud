import {isValidatedSesFeedbackConfig,type SesFeedbackConfig} from './ses-feedback-config.ts';

const refuse=():never=>{throw new Error('Invalid SES feedback policies');};

// Only inert, bounded JSON data enters the document comparison. Accessors cannot
// change a binding between inspection and comparison, or execute during export.
function data(value:unknown,depth=0,budget={remaining:2000}):unknown {
 if(--budget.remaining<0||depth>16)return refuse();
 if(value===null||typeof value==='boolean')return value;
 if(typeof value==='string')return value.length<=4096?value:refuse();
 if(typeof value==='number')return Number.isFinite(value)?value:refuse();
 if(typeof value!=='object')return refuse();
 if(Array.isArray(value)) {
  if(value.length>128||Object.getPrototypeOf(value)!==Array.prototype)return refuse();
 }else if(Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)return refuse();
 const keys=Reflect.ownKeys(value);
 if(keys.length>129||keys.some(k=>typeof k!=='string'))return refuse();
 const descriptors=Object.getOwnPropertyDescriptors(value);
 if(Object.values(descriptors).some(d=>d.get||d.set))return refuse();
 if(Array.isArray(value)) {
  const length=descriptors.length!.value as number;
  if(Object.keys(descriptors).length!==length+1)return refuse();
  const copy:unknown[]=[];
  for(let index=0;index<length;index++) {
   const descriptor=descriptors[String(index)];
   if(!descriptor)return refuse();
   copy.push(data(descriptor.value,depth+1,budget));
  }
  return copy;
 }
 return Object.fromEntries(Object.entries(descriptors).map(([key,d])=>[key,data(d.value,depth+1,budget)]));
}
function object(value:unknown):Record<string,unknown> {
 return value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:refuse();
}
// Actions, statements and source inventories are sets in this limited profile.
// Sorting retains duplicates so an extra permission cannot disappear in comparison.
function canonical(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(canonical).sort().join(',')+']';
 if(value!==null&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b))
  .map(([key,item])=>JSON.stringify(key)+':'+canonical(item)).join(',')+'}';
 return JSON.stringify(value);
}
const policy=(...Statement:unknown[])=>({Version:'2012-10-17',Statement});
const allow=(Action:string[],Resource:string|readonly string[],Principal?:unknown,Condition?:unknown)=>({Effect:'Allow',Action,Resource,
 ...(Principal===undefined?{}:{Principal}),...(Condition===undefined?{}:{Condition})});

/** Validate a closed offline AWS-document subset, never effective IAM or live drift.
 * Unknown statements and fields refuse rather than attempting general IAM evaluation.
 * A successful check returns no runtime permission or configuration qualification.
 */
export function validateSesFeedbackPolicies(config:SesFeedbackConfig,documents:unknown):void {
 if(!isValidatedSesFeedbackConfig(config))return refuse();
 const d=object(data(documents)),identities=object(d.identities),key=object(d.key),queue=object(d.queue);
 const {providerAccountId:account,region,country}=config.scope;
 const roles=['smtp','consumer','health','operator','keyAdministrator'];
 const names:string[]=[];
 for(const name of roles) {
  const kind=name==='smtp'?'user':'role',prefix=`arn:aws:iam::${account}:${kind}/`,arn=identities[name];
  if(typeof arn!=='string'||!arn.startsWith(prefix)||!/^[A-Za-z0-9+=,.@_-]+(?:\/[A-Za-z0-9+=,.@_-]+)*$/.test(arn.slice(prefix.length))
   ||arn.slice(prefix.length).length>128)return refuse();
  names.push(kind+':'+arn.split('/').at(-1)!.toLowerCase());
 }
 // IAM names are unique within each identity type and account, regardless of path
 // or letter case. A differently spelled ARN is not evidence of a second identity.
 if(new Set(names).size!==roles.length)return refuse();
 const keyPrefix=`arn:aws:kms:${region}:${account}:key/`;
 if(typeof key.Arn!=='string'||!key.Arn.startsWith(keyPrefix)
  ||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(key.Arn.slice(keyPrefix.length)))return refuse();
 const redrive=object(queue.RedrivePolicy),count=redrive.maxReceiveCount;
 if(typeof count!=='number'||!Number.isSafeInteger(count)||count<1||count>1000)return refuse();
 const source=(arn:string,upper=false)=>({StringEquals:upper
  ?{'AWS:SourceAccount':account,'AWS:SourceArn':arn}:{'aws:SourceAccount':account,'aws:SourceArn':arn}});
 const expected={version:1,revision:config.revision,countries:[country],
  configurationSet:{Arn:config.configurationSetArn,Enabled:true,TopicArn:config.topicArn,
   MatchingEventTypes:['BOUNCE','COMPLAINT','DELIVERY','DELIVERY_DELAY','REJECT']},
  topic:{TopicArn:config.topicArn,FifoTopic:false,Policy:policy(
   allow(['sns:Publish'],config.topicArn,{Service:'ses.amazonaws.com'},source(config.configurationSetArn,true)))},
  subscription:{TopicArn:config.topicArn,Protocol:'sqs',Endpoint:config.queueArn,RawMessageDelivery:false},
  queue:{QueueArn:config.queueArn,FifoQueue:false,KmsMasterKeyId:key.Arn,
   RedrivePolicy:{deadLetterTargetArn:config.dlqArn,maxReceiveCount:count},RedriveAllowPolicy:{redrivePermission:'denyAll'},
   Policy:policy(allow(['sqs:SendMessage'],config.queueArn,{Service:'sns.amazonaws.com'},source(config.topicArn)))},
  dlq:{QueueArn:config.dlqArn,FifoQueue:false,KmsMasterKeyId:key.Arn,
   RedriveAllowPolicy:{redrivePermission:'byQueue',sourceQueueArns:[config.queueArn]},Policy:policy()},
  identities:Object.fromEntries(roles.map(name=>[name,identities[name]])),
  consumerPolicy:policy(allow(['sqs:ReceiveMessage','sqs:DeleteMessage','sqs:GetQueueAttributes'],config.queueArn),
   allow(['kms:Decrypt'],key.Arn)),
  healthPolicy:policy(allow(['sqs:GetQueueAttributes'],config.dlqArn)),
  smtpPolicy:policy(allow(['ses:SendRawEmail'],[config.identityArn,config.configurationSetArn])),
  key:{Arn:key.Arn,KeyState:'Enabled',KeyManager:'CUSTOMER',KeySpec:'SYMMETRIC_DEFAULT',KeyUsage:'ENCRYPT_DECRYPT',
   // In a KMS key policy, '*' denotes only the key carrying that policy. Identity
   // policies above must instead name its full ARN, never a wildcard or alias.
   Policy:policy(allow(['kms:DescribeKey','kms:GetKeyPolicy','kms:PutKeyPolicy','kms:EnableKey','kms:DisableKey',
    'kms:ScheduleKeyDeletion','kms:CancelKeyDeletion'],'*',{AWS:identities.keyAdministrator}),
    allow(['kms:GenerateDataKey','kms:Decrypt'],'*',{Service:'sns.amazonaws.com'},source(config.topicArn)),
    allow(['kms:Decrypt'],'*',{AWS:identities.consumer}))},
 };
 if(canonical(d)!==canonical(expected))return refuse();
}
