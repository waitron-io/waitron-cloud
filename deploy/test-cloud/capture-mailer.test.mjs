import assert from 'node:assert/strict';
import {createServer} from 'node:net';
import test from 'node:test';
import {createLocalAccountMailer} from '../../packages/registration/src/local-mailer.ts';
import {createSmtpAccountMailer} from '../../packages/registration/src/smtp-mailer.ts';
async function api(){return import('./capture-mailer.mjs').catch(()=>({}));}
async function sink(t){const messages=[];const server=createServer(socket=>{socket.setEncoding('utf8');socket.write('220 capture ESMTP\r\n');let buffer='',data=false,body='';socket.on('data',chunk=>{buffer+=chunk;let pos;while((pos=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,pos);buffer=buffer.slice(pos+2);if(data){if(line==='.'){messages.push(body.replace(/=\r\n/g,'').replace(/=([0-9A-F]{2})/g,(_,hex)=>String.fromCharCode(parseInt(hex,16))));body='';data=false;socket.write('250 captured\r\n');}else body+=line+'\r\n';}else if(line==='DATA'){data=true;socket.write('354 send\r\n');}else if(line==='QUIT'){socket.end('221 bye\r\n');}else if(line.startsWith('EHLO'))socket.write('250-capture\r\n250 8BITMIME\r\n');else socket.write('250 ok\r\n');}});});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));return{port:server.address().port,messages};}
test('test capture sends canonical signup and recovery links only to loopback sink',async t=>{
 const {createTestCaptureMailer}=await api();assert.equal(typeof createTestCaptureMailer,'function','test capture mailer is missing');const {port,messages}=await sink(t);
 const mailer=createTestCaptureMailer({origin:'https://waitron.local:3000',port});
 await mailer.sendVerification({email:'owner@example.test',token:'x'.repeat(43),expiresAt:'2030-01-01T00:00:00Z',locale:'en'});
 await mailer.sendPasswordReset({email:'owner@example.test',token:'y'.repeat(43),expiresAt:'2030-01-01T00:00:00Z',locale:'es'});
 assert.equal(messages.length,2);assert.match(messages[0],/https:\/\/waitron\.local:3000\/signup#token=/);assert.match(messages[1],/https:\/\/waitron\.local:3000\/reset-password#token=/);
 for(const options of [{origin:'http://waitron.local:3000'},{origin:'https://evil.local:3000'},{origin:'https://waitron.local:3000/'},{origin:'https://waitron.local:3000',host:'evil.test'},{origin:'https://waitron.local:3000',port:0}])assert.throws(()=>createTestCaptureMailer(options),/test_cloud.mail_configuration/);
});
test('ordinary local and production mailers still refuse LAN origins',()=>{
 assert.throws(()=>createLocalAccountMailer({portalOrigin:'https://waitron.local:3000'}),/Invalid local mail/);
 assert.throws(()=>createSmtpAccountMailer({host:'smtp.example.test',port:465,user:'cloud',password:'secret',from:'cloud@example.test',portalOrigin:'https://waitron.local:3000'}),/Invalid production mail/);
});


test('test capture delivers a mailbox sign-in code through the loopback sink',async t=>{
 const {createTestCaptureMailer}=await api(),{port,messages}=await sink(t);
 const mailer=createTestCaptureMailer({origin:'https://waitron.local:3000',port});
 assert.equal(typeof mailer.sendSignInCheck,'function');
 await mailer.sendSignInCheck({email:'owner@example.test',token:'x'.repeat(43),code:'000123',expiresAt:'2030-01-01T00:00:00Z',locale:'en'});
 assert.equal(messages.length,1);assert.match(messages[0],/000123/);assert.doesNotMatch(messages[0],/x{43}/);
});

test('test capture delivers email-change verification and notices through the loopback sink',async t=>{
 const {createTestCaptureMailer}=await api(),{port,messages}=await sink(t),mailer=createTestCaptureMailer({origin:'https://waitron.local:3000',port});
 await mailer.sendEmailChange({email:'new@example.test',token:'x'.repeat(43),expiresAt:'2030-01-01T00:00:00Z',locale:'en'});
 await mailer.sendEmailChanged({email:'old@example.test',locale:'en'});
 assert.equal(messages.length,2);assert.match(messages[0],/https:\/\/waitron\.local:3000\/account#change=x{43}/);
 assert.match(messages[1],/Your Waitron Cloud email changed/);assert.doesNotMatch(messages[1],/x{43}/);
});

test('explicitly configured public origin changes captured links without changing the loopback transport',async t=>{
 const {createTestCaptureMailer}=await api(),{port,messages}=await sink(t);
 const origin='https://cloud.example.test',mailer=createTestCaptureMailer({origin,port},origin);
 await mailer.sendVerification({email:'owner@example.test',token:'x'.repeat(43),expiresAt:'2030-01-01T00:00:00Z',locale:'en'});
 await mailer.sendPasswordReset({email:'owner@example.test',token:'y'.repeat(43),expiresAt:'2030-01-01T00:00:00Z',locale:'es'});
 assert.equal(messages.length,2);assert.match(messages[0],/https:\/\/cloud\.example\.test\/signup#token=/);assert.match(messages[1],/https:\/\/cloud\.example\.test\/reset-password#token=/);
 assert.throws(()=>createTestCaptureMailer({origin:'https://other.example.test',port},origin),/test_cloud.mail_configuration/);
 assert.throws(()=>createTestCaptureMailer({origin:'http://cloud.example.test',port},'http://cloud.example.test'),/origin_invalid/);
});

test('email worker uses the operator origin and refuses a different runtime origin before sending',async t=>{
 const {spawn}=await import('node:child_process'),{port,messages}=await sink(t);
 const here=relative=>JSON.stringify(new URL(relative,import.meta.url).href);
 const run=async corrupt=>{
  const script=`import{mock}from'node:test';import{EventEmitter}from'node:events';import{createRequire}from'node:module';
   const realRuntime=await import(${here('./runtime.mjs')}),local=await import(${here('../local-stack/runtime.mjs')});
   const {mkdtemp,rm}=await import('node:fs/promises');const{tmpdir}=await import('node:os');const{join}=await import('node:path');
   const directory=await mkdtemp(join(tmpdir(),'cloud-mail-worker-'));const{bootstrap}=await import(${here('../local-stack/bootstrap.mjs')});await bootstrap(directory);
   mock.module(${here('../local-stack/runtime.mjs')},{namedExports:{...local,checkConsumerDatabase:async()=>{}}});
   mock.module(${here('./runtime.mjs')},{namedExports:{...realRuntime,testRuntimeEnvironment:(...args)=>{const value=realRuntime.testRuntimeEnvironment(...args);if(${corrupt})value.CLOUD_PORTAL_ORIGIN='https://other.example.test';return value;}}});
   const pg=createRequire(${here('../../packages/registration/package.json')}).resolve('pg');mock.module(pg,{namedExports:{Pool:class extends EventEmitter{async end(){}}}});
   const outbox=await import(${here('../../packages/registration/src/email-outbox.ts')});
   mock.module(${here('../../packages/registration/src/email-outbox.ts')},{namedExports:{...outbox,EmailWorker:class{constructor(pool,outbox,mailer){this.mailer=mailer;}async runOnce(){await this.mailer.sendVerification({email:'owner@example.test',token:'x'.repeat(43),expiresAt:'2030-01-01T00:00:00Z',locale:'en'});}}}});
   const capture=await import(${here('./capture-mailer.mjs')});mock.module(${here('./capture-mailer.mjs')},{namedExports:{...capture,createTestCaptureMailer:(options,origin)=>capture.createTestCaptureMailer({...options,port:${port}},origin)}});
   try{const{runTestEmailWorker}=await import(${here('./email-worker.mjs')});await runTestEmailWorker({directory,once:true});console.log('accepted');}catch(error){if(error.message!=='test_cloud.mail_configuration')throw error;console.log('refused');}finally{await rm(directory,{recursive:true,force:true});}`;
  const child=spawn(process.execPath,['--experimental-test-module-mocks','--input-type=module','-e',script],{env:{PATH:process.env.PATH,TEST_CLOUD_ORIGIN:'https://cloud.example.test'},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);
  const code=await new Promise((yes,no)=>{child.once('error',no);child.once('close',yes);});assert.equal(code,0,stderr);return stdout.trim();
 };
 assert.equal(await run(false),'accepted');const refused=await run(true);
 assert.equal(messages.length,1,'the completed worker must not deliver the misconfigured link');
 assert.match(messages[0],/https:\/\/cloud\.example\.test\/signup#token=/);assert.equal(refused,'refused');
});

test('operator notices use the local and test-capture loopback adapters',async t=>{
 const {port,messages}=await sink(t),{createTestCaptureMailer}=await api();
 const local=createLocalAccountMailer({port,portalOrigin:'http://localhost:3000'});
 const capture=createTestCaptureMailer({origin:'https://waitron.local:3000',port});
 for(const mailer of [local,capture]){assert.equal(typeof mailer.sendOperatorNotice,'function');await mailer.sendOperatorNotice({email:'operator@example.test',locale:'en'});}
 assert.equal(messages.length,2);assert.match(messages[0],/http:\/\/localhost:3000\/operator\/actions/);assert.match(messages[1],/https:\/\/waitron.local:3000\/operator\/actions/);
});
