import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {generateKeyPairSync,verify} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('App authentication uses a short JWT and keeps the installation token off request URLs',async t=>{
 const {GithubApp}=await import('./github-app.mjs');
 const directory=mkdtempSync(join(tmpdir(),'ci-app-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 writeFileSync(join(directory,'key.pem'),privateKey.export({type:'pkcs1',format:'pem'}),{mode:0o600});
 writeFileSync(join(directory,'app.env'),'GITHUB_APP_ID=123\nGITHUB_APP_INSTALLATION_ID=456\n',{mode:0o600});
 const seen=[];const server=createServer((req,res)=>{
 seen.push(req.url);res.setHeader('content-type','application/json');
 if(req.url==='/app/installations/456/access_tokens'){
 const token=req.headers.authorization.slice(7),[head,body,sig]=token.split('.');
 assert.equal(verify('RSA-SHA256',Buffer.from(head+'.'+body),publicKey,Buffer.from(sig,'base64url')),true);
 const claims=JSON.parse(Buffer.from(body,'base64url'));assert.equal(claims.iss,'123');assert.ok(claims.exp-claims.iat<=600);
 res.end(JSON.stringify({token:'synthetic-installation-token',expires_at:new Date(Date.now()+3600000).toISOString()}));
 }else{assert.equal(req.headers.authorization,'Bearer synthetic-installation-token');res.end('{"id":789}');}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const app=new GithubApp({appEnv:join(directory,'app.env'),appKey:join(directory,'key.pem'),apiBase:`http://127.0.0.1:${server.address().port}`});
 assert.deepEqual(await app.get('/fixture'),{id:789});assert.deepEqual(await app.get('/fixture'),{id:789});
 assert.deepEqual(seen,['/app/installations/456/access_tokens','/fixture','/fixture']);
});
test('job-log reads are bounded plain text without exposing token-bearing redirects',async t=>{
 const {GithubApp}=await import('./github-app.mjs');
 const server=createServer((req,res)=>{res.end('Source '+'3'.repeat(40)+' tree '+'4'.repeat(40)+'\n');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const app=new GithubApp({apiBase:`http://127.0.0.1:${server.address().port}`});app.token=async()=>'synthetic';
 assert.equal(typeof app.jobLog,'function');assert.match(await app.jobLog('/job-log'),/^Source /);
});

// GitHub's compare separator is a literal triple dot, not a parent path.
test('the App can read exact immutable Git comparisons without admitting parent paths',async t=>{
 const {GithubApp}=await import('./github-app.mjs');const seen=[];
 const server=createServer((req,res)=>{seen.push(req.url);res.setHeader('content-type','application/json');res.end('{"status":"ahead"}');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const app=new GithubApp({apiBase:`http://127.0.0.1:${server.address().port}`});app.token=async()=>'synthetic';
 const path='/repos/fixture/waitron/compare/'+'1'.repeat(40)+'...'+'2'.repeat(40);
 assert.deepEqual(await app.get(path),{status:'ahead'});
 for(const bad of ['/repos/fixture/../private','/repos/fixture/waitron/compare/main...other',path+'/../private',path+'?extra=true'])await assert.rejects(app.get(bad),/API path/);
 await assert.rejects(app.post(path,{}),/API path/);assert.deepEqual(seen,[path]);
});
