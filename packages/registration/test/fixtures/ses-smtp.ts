import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SMTPServer,type SMTPServerOptions} from 'smtp-server';

export const smtpConfig={host:'127.0.0.1',user:'local-fixture',password:'local-secret',from:'accounts@mail.example.test',portalOrigin:'https://cloud.example.test'};
export async function tlsSmtp(options:SMTPServerOptions={}){
 const directory=mkdtempSync(join(tmpdir(),'ses-smtp-'));
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(directory,'key'),'-out',join(directory,'cert'),'-days','1','-subj','/CN=SMTP fixture','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
 const cert=readFileSync(join(directory,'cert')),key=readFileSync(join(directory,'key'));
 const captured:{raw:string;secure:boolean;to:string[];from:string}[]=[];
 const smtp=new SMTPServer({secure:true,cert,key,logger:false,hideSTARTTLS:true,
  onAuth(auth,_session,done){done(auth.username===smtpConfig.user&&auth.password===smtpConfig.password?null:new Error('auth refused'),{user:'fixture'});},
  onData(stream,session,done){let raw='';stream.on('data',b=>raw+=b);stream.on('end',()=>{captured.push({raw,secure:session.secure,to:session.envelope.rcptTo.map(r=>r.address),from:session.envelope.mailFrom&&session.envelope.mailFrom.address||''});done(null,'Ok ses-message-1');});},...options});
 smtp.on('error',()=>{});
 const sockets=new Set<import('node:net').Socket>();
 let connections=0;smtp.server.on('connection',socket=>{connections++;sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
 await new Promise<void>(r=>smtp.listen(0,'127.0.0.1',r));
 const address=smtp.server.address();assert.ok(address&&typeof address!=='string');
 return {cert,key,captured,port:address.port,get connections(){return connections;},get activeConnections(){return sockets.size;},destroyConnections(){for(const socket of sockets)socket.destroy();},async close(){for(const socket of sockets)socket.destroy();await new Promise<void>(r=>smtp.close(r));rmSync(directory,{recursive:true,force:true});}};
}
