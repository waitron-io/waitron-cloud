import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:https';
import {guestMenuFixture} from '../../../remote-access/test/fixtures/guest-menu.ts';
export async function guestTlsFixture(){
 const f=await guestMenuFixture(),scratch=await mkdtemp(join(tmpdir(),'cloud-guest-tls-')),host='menus.example.test';
 const keyFile=join(scratch,'key'),certFile=join(scratch,'cert');
 try{
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','2','-subj',`/CN=${host}`,'-addext',`subjectAltName=DNS:${host}`,'-keyout',keyFile,'-out',certFile],{stdio:'ignore'});
  const tls={key:await readFile(keyFile),cert:await readFile(certFile)},origin=`https://${host}`;
  return {...f,scratch,keyFile,certFile,origin,tls,options:{pool:f.db.pool,rateKey:f.db.rateKey,origin,tls,port:0},
   send:(port:number,path:string,method='GET',headers:Record<string,string>={})=>new Promise<{status:number;body:string;headers:import('node:http').IncomingHttpHeaders}>((resolve,reject)=>{
    const req=request({host:'127.0.0.1',port,servername:host,ca:tls.cert,path,method,headers:{host,...headers}},reply=>{let body='';reply.setEncoding('utf8');reply.on('data',part=>body+=part);reply.on('end',()=>resolve({status:reply.statusCode!,body,headers:reply.headers}));});
    req.on('error',reject);req.end();
   }),
   close:async()=>{await f.db.close();await rm(scratch,{recursive:true,force:true});}};
 }catch(error){await f.db.close();await rm(scratch,{recursive:true,force:true});throw error;}
}
