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
 await f.removeHttpChallenge(f.remoteDirectory,staff,'remote-token');assert.equal((await f.send(staff)).status,404);
 assert.deepEqual(await f.send(zone,'/.well-known/acme-challenge/account-token'),{status:200,body:'account-token.account-key'});
});
test('refuses wrong authority, token, method and path without disclosing or changing challenge files',async t=>{
 const f=await fixture(t);await f.presentHttpChallenge(f.remoteDirectory,staff,'remote-token','remote-token.remote-key');
 await assert.rejects(f.presentHttpChallenge(f.remoteDirectory,staff,'../escape','unsafe'),/test_cloud.http_challenge/);
 assert.equal((await f.send(staff)).status,200);
 for(const [host,path,method] of [
  ['evil.example.test','/.well-known/acme-challenge/remote-token','GET'],
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
