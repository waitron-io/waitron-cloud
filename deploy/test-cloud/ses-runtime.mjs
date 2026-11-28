import {createHash} from 'node:crypto';
import {closeSync, constants, fstatSync, openSync, readSync} from 'node:fs';
import {normaliseEmail} from '../../packages/registration/src/account-input.ts';
import {RelayKeys} from '../../packages/registration/src/relay-payload.ts';
import {validateSesFeedbackConfig} from '../../packages/registration/src/ses-feedback-config.ts';
import {createSmtpAccountMailer} from '../../packages/registration/src/smtp-mailer.ts';

// The reviewed Stockholm sandbox scope stays pinned across credential rotation.
const hostedScopeDigest='4e99c94d0674adb4be6007bfaa5364d1f12e88a26605d4d659a7330bd8d18a27';
const settingsPath='/run/test-cloud-ses.json';
const venueSettingsPath='/run/test-cloud-venue-ses.json';
const venueScopeDigest=null;
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

function readScopedSettings(path,digest,origin,recipientField){
 if(!digest)throw Error();
 const settings=readSettings(path),scope={...settings.scope,[recipientField]:normaliseEmail(settings.scope[recipientField])};
 if(!scope[recipientField]||scope.origin!==origin)throw Error();
 const ordered=Object.fromEntries(Object.keys(scope).sort().map(key=>[key,scope[key]]));
 if(createHash('sha256').update(JSON.stringify(ordered)).digest('hex')!==digest)throw Error();
 return {...settings,scope};
}

function mailRuntime(scope,smtp,recipientKeys,serviceId,venueIdentityArn){
  const {country,providerAccountId:accountId,region,policyRevision,bindingRevision:revision,
   identityArn,configurationSetArn,topicArn,queueArn,queueUrl,dlqArn,smtpHost:host,smtpPort:port}=scope;
  const evidenceId=serviceId==='venue-email'?'stockholm-venue-email-trial':'d102-stockholm-sandbox-2026-11-21';
  const sesEndpoint=`https://email.${region}.amazonaws.com/`;
  const flows=[
   ['amazon-ses',serviceId==='venue-email'?'venue-email':'account-email',sesEndpoint],['amazon-ses','email-metadata',sesEndpoint],
   ['amazon-sns','email-metadata',`https://sns.${region}.amazonaws.com/`],
   ['amazon-sqs','email-metadata',queueUrl],['amazon-sqs','email-metadata',`https://sqs.${region}.amazonaws.com/${accountId}/${dlqArn.split(':').at(-1)}`],
  ].map(([supplierId,dataClass,endpoint])=>({country,policyRevision,serviceId,supplierId,accountId,dataClass,endpoint,region}));
  const policy={country,revision:policyRevision,homeRegion:region,backupRegions:[],
   flows:flows.map(flow=>({...flow,dataClasses:[flow.dataClass],regions:[region],evidenceId,qualified:true})),
   smtpBindings:[{purpose:serviceId,evidenceId,host,port,revision,identityArn,venueIdentityArn,configurationSetArn,topicArn,queueArn,dlqArn}]};
  const config=validateSesFeedbackConfig(policy,{scope:{country,providerAccountId:accountId,region},policyRevision,
   revision,purposes:[serviceId],flows,identityArn,venueIdentityArn,configurationSetArn,configurationSet:configurationSetArn.split('/').at(-1),
   topicArn,queueArn,queueUrl,dlqArn,smtpHost:host,smtpPort:port});
  return {ses:{config,recipientKeys},smtp:{host,port,user:smtp.user,password:smtp.password,from:scope.sender,portalOrigin:scope.origin}};
}

export function loadTestSesRuntime(environment,{path=settingsPath,digest=hostedScopeDigest}={}){
 if(environment.TEST_CLOUD_AMAZON_SES===undefined)return;
 try{
  if(environment.TEST_CLOUD_AMAZON_SES!=='1')throw Error();
  const {scope,smtp,recipientKeys}=readScopedSettings(path,digest,environment.TEST_CLOUD_ORIGIN,'mailbox');
  new RelayKeys(recipientKeys);
  const runtime=mailRuntime(scope,smtp,recipientKeys,scope.purpose);
  return {email:scope.mailbox,mailer:createSmtpAccountMailer(runtime.smtp,{},runtime.ses.config),ses:runtime.ses};
 }catch{throw new Error('test_cloud.ses_configuration');}
}

export function loadTestVenueSesRuntime(environment,{path=settingsPath,digest=hostedScopeDigest,venuePath=venueSettingsPath,venueDigest=venueScopeDigest}={}){
 if(environment.TEST_CLOUD_AMAZON_VENUE_SES===undefined)return;
 try{
  if(environment.TEST_CLOUD_AMAZON_VENUE_SES!=='1'||environment.TEST_CLOUD_AMAZON_SES!==undefined||environment.NODE_ENV==='production')throw Error();
  const origin=environment.TEST_CLOUD_ORIGIN;
  const {scope,smtp,recipientKeys:separateKeys}=readScopedSettings(venuePath,venueDigest,origin,'recipient');
  const {venueId,installationId,from,recipient,venueIdentityArn}=scope;
  const uuid=/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/;
  if(separateKeys!==undefined||!uuid.test(venueId)||!uuid.test(installationId)||!from||normaliseEmail(from)!==from||
   from.split('@')[1]!==venueIdentityArn.split('identity/')[1]||typeof smtp?.user!=='string'||!smtp.user||typeof smtp.password!=='string'||!smtp.password)throw Error();
  const account=readScopedSettings(path,digest,origin,'mailbox');
  new RelayKeys(account.recipientKeys);
  const runtime=mailRuntime(account.scope,smtp,account.recipientKeys,'venue-email',venueIdentityArn);
  return {ses:runtime.ses,sesSmtp:{smtp:runtime.smtp,scope:{venueId,installationId,recipient,from}}};
 }catch{throw new Error('test_cloud.ses_configuration');}
}
