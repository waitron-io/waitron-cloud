import assert from 'node:assert/strict';
import {test} from 'node:test';
import {once} from 'node:events';
import {spawn,spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {mkdtempSync,writeFileSync,rmSync,openSync,writeSync,closeSync,symlinkSync,constants} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer,type Socket} from 'node:net';
import {feedbackFixture} from './fixtures/ses-feedback.ts';
import {keys} from './fixtures/mail-attempt.ts';

async function cli(){return import('../src/ses-feedback-cli.ts').catch(()=>assert.fail('The explicit feedback command is missing'));}
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'ses-feedback-cli-')),file=join(dir,'config.json');
 const {policy,input}=feedbackFixture();writeFileSync(file,JSON.stringify(input));
 return {dir,file,policy,input,env:{CLOUD_SES_FEEDBACK_CONSUMER:'enabled',DATABASE_URL:'postgres://local:local@127.0.0.1:1/local',
  CLOUD_SES_FEEDBACK_CONFIG_FILE:file,CLOUD_MAIL_RECIPIENT_ACTIVE_KEY_ID:keys.activeKeyId,CLOUD_MAIL_RECIPIENT_KEYS:JSON.stringify(keys.keys)},
  close(){rmSync(dir,{recursive:true,force:true});}};
}

test('consumer startup requires explicit opt-in plus independently qualified settings and retained keys',async()=>{
 const {configuredSesFeedbackConsumer}=await cli(),f=fixture();try{
  const loaded=configuredSesFeedbackConsumer(f.env,f.policy);
  assert.equal(loaded.config.scope.region,'eu-north-1');assert.equal(loaded.config.purposes[0],'cloud-account-email');
  assert.deepEqual(loaded.recipientKeys,keys);assert.equal(loaded.databaseUrl,f.env.DATABASE_URL);
  for(const field of Object.keys(f.env)){
   assert.throws(()=>configuredSesFeedbackConsumer({...f.env,[field]:''},f.policy),/^Error: ses_feedback_configuration_failed$/);
  }
  for(const value of ['true','yes','1'])assert.throws(()=>configuredSesFeedbackConsumer({...f.env,CLOUD_SES_FEEDBACK_CONSUMER:value},f.policy),/^Error: ses_feedback_configuration_failed$/);
  assert.throws(()=>configuredSesFeedbackConsumer({...f.env,DATABASE_URL:'https://private.invalid/'},f.policy),/^Error: ses_feedback_configuration_failed$/);
  assert.throws(()=>configuredSesFeedbackConsumer({...f.env,CLOUD_MAIL_RECIPIENT_ACTIVE_KEY_ID:'missing'},f.policy),/^Error: ses_feedback_configuration_failed$/);
 }finally{f.close();}
});

test('a configuration file cannot qualify its own country flow or replace the trusted region binding',async()=>{
 const {configuredSesFeedbackConsumer}=await cli(),f=fixture();try{
  assert.throws(()=>configuredSesFeedbackConsumer(f.env),/^Error: ses_feedback_configuration_failed$/);
  writeFileSync(f.file,JSON.stringify({...f.input,policy:f.policy}));
  assert.throws(()=>configuredSesFeedbackConsumer(f.env),/^Error: ses_feedback_configuration_failed$/);
  writeFileSync(f.file,JSON.stringify({...f.input,queueUrl:'https://private-secret.invalid/'}));
  assert.throws(()=>configuredSesFeedbackConsumer(f.env,f.policy),/^Error: ses_feedback_configuration_failed$/);
 }finally{f.close();}
});

test('startup refuses malformed oversized and nonregular configuration without raw diagnostics',async()=>{
 const {configuredSesFeedbackConsumer}=await cli(),f=fixture();try{
  const json=JSON.stringify(f.input);
  for(const text of ['private token',JSON.stringify({...f.input,padding:'x'.repeat(65536)}),json+' '.repeat(65537-Buffer.byteLength(json))]){
   writeFileSync(f.file,text);assert.throws(()=>configuredSesFeedbackConsumer(f.env,f.policy),/^Error: ses_feedback_configuration_failed$/);
  }
  assert.throws(()=>configuredSesFeedbackConsumer({...f.env,CLOUD_SES_FEEDBACK_CONFIG_FILE:f.dir},f.policy),/^Error: ses_feedback_configuration_failed$/);
 }finally{f.close();}
});

