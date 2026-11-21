import {createHash} from 'node:crypto';
import {closeSync, constants, fstatSync, openSync, readSync} from 'node:fs';
import {normaliseEmail} from '../../packages/registration/src/account-input.ts';
import {RelayKeys} from '../../packages/registration/src/relay-payload.ts';
import {validateSesFeedbackConfig} from '../../packages/registration/src/ses-feedback-config.ts';
import {createSmtpAccountMailer} from '../../packages/registration/src/smtp-mailer.ts';

// The reviewed Stockholm sandbox scope stays pinned across credential rotation.
const hostedScopeDigest='4e99c94d0674adb4be6007bfaa5364d1f12e88a26605d4d659a7330bd8d18a27';
const settingsPath='/run/test-cloud-ses.json';
const limit=65536;

function readSettings(path){
 const fd=openSync(path,constants.O_RDONLY|constants.O_NONBLOCK|constants.O_NOFOLLOW);
 try{
  const stat=fstatSync(fd);
  if(!stat.isFile()||(stat.mode&0o7777)!==0o600||stat.size>limit)throw Error();
  const bytes=Buffer.alloc(limit+1), length=readSync(fd,bytes,0,bytes.length,0);
  if(length>limit)throw Error();
  return JSON.parse(bytes.subarray(0,length).toString('utf8'));
 }finally{closeSync(fd);}
}

export function loadTestSesRuntime(environment,{path=settingsPath,digest=hostedScopeDigest}={}){
 if(environment.TEST_CLOUD_AMAZON_SES===undefined)return;
 try{
  if(environment.TEST_CLOUD_AMAZON_SES!=='1')throw Error();
  const {scope,smtp,recipientKeys}=readSettings(path);
  const email=normaliseEmail(scope.mailbox);
  if(!email||scope.origin!==environment.TEST_CLOUD_ORIGIN)throw Error();
  const canonical={...scope,mailbox:email};
  const ordered=Object.fromEntries(Object.keys(canonical).sort().map(key=>[key,canonical[key]]));
  if(createHash('sha256').update(JSON.stringify(ordered)).digest('hex')!==digest)throw Error();
  new RelayKeys(recipientKeys);

  const {country,providerAccountId:accountId,region,policyRevision,purpose:serviceId,bindingRevision:revision,
   identityArn,configurationSetArn,topicArn,queueArn,queueUrl,dlqArn,smtpHost:host,smtpPort:port}=scope;
  const evidenceId='d102-stockholm-sandbox-2026-11-21';
  const sesEndpoint=`https://email.${region}.amazonaws.com/`;
  const flows=[
   ['amazon-ses','account-email',sesEndpoint],['amazon-ses','email-metadata',sesEndpoint],
   ['amazon-sns','email-metadata',`https://sns.${region}.amazonaws.com/`],
   ['amazon-sqs','email-metadata',queueUrl],['amazon-sqs','email-metadata',`https://sqs.${region}.amazonaws.com/${accountId}/${dlqArn.split(':').at(-1)}`],
  ].map(([supplierId,dataClass,endpoint])=>({country,policyRevision,serviceId,supplierId,accountId,dataClass,endpoint,region}));
  const policy={country,revision:policyRevision,homeRegion:region,backupRegions:[],
   flows:flows.map(flow=>({...flow,dataClasses:[flow.dataClass],regions:[region],evidenceId,qualified:true})),
   smtpBindings:[{purpose:serviceId,evidenceId,host,port,revision,identityArn,configurationSetArn,topicArn,queueArn,dlqArn}]};
  const config=validateSesFeedbackConfig(policy,{scope:{country,providerAccountId:accountId,region},policyRevision,
   revision,purposes:[serviceId],flows,identityArn,configurationSetArn,configurationSet:configurationSetArn.split('/').at(-1),
   topicArn,queueArn,queueUrl,dlqArn,smtpHost:host,smtpPort:port});
  const mailer=createSmtpAccountMailer({host,port,user:smtp.user,password:smtp.password,from:scope.sender,portalOrigin:scope.origin},{},config);
  return {email,mailer,ses:{config,recipientKeys}};
 }catch{throw new Error('test_cloud.ses_configuration');}
}
