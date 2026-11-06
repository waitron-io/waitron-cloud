import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateSesFeedbackConfig} from '../src/ses-feedback-config.ts';
import {feedbackPolicyFixture} from './fixtures/ses-feedback-policy.ts';

test('accepts exact offline documents for either approved region without enabling a service',async()=>{
 await assert.doesNotReject(async()=>{
  const {validateSesFeedbackPolicies}=await import('../src/ses-feedback-policy.ts');
  for(const region of ['eu-north-1','eu-west-3']) {
   const {policy,input,documents}=feedbackPolicyFixture(region);
   assert.equal(validateSesFeedbackPolicies(validateSesFeedbackConfig(policy,input),documents),undefined);
  }
 });
});

const validate=async()=> (await import('../src/ses-feedback-policy.ts')).validateSesFeedbackPolicies;
type Documents=ReturnType<typeof feedbackPolicyFixture>['documents'];

test('refusesBroadenedPublisherOrConsumerPolicy',async t=>{
 const check=await validate();
 const changes:[string,(d:Documents)=>void][]=[
  ['missing SES source account',d=>{delete (d.topic.Policy.Statement[0]!.Condition.StringEquals as any)['AWS:SourceAccount'];}],
  ['missing configuration set source',d=>{delete (d.topic.Policy.Statement[0]!.Condition.StringEquals as any)['AWS:SourceArn'];}],
  ['wrong SES principal',d=>{d.topic.Policy.Statement[0]!.Principal.Service='sns.amazonaws.com';}],
  ['direct publisher',d=>{(d.topic.Policy.Statement[0]!.Principal as any)={AWS:d.identities.consumer};}],
  ['public topic',d=>{(d.topic.Policy.Statement[0]!.Principal as any)='*';}],
  ['wrong topic account',d=>{d.topic.Policy.Statement[0]!.Resource=d.topic.TopicArn.replace('123456789012','999999999999');}],
  ['wildcard topic',d=>{d.topic.Policy.Statement[0]!.Resource='*';}],
  ['wrong source configuration set',d=>{d.topic.Policy.Statement[0]!.Condition.StringEquals['AWS:SourceArn']+='-other';}],
  ['wrong source account',d=>{d.topic.Policy.Statement[0]!.Condition.StringEquals['AWS:SourceAccount']='999999999999';}],
  ['extra publish statement',d=>{d.topic.Policy.Statement.push({...d.topic.Policy.Statement[0]!,Resource:'*'});}],
  ['not-action broadening',d=>{(d.consumerPolicy.Statement[0] as any).NotAction=['sqs:PurgeQueue'];}],
  ['wildcard consumer resource',d=>{d.consumerPolicy.Statement[0]!.Resource='*';}],
  ...['sns:Publish','sqs:SendMessage','sqs:PurgeQueue','sqs:SetQueueAttributes','sqs:StartMessageMoveTask','ses:DeleteSuppressedDestination','kms:PutKeyPolicy'].map(action=>
   [`consumer ${action}`,(d:Documents)=>{d.consumerPolicy.Statement[0]!.Action.push(action);}] as [string,(d:Documents)=>void]),
  ['DLQ message access',d=>{d.healthPolicy.Statement[0]!.Action.push('sqs:ReceiveMessage');}],
  ['health decrypt',d=>{d.healthPolicy.Statement.push({Effect:'Allow',Action:['kms:Decrypt'],Resource:d.key.Arn});}],
  ['health reads primary instead',d=>{d.healthPolicy.Statement[0]!.Resource=d.queue.QueueArn;}],
  ['SMTP administers suppression',d=>{d.smtpPolicy.Statement[0]!.Action.push('ses:DeleteSuppressedDestination');}],
  ['SMTP uses different identity',d=>{d.smtpPolicy.Statement[0]!.Resource[0]+='-other';}],
  ['SMTP missing configuration set',d=>{d.smtpPolicy.Statement[0]!.Resource.pop();}],
  ['SMTP wrong configuration set',d=>{d.smtpPolicy.Statement[0]!.Resource[1]+='-other';}],
  ['SMTP uses role credentials',d=>{d.identities.smtp='arn:aws:iam::123456789012:role/mail-smtp';}],
  ['consumer decrypts different key',d=>{d.consumerPolicy.Statement[1]!.Resource+='-other';}],
  ['key public decrypt',d=>{(d.key.Policy.Statement[2]!.Principal as any)='*';}],
  ['key extra decrypt action',d=>{d.key.Policy.Statement[2]!.Action.push('kms:GenerateDataKey');}],
  ['key wrong SNS source',d=>{d.key.Policy.Statement[1]!.Condition!.StringEquals['aws:SourceArn']+='-other';}],
  ['key missing source',d=>{delete (d.key.Policy.Statement[1] as any).Condition;}],
  ['key wildcard action',d=>{d.key.Policy.Statement[0]!.Action=['kms:*'];}],
  ['roles share credentials',d=>{d.identities.smtp=d.identities.consumer;}],
  ['extra credential identity',d=>{(d.identities as any).publisher=d.identities.consumer;}],
  ['foreign operator',d=>{d.identities.operator=d.identities.operator.replace('123456789012','999999999999');}],
 ];
 for(const [name,change] of changes)await t.test(name,()=>{
  const {policy,input,documents}=feedbackPolicyFixture();change(documents);
  assert.throws(()=>check(validateSesFeedbackConfig(policy,input),documents),{message:'Invalid SES feedback policies'});
 });
});