test('a readable named pipe containing valid qualified JSON is still refused as configuration',async()=>{
 const {configuredSesFeedbackConsumer}=await cli(),f=fixture(),pipe=join(f.dir,'config.pipe');let fd:number|undefined;
 try{
  assert.equal(spawnSync('mkfifo',[pipe]).status,0);fd=openSync(pipe,constants.O_RDWR|constants.O_NONBLOCK);
  writeSync(fd,JSON.stringify(f.input));
  assert.throws(()=>configuredSesFeedbackConsumer({...f.env,CLOUD_SES_FEEDBACK_CONFIG_FILE:pipe},f.policy),/^Error: ses_feedback_configuration_failed$/);
 }finally{if(fd!==undefined)closeSync(fd);f.close();}
});

test('the actual command refuses a named pipe without waiting for a writer',async()=>{
 await cli();const f=fixture(),pipe=join(f.dir,'config.pipe');try{
  assert.equal(spawnSync('mkfifo',[pipe]).status,0);
  const child=spawnSync(process.execPath,[new URL('../src/ses-feedback-cli.ts',import.meta.url).pathname,'--once'],{
   env:{PATH:process.env.PATH,...f.env,CLOUD_SES_FEEDBACK_CONFIG_FILE:pipe},encoding:'utf8',timeout:1500,killSignal:'SIGKILL'});
  assert.equal(child.error,undefined);assert.equal(child.status,1);assert.equal(child.stdout,'');
  assert.equal(child.stderr,'SES feedback consumer failed; check configuration and service health\n');
 }finally{f.close();}
});

test('a symlinked command still validates startup and arguments instead of silently exiting successfully',async()=>{
 await cli();const f=fixture(),link=join(f.dir,'consumer.ts');try{
  symlinkSync(new URL('../src/ses-feedback-cli.ts',import.meta.url).pathname,link);
  for(const args of [[],['--unknown']]){
   const child=spawnSync(process.execPath,[link,...args],{env:{PATH:process.env.PATH},encoding:'utf8',timeout:3000});
   assert.equal(child.error,undefined);assert.equal(child.status,1);assert.equal(child.stdout,'');
   assert.equal(child.stderr,'SES feedback consumer failed; check configuration and service health\n');
  }
 }finally{f.close();}
});

test('the real command remains closed even with a self-qualified file and synthetic provider credentials',async()=>{
 await cli();const f=fixture();try{
  for(const args of [[],['--once'],['--unknown']]){
   const child=spawnSync(process.execPath,[new URL('../src/ses-feedback-cli.ts',import.meta.url).pathname,...args],{
    env:{PATH:process.env.PATH,...f.env,AWS_ACCESS_KEY_ID:'LOCALACCESS',AWS_SECRET_ACCESS_KEY:'private-test-secret'},encoding:'utf8',timeout:3000});
   assert.equal(child.error,undefined);assert.equal(child.status,1);assert.equal(child.stdout,'');
   assert.equal(child.stderr,'SES feedback consumer failed; check configuration and service health\n');
  }
 }finally{f.close();}
});

