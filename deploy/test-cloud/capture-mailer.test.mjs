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