test('refusesDriftAndUnencryptedOrPublicQueues',async t=>{
 const check=await validate();
 const changes:[string,(d:Documents)=>void][]=[
  ['stale revision',d=>{d.revision='old';}],['unknown version',d=>{d.version=2;}],
  ['wrong configuration set',d=>{d.configurationSet.Arn+='-other';}],
  ['destination disabled',d=>{d.configurationSet.Enabled=false;}],
  ['destination wrong topic',d=>{d.configurationSet.TopicArn+='-other';}],
  ['tracking open',d=>{d.configurationSet.MatchingEventTypes.push('OPEN');}],
  ['unqualified rendering failure',d=>{d.configurationSet.MatchingEventTypes.push('RENDERING_FAILURE');}],
  ['missing complaint',d=>{d.configurationSet.MatchingEventTypes=d.configurationSet.MatchingEventTypes.filter(x=>x!=='COMPLAINT');}],
  ['wrong topic region',d=>{d.topic.TopicArn=d.topic.TopicArn.replace('eu-north-1','eu-west-3');}],
  ['FIFO topic',d=>{d.topic.FifoTopic=true;}],['raw delivery',d=>{d.subscription.RawMessageDelivery=true;}],
  ['wrong subscription source',d=>{d.subscription.TopicArn+='-other';}],
  ['wrong subscription destination',d=>{d.subscription.Endpoint=d.dlq.QueueArn;}],
  ['HTTP subscription',d=>{d.subscription.Protocol='https';}],
  ['wrong queue',d=>{d.queue.QueueArn=d.dlq.QueueArn;}],['FIFO queue',d=>{d.queue.FifoQueue=true;}],
  ['unencrypted primary',d=>{d.queue.KmsMasterKeyId='';}],['unencrypted DLQ',d=>{d.dlq.KmsMasterKeyId='';}],
  ['wrong DLQ',d=>{d.dlq.QueueArn+='-other';}],['FIFO DLQ',d=>{d.dlq.FifoQueue=true;}],
  ['wrong SNS principal',d=>{d.queue.Policy.Statement[0]!.Principal.Service='ses.amazonaws.com';}],
  ['missing SNS source',d=>{delete (d.queue.Policy.Statement[0] as any).Condition;}],
  ['wrong SNS source',d=>{d.queue.Policy.Statement[0]!.Condition.StringEquals['aws:SourceArn']+='-other';}],
  ['wrong SNS account',d=>{d.queue.Policy.Statement[0]!.Condition.StringEquals['aws:SourceAccount']='999999999999';}],
  ['public queue',d=>{(d.queue.Policy.Statement[0]!.Principal as any)='*';}],
  ['wildcard queue resource',d=>{d.queue.Policy.Statement[0]!.Resource='*';}],
  ['direct DLQ publisher',d=>{(d.dlq.Policy.Statement as any[]).push({...d.queue.Policy.Statement[0],Resource:d.dlq.QueueArn});}],
  ['missing redrive',d=>{delete (d.queue as any).RedrivePolicy;}],
  ['wrong redrive target',d=>{d.queue.RedrivePolicy.deadLetterTargetArn=d.queue.QueueArn;}],
  ['zero receives',d=>{d.queue.RedrivePolicy.maxReceiveCount=0;}],
  ['fractional receives',d=>{d.queue.RedrivePolicy.maxReceiveCount=1.5;}],
  ['unbounded receives',d=>{d.queue.RedrivePolicy.maxReceiveCount=Infinity;}],
  ['primary accepts redrive sources',d=>{d.queue.RedriveAllowPolicy.redrivePermission='allowAll';}],
  ['DLQ accepts all sources',d=>{d.dlq.RedriveAllowPolicy.redrivePermission='allowAll';}],
  ['foreign redrive source',d=>{d.dlq.RedriveAllowPolicy.sourceQueueArns.push(d.queue.QueueArn+'-foreign');}],
  ['wrong key region',d=>{d.key.Arn=d.key.Arn.replace('eu-north-1','eu-west-3');}],
  ['key alias',d=>{d.key.Arn=d.key.Arn.replace('key/','alias/');}],
  ['disabled key',d=>{d.key.KeyState='Disabled';}],['AWS-managed key',d=>{d.key.KeyManager='AWS';}],
  ['signing key',d=>{d.key.KeyUsage='SIGN_VERIFY';}],['asymmetric key',d=>{d.key.KeySpec='RSA_2048';}],
 ];
 for(const [name,change] of changes)await t.test(name,()=>{
  const {policy,input,documents}=feedbackPolicyFixture();change(documents);
  assert.throws(()=>check(validateSesFeedbackConfig(policy,input),documents),{message:'Invalid SES feedback policies'});
 });
});

