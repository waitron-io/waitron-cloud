import assert from 'node:assert/strict';
import {request} from 'node:http';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';

const zone='test-cloud.example.test',staff='staff-v-11111111-1111-4111-8111-111111111111.'+zone;
async function fixture(t){
 const api=await import('./http-challenges.mjs').catch(()=>({}));assert.equal(typeof api.createHttpChallengeServer,'function','independent challenge listener missing');
 const root=await mkdtemp(join(tmpdir(),'cloud-http-challenges-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const accountWebroot=join(root,'account'),remoteDirectory=join(root,'remote');await mkdir(join(accountWebroot,'.well-known/acme-challenge'),{recursive:true});
 await writeFile(join(accountWebroot,'.well-known/acme-challenge/account-token'),'account-token.account-key');
 const server=api.createHttpChallengeServer({accountHostname:zone,zone,accountWebroot,remoteDirectory});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const send=(host,path='/.well-known/acme-challenge/remote-token',method='GET',headers)=>new Promise((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port:server.address().port,path,method,headers:headers??{host}},res=>{let body='';res.setEncoding('utf8');res.on('data',v=>body+=v);res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',reject);req.end();
 });
 return {...api,remoteDirectory,send};
}
test('serves account renewal without a worker and withdraws only the exact remote challenge',async t=>{
 const f=await fixture(t);assert.deepEqual(await f.send(zone,'/.well-known/acme-challenge/account-token'),{status:200,body:'account-token.account-key'});
 await f.presentHttpChallenge(f.remoteDirectory,staff,'remote-token','remote-token.remote-key');
 assert.deepEqual(await f.send(staff),{status:200,body:'remote-token.remote-key'});
 assert.deepEqual(await f.send(staff+':80'),{status:200,body:'remote-token.remote-key'});
 await f.removeHttpChallenge(f.remoteDirectory,staff,'remote-token');assert.equal((await f.send(staff)).status,404);
 assert.deepEqual(await f.send(zone,'/.well-known/acme-challenge/account-token'),{status:200,body:'account-token.account-key'});
});
test('refuses wrong authority, token, method and path without disclosing or changing challenge files',async t=>{
 const f=await fixture(t);await f.presentHttpChallenge(f.remoteDirectory,staff,'remote-token','remote-token.remote-key');
 await assert.rejects(f.presentHttpChallenge(f.remoteDirectory,staff,'../escape','unsafe'),/test_cloud.http_challenge/);
 assert.equal((await f.send(staff)).status,200);
 for(const [host,path,method] of [
  ['evil.example.test','/.well-known/acme-challenge/remote-token','GET'],
  [staff+':8081','/.well-known/acme-challenge/remote-token','GET'],
  ['v-22222222-2222-4222-8222-222222222222.'+zone,'/.well-known/acme-challenge/remote-token','GET'],
  [staff,'/.well-known/acme-challenge/account-token','GET'],
  [staff,'/.well-known/acme-challenge/remote-token','POST'],
  [staff,'/.well-known/acme-challenge/remote-token?other=1','GET'],
  [staff,'/.well-known/acme-challenge/%2e%2e%2faccount-token','GET'],
  [staff,'/','GET'],
 ])assert.equal((await f.send(host,path,method)).status,404,host+' '+path+' '+method);
 const duplicate=await f.send(zone,'/.well-known/acme-challenge/account-token','GET',['Host',zone,'Host','evil.example.test']);assert.ok([400,404].includes(duplicate.status));
 assert.deepEqual(await f.send(staff),{status:200,body:'remote-token.remote-key'});
});

test('standalone process serves account challenges and shuts down without any Cloud services',async t=>{
 const {spawn}=await import('node:child_process'),root=await mkdtemp(join(tmpdir(),'cloud-http-process-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'.well-known/acme-challenge'),{recursive:true});await writeFile(join(root,'.well-known/acme-challenge/account-token'),'account proof');
 const child=spawn(process.execPath,['deploy/test-cloud/http-challenges.mjs'],{env:{PATH:process.env.PATH,TEST_CLOUD_ORIGIN:'https://'+zone,TEST_CLOUD_REMOTE_ZONE:zone,TEST_CLOUD_ACCOUNT_WEBROOT:root,TEST_CLOUD_CHALLENGE_DIR:join(root,'remote'),TEST_CLOUD_HTTP_PORT:'0'},stdio:['ignore','pipe','pipe']});
 const exited=new Promise(resolve=>child.once('close',resolve));t.after(async()=>{if(child.exitCode===null)child.kill('SIGTERM');await exited;});
 const ready=await Promise.race([new Promise(resolve=>{let out='';child.stdout.on('data',part=>{out+=part;if(out.includes('\n'))resolve(JSON.parse(out.split('\n')[0]));});}),exited.then(code=>({exited:code}))]);
 assert.equal(ready.status,'listening','the independent challenge command must stay up');assert.ok(ready.port>0);
 // node:http preserves the explicit Host; Node26 fetch derives it from the URL.
 const response=await new Promise((resolve,reject)=>{const req=request({host:'127.0.0.1',port:ready.port,path:'/.well-known/acme-challenge/account-token',headers:{host:zone}},res=>{let body='';res.on('data',part=>body+=part);res.on('end',()=>resolve({status:res.statusCode,body}));});req.on('error',reject);req.end();});assert.deepEqual(response,{status:200,body:'account proof'});
 child.kill('SIGTERM');assert.equal(await exited,0);
});
