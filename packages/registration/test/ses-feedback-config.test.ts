import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateSesFeedbackConfig} from '../src/ses-feedback-config.ts';
import {spainCountryPolicy} from '../src/country-policy.ts';
import {feedbackFixture} from './fixtures/ses-feedback.ts';

test('exact qualified bindings produce an immutable independent configuration for either approved region',()=>{
  for(const region of ['eu-north-1','eu-west-3']) {
    const {policy,input}=feedbackFixture(region,['cloud-account-email','venue-email']);
    const config=validateSesFeedbackConfig(policy,input);
    assert.deepEqual(config,input);
    input.scope.country='FR';input.purposes.length=0;input.flows[0]!.endpoint='https://other.example.test/';
    assert.equal(config.scope.country,'ES');assert.equal(config.purposes.length,2);
    assert.equal(config.flows[0]!.endpoint,`https://email.${region}.amazonaws.com/`);
    assert.throws(()=>{(config.scope as {country:string}).country='FR';},TypeError);
    assert.throws(()=>{(config.flows[0] as {endpoint:string}).endpoint='https://other.example.test/';},TypeError);
    assert.ok(Object.isFrozen(config)&&Object.isFrozen(config.flows)&&Object.isFrozen(config.purposes));
  }
});

test('omitted region defaults to Stockholm without a provider fallback',()=>{
  const {policy,input}=feedbackFixture();delete (input.scope as {region?:string}).region;
  assert.equal(validateSesFeedbackConfig(policy,input).scope.region,'eu-north-1');
});

test('rejectsIncompleteOrMixedQualifiedBindings',()=>{
  const mutations:((input:ReturnType<typeof feedbackFixture>['input'])=>void)[]=[
    i=>{i.policyRevision=2;}, i=>{i.scope.country='FR';}, i=>{i.scope.providerAccountId='999999999999';},
    i=>{i.scope.providerAccountId='';},i=>{i.scope.region='eu-south-2';},i=>{i.scope.region='';},
    i=>{i.revision='';},i=>{i.revision=' config ';},i=>{i.purposes=[];},i=>{i.purposes.push('marketing');},
    i=>{i.purposes.push('cloud-account-email');},i=>{i.purposes.push('venue-email');},
    i=>{i.smtpHost='email-smtp.eu-west-3.amazonaws.com';},i=>{i.smtpPort=587;},
    i=>{i.identityArn=i.identityArn.replace('123456789012','999999999999');},
    i=>{i.identityArn=i.identityArn.replace('eu-north-1','eu-west-3');},i=>{i.identityArn=i.identityArn.replace('identity/','configuration-set/');},
    i=>{i.configurationSetArn+='-wrong';},i=>{i.configurationSet='';},i=>{i.configurationSet='bad/name';},
    i=>{i.topicArn+='.fifo';},i=>{i.topicArn=i.topicArn.replace(':sns:',':sqs:');},
    i=>{i.queueArn=i.queueArn.replace(':eu-north-1:',':eu-west-3:');},
    i=>{i.queueUrl+='?secret=1';},i=>{i.queueUrl=i.queueUrl.replace('https:','http:');},
    i=>{i.queueUrl=i.queueUrl.replace('/mail-feedback','/wrong');},
    i=>{i.dlqArn=i.queueArn;},i=>{i.dlqArn+='.fifo';},
    i=>{i.flows.pop();},i=>{i.flows[0]!.accountId='other';},i=>{i.flows[0]!.dataClass='email-metadata';},
    i=>{i.flows[0]!.endpoint+='?redirect=1';},i=>{i.flows[0]!.supplierId='other';},
  ];
  for(const mutate of mutations) {
    const {policy,input}=feedbackFixture();mutate(input);
    assert.throws(()=>validateSesFeedbackConfig(policy,input),{message:'Invalid SES feedback configuration'},String(mutate));
  }
  for(const field of Object.keys(feedbackFixture().input)) {
    if(field==='scope')continue;
    const {policy,input}=feedbackFixture();delete (input as Record<string,unknown>)[field];
    assert.throws(()=>validateSesFeedbackConfig(policy,input),{message:'Invalid SES feedback configuration'},field);
  }
  for(const value of [null,[],false,'config',{}, {scope:null}])assert.throws(()=>validateSesFeedbackConfig(spainCountryPolicy,value));
});

test('caller qualification cannot replace trusted policy, complete evidence or SMTP qualification',()=>{
  const {policy,input}=feedbackFixture();
  assert.throws(()=>validateSesFeedbackConfig(spainCountryPolicy,{...input,policy,qualified:true}));
  for(let n=0;n<policy.flows.length;n++) {
    const flows=policy.flows.map((f,i)=>i===n?{...f,qualified:false}:f);
    assert.throws(()=>validateSesFeedbackConfig({...policy,flows},input),{message:'Invalid SES feedback configuration'},`flow ${n}`);
  }
  const split=policy.flows.flatMap(f=>[{...f,accountId:'other'},{...f,endpoint:'https://other.example.test/'}]);
  assert.throws(()=>validateSesFeedbackConfig({...policy,flows:split},input));
  for(const smtpBindings of [[],[{...policy.smtpBindings[0]!,purpose:'cloud-account-email' as const,evidenceId:'other',host:input.smtpHost,port:465}],
    [{...policy.smtpBindings[0]!,purpose:'cloud-account-email' as const,evidenceId:'synthetic-evidence-0',host:input.smtpHost,port:587}]])
    assert.throws(()=>validateSesFeedbackConfig({...policy,smtpBindings},input));
});

test('trusted evidence pins the configuration revision and same-account identity, configuration set, topic and queues',()=>{
  for(const change of [(i:any)=>{i.revision='stale-config';},(i:any)=>{i.identityArn=i.identityArn.replace('mail.example.test','other.example.test');},
    (i:any)=>{i.configurationSet='other';i.configurationSetArn=i.configurationSetArn.replace('/transactional','/other');},
    (i:any)=>{i.topicArn=i.topicArn.replace(':mail-feedback',':other');}]) {
    const {policy,input}=feedbackFixture();change(input);
    assert.throws(()=>validateSesFeedbackConfig(policy,input),{message:'Invalid SES feedback configuration'},String(change));
  }
});