test('rejectsSecondCountryWithoutApprovedIsolation',async()=>{
 const check=await validate();
 for(const countries of [[],['FR'],['ES','FR'],['ES','ES']]) {
  const {policy,input,documents}=feedbackPolicyFixture();documents.countries=countries;
  assert.throws(()=>check(validateSesFeedbackConfig(policy,input),documents),{message:'Invalid SES feedback policies'});
 }
 const {policy,input,documents}=feedbackPolicyFixture();
 assert.throws(()=>check(validateSesFeedbackConfig(policy,input),{...documents,approvedIsolation:true}),{message:'Invalid SES feedback policies'});
});

test('incomplete, unknown or executable document data cannot qualify',async()=>{
 const check=await validate();const {policy,input,documents}=feedbackPolicyFixture();const config=validateSesFeedbackConfig(policy,input);
 for(const field of Object.keys(documents)) {
  const copy:any=structuredClone(documents);delete copy[field];
  assert.throws(()=>check(config,copy),{message:'Invalid SES feedback policies'},field);
 }
 for(const value of [undefined,null,[],false,'policy',{}, {...documents,qualified:true}])
  assert.throws(()=>check(config,value),{message:'Invalid SES feedback policies'});
 assert.throws(()=>check({...config},documents),{message:'Invalid SES feedback policies'});
 let read=false;const copy=structuredClone(documents);
 Object.defineProperty(copy,'revision',{get:()=>{read=true;return input.revision;},enumerable:true});
 assert.throws(()=>check(config,copy),{message:'Invalid SES feedback policies'});assert.equal(read,false);
 const arrayCopy=structuredClone(documents);
 Object.defineProperty(arrayCopy.countries,0,{get:()=>{read=true;return 'ES';},enumerable:true});
 assert.throws(()=>check(config,arrayCopy),{message:'Invalid SES feedback policies'});assert.equal(read,false);
 const cycle:any=structuredClone(documents);cycle.cycle=cycle;
 assert.throws(()=>check(config,cycle),{message:'Invalid SES feedback policies'});
});

