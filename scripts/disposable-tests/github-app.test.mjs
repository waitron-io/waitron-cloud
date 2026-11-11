import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {generateKeyPairSync,verify} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('App authentication uses a short JWT and keeps the installation token off request URLs',async t=>{
 t.mock.timers.enable({apis:['Date'],now:120000});
 const {GithubApp,withRequestCounts}=await import('./github-app.mjs');
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
 const rows=[];t.mock.method(console,'error',line=>rows.push(JSON.parse(line)));
 assert.equal(typeof withRequestCounts,'function');
 await withRequestCounts(()=>app.token());assert.equal(rows[0].requests,1);assert.equal(rows[0].latestResponse.kind,'token');
 await withRequestCounts(async()=>{assert.deepEqual(await app.get('/fixture'),{id:789});assert.deepEqual(await app.get('/fixture'),{id:789});});
 assert.equal(rows.length,2);assert.equal(rows[1].requests,2);assert.equal(rows[1].final,true);assert.equal(rows[1].latestResponse.kind,'api');
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

test('request counts share clients, retain quota snapshots and omit external log downloads',async t=>{
 t.mock.timers.enable({apis:['Date'],now:120000});
 const {GithubApp,withRequestCounts}=await import('./github-app.mjs');
 const rows=[];t.mock.method(console,'error',line=>rows.push(JSON.parse(line)));
 const server=createServer((req,res)=>{res.setHeader('x-ratelimit-resource','core');res.setHeader('x-ratelimit-remaining','17');res.setHeader('x-ratelimit-reset','2000000000');
  if(req.url==='/refused'){res.writeHead(403);res.end('private refusal');}
  else if(req.url==='/invalid')res.end('invalid JSON');
  else res.end('{}');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const first=new GithubApp({apiBase:`http://127.0.0.1:${server.address().port}`}),second=new GithubApp({apiBase:first.apiBase});
 first.token=second.token=async()=>'private-token';
 assert.equal(typeof withRequestCounts,'function');
 await withRequestCounts(async()=>{
  await first.get('/ok');await assert.rejects(second.get('/invalid'),SyntaxError);
  await assert.rejects(second.get('/refused'),{status:403});
 });
 assert.equal(rows[0].requests,3);assert.deepEqual(rows[0].latestResponse,{at:rows[0].latestResponse.at,kind:'api',status:403,resource:'core',limit:null,used:null,remaining:'17',reset:'2000000000'});
 const fetch=globalThis.fetch;t.after(()=>{globalThis.fetch=fetch;});let calls=0;
 globalThis.fetch=async()=>{calls++;if(calls===1)throw new TypeError('private fetch failure');
  if(calls===2)return new Response(null,{status:302,headers:{location:'https://logs.actions.githubusercontent.com/private-download'}});
  return new Response('log');};
 await withRequestCounts(async()=>{await assert.rejects(first.get('/broken'),TypeError);assert.equal(await second.jobLog('/log'),'log');});
 assert.equal(calls,3);assert.equal(rows[1].requests,2);assert.equal(rows[1].failedFetches,1);
 assert.deepEqual(rows[1].latestResponse,{at:rows[1].latestResponse.at,kind:'api',status:302,resource:null,limit:null,used:null,remaining:null,reset:null});
 assert.doesNotMatch(JSON.stringify(rows),/private|Bearer|fixture|127\.0\.0/);
 globalThis.fetch=fetch;const length=rows.length;await first.request('/outside',{authorization:'private'});assert.equal(rows.length,length);
});

test('count logging owns one timer, UTC request buckets and a final flush even on failure',async t=>{
 const {GithubApp,withRequestCounts}=await import('./github-app.mjs');const rows=[];
 t.mock.method(console,'error',line=>rows.push(JSON.parse(line)));t.mock.timers.enable({apis:['Date','setInterval'],now:120000});
 const app=new GithubApp({});app.token=async()=>'private';
 t.mock.method(globalThis,'fetch',async()=>new Response('{}'));
 assert.equal(typeof withRequestCounts,'function');
 await withRequestCounts(async()=>{
  await app.get('/one');t.mock.timers.tick(60000);await app.get('/two');t.mock.timers.tick(60000);
 });
 assert.deepEqual(rows.map(row=>[row.minute,row.requests,row.final]),[[120000,1,false],[180000,1,false],[240000,0,true]]);
 assert.ok(rows.every(row=>row.pid===process.pid && row.startedAt===120000 && row.to>=row.from));
 const length=rows.length;t.mock.timers.tick(60000);assert.equal(rows.length,length,'Timer must stop with its scope');
 await assert.rejects(withRequestCounts(async()=>{await app.get('/failure');throw new Error('work failed');}),/work failed/);
 assert.equal(rows.at(-1).final,true);assert.equal(rows.at(-1).requests,1);
 const end=rows.length;t.mock.timers.tick(60000);assert.equal(rows.length,end);
});

test('quota counts separate endpoint categories and keep each category raw headers',async t=>{
 t.mock.timers.enable({apis:['Date'],now:120000});
 const {GithubApp,withRequestCounts}=await import('./github-app.mjs'),rows=[];
 t.mock.method(console,'error',line=>rows.push(JSON.parse(line)));
 const server=createServer((req,res)=>{
  const job=req.url.includes('/jobs/');res.writeHead(job?403:200,{'x-ratelimit-resource':'core',
   'x-ratelimit-limit':'5000','x-ratelimit-used':job?'5000':'813',
   'x-ratelimit-remaining':job?'0':'4187','x-ratelimit-reset':job?'2000000000':'2000000100'});res.end('{}');
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const app=new GithubApp({apiBase:`http://127.0.0.1:${server.address().port}`});app.token=async()=>'private-token';
 await withRequestCounts(async()=>{
  await assert.rejects(app.get('/repos/private/venue/actions/jobs/123'),{status:403});
  await app.get('/repos/private/venue/actions/runs?status=queued');
 },'worker');
 assert.equal(rows[0].role,'worker');assert.equal(rows[0].requests,2);
 assert.equal(rows[0].categories['GET job'].requests,1);
 assert.equal(rows[0].categories['GET runs'].requests,1);
 assert.deepEqual(rows[0].categories['GET job'].latestResponse,{at:rows[0].categories['GET job'].latestResponse.at,
  kind:'api',status:403,resource:'core',limit:'5000',used:'5000',remaining:'0',reset:'2000000000'});
 assert.equal(rows[0].categories['GET runs'].latestResponse.used,'813');
 assert.equal(rows[0].latestResponse.limit,'5000');assert.equal(rows[0].latestResponse.used,'813');
 assert.doesNotMatch(JSON.stringify(rows),/private|venue|123|Bearer/);
});

test('category totals include token, writes, 304 and rejected fetches without retaining URLs',async t=>{
 t.mock.timers.enable({apis:['Date'],now:120000});
 const {GithubApp,withRequestCounts}=await import('./github-app.mjs'),rows=[];
 t.mock.method(console,'error',line=>rows.push(JSON.parse(line)));
 const app=new GithubApp({});app.token=async()=>'private';
 t.mock.method(globalThis,'fetch',async url=>{
  if(url.endsWith('/broken'))throw new TypeError('failed');
  return url.endsWith('/unchanged')?new Response(null,{status:304}):new Response('{}');
 });
 await withRequestCounts(async()=>{
  await app.request('/app/installations/456/access_tokens',{method:'POST',authorization:'private'});
  await app.post('/repos/private/venue/actions/variables',{secret:'private'});
  await assert.rejects(app.get('/unchanged'),{status:304});
  await assert.rejects(app.get('/broken'),TypeError);
 },'controller');
 assert.equal(rows[0].role,'controller');assert.equal(rows[0].requests,4);
 assert.equal(rows[0].categories['POST token'].requests,1);
 assert.equal(rows[0].categories['POST variable'].requests,1);
 assert.equal(rows[0].categories['GET other'].requests,2);
 assert.equal(rows[0].categories['GET other'].notModified,1);
 assert.equal(rows[0].categories['GET other'].failedFetches,1);
 assert.equal(rows[0].notModified,1);assert.equal(rows[0].failedFetches,1);
 assert.doesNotMatch(JSON.stringify(rows),/private|venue|456|unchanged|broken/);
});

test('admission source and log reads have distinct fixed quota categories',async t=>{
 const {GithubApp,withRequestCounts}=await import('./github-app.mjs'),rows=[];
 t.mock.method(console,'error',line=>rows.push(JSON.parse(line)));
 t.mock.method(globalThis,'fetch',async()=>new Response('{}'));
 const app=new GithubApp({});app.token=async()=>'private';
 await withRequestCounts(async()=>{
  for(const path of ['/repos/fixture/venue','/repos/fixture/venue/contents/.github/workflows/ci.yml?ref=abc',
   '/repos/fixture/venue/commits/abc','/repos/fixture/venue/actions/permissions/fork-pr-contributor-approval',
   '/repos/fixture/venue/actions/workflows/123/runs?status=queued','/repos/fixture/venue/actions/jobs/123/logs',
   '/repos/fixture/venue/actions/jobs/123','/repos/fixture/venue/git/ref/heads/main'])await app.get(path);
 },'controller');
 assert.deepEqual(Object.fromEntries(Object.entries(rows[0].categories).map(([key,value])=>[key,value.requests])),
  {'GET repository':1,'GET contents':1,'GET commit':1,'GET permissions':1,'GET workflow-runs':1,'GET job-log':1,'GET job':1,'GET ref':1});
 assert.equal(rows[0].requests,8);
 assert.doesNotMatch(JSON.stringify(rows),/fixture|venue|abc/);
});
