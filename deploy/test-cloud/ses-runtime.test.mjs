import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {chmod, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';

const account='123456789012', region='eu-north-1', origin='https://cloud.example.test';
const scope={
 bindingRevision:'pilot-v1', country:'ES',
 configurationSetArn:`arn:aws:ses:${region}:${account}:configuration-set/synthetic-trial`,
 dlqArn:`arn:aws:sqs:${region}:${account}:synthetic-dead`,
 iamUserArn:`arn:aws:iam::${account}:user/synthetic-smtp`,
 identityArn:`arn:aws:ses:${region}:${account}:identity/mail.example.test`,
 mailbox:'owner@example.test', origin, policyRevision:102, providerAccountId:account,
 purpose:'cloud-account-email', queueArn:`arn:aws:sqs:${region}:${account}:synthetic-queue`,
 queueUrl:`https://sqs.${region}.amazonaws.com/${account}/synthetic-queue`,
 region, sender:'no-reply@mail.example.test', smtpHost:`email-smtp.${region}.amazonaws.com`,
 smtpPort:465, topicArn:`arn:aws:sns:${region}:${account}:synthetic-topic`,
};
const settings={scope,smtp:{user:'synthetic-user',password:'synthetic-password'},
 recipientKeys:{activeKeyId:'pilot',keys:{pilot:'aa'.repeat(32)}}};
const environment={TEST_CLOUD_AMAZON_SES:'1',TEST_CLOUD_ORIGIN:origin};

test('the test mail switch requires the pinned sandbox scope and a private regular settings file',async t=>{
 const {loadTestSesRuntime}=await import('./ses-runtime.mjs');
 const dir=await mkdtemp(join(tmpdir(),'test-cloud-ses-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const path=join(dir,'ses.json'), digest='f906bad42162118aacd428f966994a2220fae9148c7b9df5bd681c0d413b6566';
 const options={path,digest};
 const save=async value=>writeFile(path,JSON.stringify(value),{mode:0o600});
 const refused=(env=environment,input=options)=>assert.throws(()=>loadTestSesRuntime(env,input),{message:'test_cloud.ses_configuration'});
 assert.equal(loadTestSesRuntime({},options),undefined);
 refused();
 await save({...settings,scope:{...scope,mailbox:' Owner@Example.Test '}});
 const result=loadTestSesRuntime(environment,options);
 assert.equal(result.email,'owner@example.test');
 assert.deepEqual(result.ses.config.purposes,['cloud-account-email']);
 assert.equal(result.ses.config.smtpHost,'email-smtp.eu-north-1.amazonaws.com');
 assert.deepEqual(result.ses.recipientKeys,settings.recipientKeys);
 assert.equal(typeof result.mailer.sendVerification,'function');
 refused({...environment,TEST_CLOUD_ORIGIN:'https://another.example.test'});
 refused({...environment,TEST_CLOUD_AMAZON_SES:'yes'});
 refused(environment,{path,digest:'00'.repeat(32)});
 await chmod(path,0o644);refused();await chmod(path,0o600);
 const link=join(dir,'link.json');await symlink(path,link);refused(environment,{path:link,digest});
 refused(environment,{path:dir,digest});
 for(const override of [{mailbox:'different@example.test'},{iamUserArn:scope.iamUserArn+'-other'},
   {region:'eu-west-3'},{purpose:'venue-email'}]){
  await save({...settings,scope:{...scope,...override}});refused();
 }
 await save({...settings,recipientKeys:{activeKeyId:'missing',keys:{}}});refused();
 await writeFile(path,JSON.stringify(settings).padEnd(65537,' '));refused();
});

test('venue settings reuse the account pilot keys with account sending off',async t=>{
 const {loadTestSesRuntime,loadTestVenueSesRuntime}=await import('./ses-runtime.mjs');
 assert.equal(typeof loadTestVenueSesRuntime,'function','venue SES needs a separate settings entry point');
 const dir=await mkdtemp(join(tmpdir(),'venue-ses-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const path=join(dir,'account.json'),venuePath=join(dir,'venue.json');
 const venue={origin,venueId:randomUUID(),installationId:randomUUID(),recipient:'owner@example.test',from:'staff@venue.example.test',
  venueIdentityArn:`arn:aws:ses:${region}:${account}:identity/venue.example.test`};
 const fingerprint=scope=>createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.keys(scope).sort().map(k=>[k,scope[k]])))).digest('hex');
 const venueDigest=fingerprint(venue);
 const env={TEST_CLOUD_AMAZON_VENUE_SES:'1',TEST_CLOUD_ORIGIN:origin};
 const options={path,venuePath,digest:'f906bad42162118aacd428f966994a2220fae9148c7b9df5bd681c0d413b6566',venueDigest};
 await writeFile(path,JSON.stringify(settings),{mode:0o600});
 const save=async value=>writeFile(venuePath,JSON.stringify(value),{mode:0o600});
 await save({scope:venue,smtp:settings.smtp});
 const runtime=loadTestVenueSesRuntime(env,options);
 assert.deepEqual(runtime.ses.recipientKeys,settings.recipientKeys);
 assert.deepEqual(runtime.ses.config.purposes,['venue-email']);
 assert.equal(runtime.ses.config.venueIdentityArn,venue.venueIdentityArn);
 assert.equal(loadTestSesRuntime(env,options),undefined);
 for(const input of [{...options,venueDigest:undefined},{...options,digest:'0'.repeat(64)}])
  assert.throws(()=>loadTestVenueSesRuntime(env,input),/test_cloud.ses_configuration/);
 for(const flags of [{TEST_CLOUD_AMAZON_SES:'1'},{NODE_ENV:'production'},{TEST_CLOUD_AMAZON_VENUE_SES:'0'}])
  assert.throws(()=>loadTestVenueSesRuntime({...env,...flags},options),/test_cloud.ses_configuration/);
 for(const change of [{venueId:'venue-1'},{installationId:'box-1'},{from:'staff@other.example.test'}]){
  const scope={...venue,...change};await save({scope,smtp:settings.smtp});
  assert.throws(()=>loadTestVenueSesRuntime(env,{...options,venueDigest:fingerprint(scope)}),/test_cloud.ses_configuration/);
 }
 await save({scope:venue,smtp:{user:'synthetic-user'}});
 assert.throws(()=>loadTestVenueSesRuntime(env,options),/test_cloud.ses_configuration/);
 await save({scope:venue,smtp:settings.smtp,recipientKeys:settings.recipientKeys});
 assert.throws(()=>loadTestVenueSesRuntime(env,options),/test_cloud.ses_configuration/);
});