test('productionRelayRemainsUnavailable',async()=>{
 const check=await validate();const {policy,input,documents}=feedbackPolicyFixture('eu-north-1',['cloud-account-email','venue-email']);
 check(validateSesFeedbackConfig(policy,input),documents);
 const {RelayMessages}=await import('../src/relay-messages.ts');
 const {spainCountryPolicy}=await import('../src/country-policy.ts');
 assert.throws(()=>new RelayMessages({} as any,{} as any,'https://cloud.example.test',{mode:'production'} as any),
  {message:'relay_unavailable'});
 const aligned={...input,policyRevision:1,flows:input.flows.map(flow=>({...flow,policyRevision:1}))};
 assert.doesNotThrow(()=>validateSesFeedbackConfig({...policy,revision:1},aligned));
 assert.throws(()=>validateSesFeedbackConfig(spainCountryPolicy,aligned),{message:'Invalid SES feedback configuration'});
});

test('self-consistent resource documents still require a regional key, separate roles and bounded redrive',async t=>{
 const check=await validate();
 for(const key of ['arn:aws:kms:eu-west-3:123456789012:key/11111111-2222-4333-8444-555555555555',
  'arn:aws:kms:eu-north-1:999999999999:key/11111111-2222-4333-8444-555555555555',
  'arn:aws:kms:eu-north-1:123456789012:alias/mail-feedback',
  'arn:aws:kms:eu-north-1:123456789012:key/*',
  'arn:aws:kms:eu-north-1:123456789012:key/11111111-2222-4333-8444-555555555555\n'])await t.test(key,()=>{
  const {policy,input,documents:d}=feedbackPolicyFixture();
  d.key.Arn=key;d.queue.KmsMasterKeyId=key;d.dlq.KmsMasterKeyId=key;d.consumerPolicy.Statement[1]!.Resource=key;
  assert.throws(()=>check(validateSesFeedbackConfig(policy,input),d),{message:'Invalid SES feedback policies'});
 });
 for(const role of ['arn:aws:iam::999999999999:role/consumer','arn:aws:iam::123456789012:user/consumer',
  'arn:aws:iam::123456789012:role/*','arn:aws:iam::123456789012:role/consumer\n'])await t.test(role,()=>{
  const {policy,input,documents:d}=feedbackPolicyFixture();d.identities.consumer=role;d.key.Policy.Statement[2]!.Principal={AWS:role};
  assert.throws(()=>check(validateSesFeedbackConfig(policy,input),d),{message:'Invalid SES feedback policies'});
 });
 for(const count of [-1,0,1.5,1001,Infinity]) {
  const {policy,input,documents}=feedbackPolicyFixture();documents.queue.RedrivePolicy.maxReceiveCount=count;
  assert.throws(()=>check(validateSesFeedbackConfig(policy,input),documents),{message:'Invalid SES feedback policies'});
 }
 for(const count of [1,1000]) {
  const {policy,input,documents}=feedbackPolicyFixture();documents.queue.RedrivePolicy.maxReceiveCount=count;
  check(validateSesFeedbackConfig(policy,input),documents);
 }
});

test('array methods and custom prototypes cannot execute while validating documents',async()=>{
 const check=await validate();
 for(const inherited of [false,true]) {
  const {policy,input,documents}=feedbackPolicyFixture();let executed=false;
  const map=()=>{executed=true;return ['ES'];};
  if(inherited)Object.setPrototypeOf(documents.countries,{map});
  else Object.defineProperty(documents.countries,'map',{value:map});
  assert.throws(()=>check(validateSesFeedbackConfig(policy,input),documents),{message:'Invalid SES feedback policies'});
  assert.equal(executed,false);
 }
});