test('the dedicated pool times out a real stalled PostgreSQL handshake and closes its socket',async()=>{
 const {createSesFeedbackPool}=await cli();const sockets=new Set<Socket>();
 let connected:()=>void=()=>{};const accepted=new Promise<void>(resolve=>{connected=resolve;});
 const server=createServer(socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));connected();});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();assert.ok(address&&typeof address==='object');
 const pool=createSesFeedbackPool(`postgres://local:local@127.0.0.1:${address.port}/local`);
 try{
  const began=performance.now(),waiting=pool.connect().then(()=> 'connected',()=> 'refused');
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{
   await accepted;const outcome=await Promise.race([waiting,new Promise<string>(resolve=>{timer=setTimeout(()=>resolve('still waiting'),6500);})]);
   assert.equal(outcome,'refused');assert.ok(performance.now()-began<6500);
  }finally{clearTimeout(timer);}
  await pool.end();assert.equal(pool.ended,true);
 }finally{for(const socket of sockets)socket.destroy();await pool.end().catch(()=>{});await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

for(const signal of ['SIGINT','SIGTERM'] as const)test(`${signal} drains the actual idle command without a forced successful exit`,async()=>{
 await cli();const f=fixture();
 const child=spawn(process.execPath,['--import',new URL('./fixtures/ses-feedback-cli-hooks.mjs',import.meta.url).href,
  new URL('../src/ses-feedback-cli.ts',import.meta.url).pathname],{
  env:{PATH:process.env.PATH,...f.env,LOCAL_FEEDBACK_POLICY:JSON.stringify(f.policy),LOCAL_FEEDBACK_MODE:'idle',
   CLOUD_SES_FEEDBACK_HEALTH_SAMPLE_FILE:join(f.dir,'health.json')},stdio:['ignore','pipe','pipe','ipc']});
 let stdout='',stderr='',receives=0;child.stdout!.on('data',b=>{stdout+=b;});child.stderr!.on('data',b=>{stderr+=b;});
 child.on('message',m=>{if((m as {stage:string}).stage==='receive')receives++;});
 const exited=new Promise<{code:number|null;signal:NodeJS.Signals|null}>((resolve,reject)=>{
  child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
 const timeout=setTimeout(()=>child.kill('SIGKILL'),4000);
 try{
  const until=performance.now()+2000;
  while(receives<2&&child.exitCode===null&&child.signalCode===null&&performance.now()<until)await delay(10);
  assert.equal(receives,2,stderr);await delay(100);assert.equal(child.exitCode,null,'polling must stay live before shutdown');
  child.kill(signal);assert.deepEqual(await exited,{code:0,signal:null});assert.equal(stderr,'');
  assert.match(stdout,/\{"drained":true,"code":0\}/);assert.doesNotMatch(stdout,/private|local-secret/);
 }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited;clearTimeout(timeout);f.close();}
});

test('the hard shutdown deadline survives service completion when a broken driver retains a live handle',async()=>{
 await cli();const f=fixture();
 const child=spawn(process.execPath,['--import',new URL('./fixtures/ses-feedback-cli-hooks.mjs',import.meta.url).href,
  new URL('../src/ses-feedback-cli.ts',import.meta.url).pathname],{
  env:{PATH:process.env.PATH,...f.env,LOCAL_FEEDBACK_POLICY:JSON.stringify(f.policy),LOCAL_FEEDBACK_MODE:'idle-leak',
   CLOUD_SES_FEEDBACK_HEALTH_SAMPLE_FILE:join(f.dir,'health.json')},stdio:['ignore','pipe','pipe','ipc']});
 let stderr='',receives=0;child.stdout!.resume();child.stderr!.on('data',b=>{stderr+=b;});
 child.on('message',m=>{if((m as {stage:string}).stage==='receive')receives++;});
 const exited=new Promise<{code:number|null;signal:NodeJS.Signals|null}>((resolve,reject)=>{
  child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
 const timeout=setTimeout(()=>child.kill('SIGKILL'),24000);
 try{
  const until=performance.now()+2000;
  while(receives<2&&child.exitCode===null&&child.signalCode===null&&performance.now()<until)await delay(10);
  assert.equal(receives,2,stderr);const began=performance.now();child.kill('SIGTERM');
  assert.deepEqual(await exited,{code:1,signal:null},'a retained driver handle must fail within the process deadline');
  assert.ok(performance.now()-began<22000);assert.equal(stderr,'SES feedback shutdown failed\n');
 }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited;clearTimeout(timeout);f.close();}
});

function venueTrialBinding(purposes=['cloud-account-email','venue-email'],useFallbackIdentity=false){
 const {policy,input}=feedbackFixture('eu-north-1',purposes);
 const venueIdentityArn=useFallbackIdentity?input.identityArn:'arn:aws:ses:eu-north-1:123456789012:identity/cafe.example.test';
 const smtpBindings=policy.smtpBindings.map(binding=>binding.purpose==='venue-email'?{...binding,venueIdentityArn}:binding);
 return {input:{...input,venueIdentityArn},policy:{...policy,smtpBindings}};
}

test('the test venue reader requires the combined binding, retained keys and explicit role credentials',async()=>{
 const command=await cli();
 const setup=fixture();
 const {policy:trusted,input}=venueTrialBinding();
 const env={...setup.env,CLOUD_TEST_VENUE_SES_FEEDBACK:'1',AWS_ACCESS_KEY_ID:'TESTACCESS',
  AWS_SECRET_ACCESS_KEY:'synthetic-secret',AWS_SESSION_TOKEN:'synthetic-session'};
 try{
  writeFileSync(setup.file,JSON.stringify(input));
  assert.equal(typeof command.configuredTestVenueSesFeedbackConsumer,'function','missing test venue reader configuration');
  const loaded=command.configuredTestVenueSesFeedbackConsumer(env,trusted);
  assert.deepEqual(loaded.config.purposes,['cloud-account-email','venue-email']);
  assert.equal(loaded.config.venueIdentityArn,input.venueIdentityArn);
  assert.deepEqual(loaded.recipientKeys,keys);
  assert.deepEqual(loaded.credentials,{accessKeyId:'TESTACCESS',secretAccessKey:'synthetic-secret',sessionToken:'synthetic-session'});
  for(const field of ['CLOUD_TEST_VENUE_SES_FEEDBACK','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','CLOUD_MAIL_RECIPIENT_KEYS'])
   assert.throws(()=>command.configuredTestVenueSesFeedbackConsumer({...env,[field]:undefined},trusted),/ses_feedback_configuration_failed/,field);
  assert.throws(()=>command.configuredTestVenueSesFeedbackConsumer({...env,NODE_ENV:'production'},trusted),/ses_feedback_configuration_failed/);
  let bindingsRead=false;
  const unpinned={...env,get CLOUD_SES_FEEDBACK_CONFIG_FILE(){bindingsRead=true;return setup.file;}};
  assert.throws(()=>command.configuredTestVenueSesFeedbackConsumer(unpinned),/ses_feedback_configuration_failed/);
  assert.equal(bindingsRead,false);
  const withoutVenueIdentity=feedbackFixture('eu-north-1',input.purposes);
  for(const binding of [venueTrialBinding(['venue-email']),venueTrialBinding(input.purposes,true),withoutVenueIdentity,setup]){
   writeFileSync(setup.file,JSON.stringify(binding.input));
   assert.throws(()=>command.configuredTestVenueSesFeedbackConsumer(env,binding.policy),/ses_feedback_configuration_failed/);
  }
 }finally{setup.close();}
});

test('the standalone test venue command refuses an offline file even with an explicit role session',()=>{
 const setup=fixture();
 try{
  const binding=venueTrialBinding();
  writeFileSync(setup.file,JSON.stringify({...binding.input,policy:binding.policy}));
  const child=spawnSync(process.execPath,[new URL('../src/ses-feedback-cli.ts',import.meta.url).pathname,'--test-venue'],{
   env:{PATH:process.env.PATH,...setup.env,CLOUD_TEST_VENUE_SES_FEEDBACK:'1',AWS_ACCESS_KEY_ID:'TESTACCESS',
    AWS_SECRET_ACCESS_KEY:'synthetic-secret',AWS_SESSION_TOKEN:'synthetic-session'},encoding:'utf8',timeout:3000});
  assert.equal(child.error,undefined);assert.equal(child.status,1);assert.equal(child.stdout,'');
  assert.equal(child.stderr,'SES feedback consumer failed; check configuration and service health\n');
 }finally{setup.close();}
});


test('the test venue command polls with its supplied role session',async()=>{
 const f=fixture();
 const {policy:trusted,input}=venueTrialBinding();
 writeFileSync(f.file,JSON.stringify(input));
 const child=spawn(process.execPath,['--import',new URL('./fixtures/ses-feedback-cli-hooks.mjs',import.meta.url).href,
  new URL('../src/ses-feedback-cli.ts',import.meta.url).pathname,'--test-venue'],{
  env:{PATH:process.env.PATH,...f.env,CLOUD_TEST_VENUE_SES_FEEDBACK:'1',AWS_ACCESS_KEY_ID:'TRIALACCESS',
   AWS_SECRET_ACCESS_KEY:'synthetic-secret',AWS_SESSION_TOKEN:'synthetic-session',LOCAL_FEEDBACK_POLICY:JSON.stringify(trusted),
   LOCAL_FEEDBACK_MODE:'idle-test-venue',CLOUD_SES_FEEDBACK_HEALTH_SAMPLE_FILE:join(f.dir,'health.json')},
  stdio:['ignore','ignore','pipe','ipc']});
 let stderr='';child.stderr!.on('data',b=>{stderr+=b;});
 const exited=once(child,'close');
 try{
  const [observed]=await Promise.race([once(child,'message',{signal:AbortSignal.timeout(2500)}),exited]);
  assert.deepEqual(observed,{stage:'receive',roleSigned:true},stderr);
  child.kill('SIGTERM');
  assert.deepEqual(await exited,[0,null],stderr);
 }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited;f.close();}
});
