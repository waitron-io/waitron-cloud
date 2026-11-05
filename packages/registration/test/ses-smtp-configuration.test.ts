import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as configured from '../src/configured-mailer.ts';
import {feedbackFixture} from './fixtures/ses-feedback.ts';

test('SES configuration files require independent qualification and retained recipient keys',()=>{
 const read=(configured as any).configuredSesHandoff;
 assert.equal(typeof read,'function','missing closed SES configuration loader');
 const original=process.env,directory=mkdtempSync(join(tmpdir(),'ses-config-')),path=join(directory,'config.json');
 try{
  const f=feedbackFixture();writeFileSync(path,JSON.stringify(f.input));
  process.env={CLOUD_MAIL_TRANSPORT:'smtp',CLOUD_MAIL_PROVIDER:'ses',CLOUD_SES_FEEDBACK_CONFIG_FILE:path,
   CLOUD_MAIL_RECIPIENT_ACTIVE_KEY_ID:'v1',CLOUD_MAIL_RECIPIENT_KEYS:JSON.stringify({v1:'11'.repeat(32)})};
  assert.throws(()=>read(),/Invalid SES mail configuration/);
  const handoff=read(f.policy);
  assert.equal(handoff.config.configurationSet,'transactional');assert.equal(handoff.config.scope.region,'eu-north-1');
  assert.deepEqual(handoff.recipientKeys,{activeKeyId:'v1',keys:{v1:'11'.repeat(32)}});
  for(const field of ['CLOUD_SES_FEEDBACK_CONFIG_FILE','CLOUD_MAIL_RECIPIENT_KEYS','CLOUD_MAIL_RECIPIENT_ACTIVE_KEY_ID']){
   const saved=process.env[field];delete process.env[field];assert.throws(()=>read(f.policy),/Invalid SES mail configuration/);process.env[field]=saved;
  }
  for(const keys of ['[]','{}','null','{"v1":"bad"}','{"other":"'+'11'.repeat(32)+'"}']){
   process.env.CLOUD_MAIL_RECIPIENT_KEYS=keys;assert.throws(()=>read(f.policy),/Invalid SES mail configuration/);
  }
  process.env.CLOUD_MAIL_RECIPIENT_KEYS=JSON.stringify({v1:'11'.repeat(32)});
  writeFileSync(path,JSON.stringify({...f.input,policy:f.policy}));assert.throws(()=>read(),/Invalid SES mail configuration/);
  writeFileSync(path,JSON.stringify(f.input).padEnd(65537,' '));assert.throws(()=>read(f.policy),/Invalid SES mail configuration/);
  const venueOnly=feedbackFixture('eu-north-1',['venue-email']);
  writeFileSync(path,JSON.stringify(venueOnly.input));assert.throws(()=>read(venueOnly.policy),/Invalid SES mail configuration/);
  process.env.CLOUD_MAIL_TRANSPORT='local';assert.throws(()=>read(f.policy),/Invalid SES mail configuration/);
 }finally{process.env=original;rmSync(directory,{recursive:true,force:true});}
});

test('SES provider selection cannot fall back to local or generic SMTP',()=>{
 const original=process.env;
 try{
  for(const mode of ['local','smtp',undefined]){
   process.env={CLOUD_MAIL_PROVIDER:'ses',...(mode?{CLOUD_MAIL_TRANSPORT:mode}:{})};
   assert.throws(()=>configured.configuredAccountMailer(),/Invalid SES mail configuration/);
  }
  process.env={CLOUD_MAIL_PROVIDER:'unknown'};assert.throws(()=>configured.configuredAccountMailer(),/Invalid email transport configuration/);
 }finally{process.env=original;}
});