test('SMTP uses a distinct IAM user and service roles cannot alias through case or path',async()=>{
 const check=await validate();
 const {policy,input,documents}=feedbackPolicyFixture();
 documents.identities.smtp='arn:aws:iam::123456789012:user/mail-smtp';
 assert.doesNotThrow(()=>check(validateSesFeedbackConfig(policy,input),documents));
 for(const health of ['arn:aws:iam::123456789012:role/Feedback-Consumer','arn:aws:iam::123456789012:role/service/feedback-consumer']) {
  const f=feedbackPolicyFixture();f.documents.identities.health=health;
  assert.throws(()=>check(validateSesFeedbackConfig(f.policy,f.input),f.documents),{message:'Invalid SES feedback policies'});
 }
});

test('oversized objects refuse before reading their member descriptors',async()=>{
 const check=await validate();const {policy,input}=feedbackPolicyFixture();let reads=0;
 const huge=new Proxy({}, {ownKeys:()=>Array.from({length:130},(_,i)=>String(i)),
  getOwnPropertyDescriptor:()=>{reads++;return {value:null,configurable:true,enumerable:true,writable:true};}});
 assert.throws(()=>check(validateSesFeedbackConfig(policy,input),huge),{message:'Invalid SES feedback policies'});
 assert.equal(reads,0);
});

test('string, array, depth and node bounds stop traversal before later document members',async t=>{
 const check=await validate();
 const cases:[string,()=>unknown][]=[
  ['string',()=> 'x'.repeat(4097)],['array',()=>Array(129).fill(null)],
  ['depth',()=>{let value:unknown=null;for(let n=0;n<18;n++)value={child:value};return value;}],
  ['nodes',()=>Array.from({length:16},()=>Array(128).fill(null))],
 ];
 for(const [name,first] of cases)await t.test(name,()=>{
  const {policy,input,documents}=feedbackPolicyFixture();let reads=0;
  const later=new Proxy({}, {ownKeys:()=>{reads++;return [];}});
  assert.throws(()=>check(validateSesFeedbackConfig(policy,input),{first:first(),later,...documents}),{message:'Invalid SES feedback policies'});
  assert.equal(reads,0);
 });
});

test('SMTP send permission names both the exact identity and configuration set',async()=>{
 const check=await validate();const {policy,input,documents}=feedbackPolicyFixture();
 (documents.smtpPolicy.Statement[0] as any).Resource=[input.identityArn,input.configurationSetArn];
 assert.doesNotThrow(()=>check(validateSesFeedbackConfig(policy,input),documents));
});

test('array wrappers cannot hide a country, publisher, extra field or sparse grant',async t=>{
 const check=await validate();
 const cases:[string,(d:Documents)=>void][]=[
  ['proxy map',d=>{d.countries=new Proxy(['ES','FR'],{get:(target,key,receiver)=>key==='map'?()=>['ES']:Reflect.get(target,key,receiver)});}],
  ['array species',d=>{d.countries=['ES','FR'];Object.defineProperty(d.countries,'constructor',{value:{[Symbol.species]:function(){return ['ES'];}}});}],
  ['hidden public publisher',d=>{const original=structuredClone(d.topic.Policy.Statement);d.topic.Policy.Statement[0]!.Principal='*' as any;
   Object.defineProperty(d.topic.Policy.Statement,'map',{value:()=>original});}],
  ['extra grant property',d=>{(d.dlq.Policy.Statement as any).publisher='public';}],
  ['sparse grant',d=>{(d.dlq.Policy as {Statement:unknown[]}).Statement=Array(1);}],
 ];
 for(const [name,change] of cases)await t.test(name,()=>{
  const {policy,input,documents}=feedbackPolicyFixture();change(documents);
  assert.throws(()=>check(validateSesFeedbackConfig(policy,input),documents),{message:'Invalid SES feedback policies'});
 });
});
