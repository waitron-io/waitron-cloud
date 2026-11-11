import assert from 'node:assert/strict';
import {readFileSync,lstatSync} from 'node:fs';
import {createPrivateKey,sign} from 'node:crypto';
function privateFile(path){const info=lstatSync(path);assert.ok(info.isFile() && !info.isSymbolicLink() &&
 info.uid===process.getuid() && (info.mode&0o077)===0,'App credential must be a private owned regular file');return readFileSync(path,'utf8');}
async function boundedBody(response,limit){
 const buffers=[];let size=0;
 try{for await(const chunk of response.body??[]){size+=chunk.length;assert.ok(size<=limit,'GitHub response byte limit exceeded');buffers.push(chunk);}}
 catch(error){await response.body?.cancel().catch(()=>{});throw error;}
 return Buffer.concat(buffers);
}
let requestCounts;
export async function withRequestCounts(work,role='other'){
 assert.equal(requestCounts,undefined,'Request count scope already active');
 const startedAt=Date.now(),buckets=new Map(),scope={buckets,latestResponse:null};requestCounts=scope;
 let minute=Math.floor(startedAt/60000)*60000;
 const flush=final=>{
  const now=Date.now(),current=Math.floor(now/60000)*60000;
  while(minute<current || final && minute===current){
   console.error(JSON.stringify({event:'github-request-counts',pid:process.pid,role,startedAt,minute,
    from:Math.max(startedAt,minute),to:Math.min(now,minute+60000),requests:buckets.get(minute)?.requests??0,
    failedFetches:buckets.get(minute)?.failedFetches??0,notModified:buckets.get(minute)?.notModified??0,
    categories:buckets.get(minute)?.categories??{},latestResponse:scope.latestResponse,final:final && minute===current}));
   buckets.delete(minute);minute+=60000;
  }
 };
 const timer=setInterval(()=>flush(false),60000);timer.unref();
 try{return await work();}finally{clearInterval(timer);flush(true);requestCounts=undefined;}
}
async function githubFetch(url,options,kind='api'){
 const scope=requestCounts;
 const path=new URL(url).pathname;
 const category=kind==='token'?'token':/\/actions\/jobs\/[0-9]+(?:\/logs)?$/.test(path)?'job':
  /\/actions\/runs\/[0-9]+\/(?:attempts\/[0-9]+\/)?jobs$/.test(path)?'jobs':
  /\/actions\/runs\/[0-9]+(?:\/.*)?$/.test(path)?'run':/\/actions\/runs$/.test(path)?'runs':
  /\/actions\/runners(?:\/.*)?$/.test(path)?'runner':/\/actions\/variables(?:\/.*)?$/.test(path)?'variable':
  /\/pulls(?:\/.*)?$/.test(path)?'pull':/\/compare\//.test(path)?'compare':'other';
 const method=options?.method??'GET',key=(/^(GET|POST|PATCH|DELETE|PUT|HEAD)$/.test(method)?method:'OTHER')+' '+category;
 const bucket=()=>{const minute=Math.floor(Date.now()/60000)*60000;
  if(!scope.buckets.has(minute))scope.buckets.set(minute,{requests:0,failedFetches:0,notModified:0,categories:{}});return scope.buckets.get(minute);};
 const entry=()=>{const b=bucket();return b.categories[key]??=( {requests:0,failedFetches:0,notModified:0,latestResponse:null} );};
 if(scope){bucket().requests++;entry().requests++;}
 let response;
 try{response=await fetch(url,options);}catch(error){if(scope){bucket().failedFetches++;entry().failedFetches++;}throw error;}
 if(scope){scope.latestResponse={at:Date.now(),kind,status:response.status,resource:response.headers.get('x-ratelimit-resource'),
  limit:response.headers.get('x-ratelimit-limit'),used:response.headers.get('x-ratelimit-used'),
  remaining:response.headers.get('x-ratelimit-remaining'),reset:response.headers.get('x-ratelimit-reset')};
  entry().latestResponse=scope.latestResponse;
  if(response.status===304){bucket().notModified++;entry().notModified++;}
 }
 return response;
}
export class GithubApp {
 constructor({appEnv,appKey,apiBase='https://api.github.com'}){Object.assign(this,{appEnv,appKey,apiBase});
  assert.ok(apiBase==='https://api.github.com' || /^http:\/\/127\.0\.0\.1:[0-9]+$/.test(apiBase),'Untrusted GitHub API origin');}
 async request(path,{method='GET',body,authorization,signal}={}){
  const comparison=method==='GET' && /^\/repos\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/compare\/[a-f0-9]{40}\.\.\.[a-f0-9]{40}(?:\?per_page=1&page=2)?$/.test(path);
  assert.ok(/^\/[a-zA-Z0-9_./?=&%-]+$/.test(path) && (!path.includes('..') || comparison),'Invalid GitHub API path');
  const response=await githubFetch(this.apiBase+path,{method,redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),
   headers:{accept:'application/vnd.github+json','x-github-api-version':'2026-03-10','user-agent':'waitron-disposable-ci',
    authorization:'Bearer '+authorization,...(body===undefined?{}:{'content-type':'application/json'})},
   ...(body===undefined?{}:{body:JSON.stringify(body)})},path.startsWith('/app/installations/')?'token':'api');
  if(!response.ok){
   await response.body?.cancel();const error=new Error(`GitHub ${method} refused (${response.status})`);error.status=response.status;
   const after=response.headers.get('retry-after'),remaining=response.headers.get('x-ratelimit-remaining'),reset=response.headers.get('x-ratelimit-reset');
   if(response.status===429 || response.status===403 && (after!==null || remaining==='0')){
    const now=Date.now(),times=[];
    if(after!==null && /^[0-9]+$/.test(after) && Number.isSafeInteger(Number(after)*1000))times.push(now+Number(after)*1000);
    if(remaining==='0' && reset!==null && /^[0-9]+$/.test(reset) && Number.isSafeInteger(Number(reset)*1000))times.push(Number(reset)*1000);
    error.retryAt=times.length?Math.max(...times):now+60000;
   }
   throw error;
  }
  let bytes;
  try{bytes=await boundedBody(response,2*1024*1024);}
  catch(error){
   if(error instanceof TypeError)throw Object.assign(new Error('GitHub response interrupted',{cause:error}),{code:'GITHUB_RESPONSE_INTERRUPTED'});
   if(comparison && error.message==='GitHub response byte limit exceeded')throw Object.assign(new Error('GitHub ancestry response exceeded its byte limit',{cause:error}),{code:'GITHUB_RESPONSE_LIMIT'});
   throw error;
  }
  return bytes.byteLength?JSON.parse(Buffer.from(bytes).toString()):null;
 }
 async token(){
  if(this.cached && this.cached.expires>Date.now()+60000)return this.cached.token;
  const fields=Object.fromEntries(privateFile(this.appEnv).trim().split(/\r?\n/).map(line=>{
   const match=/^(GITHUB_APP_ID|GITHUB_APP_INSTALLATION_ID)=([0-9]+)$/.exec(line);assert.ok(match,'Invalid App configuration');return [match[1],match[2]];}));
  assert.equal(Object.keys(fields).length,2,'Missing App identity');
  const now=Math.floor(Date.now()/1000),encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const content=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iat:now-60,exp:now+480,iss:fields.GITHUB_APP_ID});
  const jwt=content+'.'+sign('RSA-SHA256',Buffer.from(content),createPrivateKey(privateFile(this.appKey))).toString('base64url');
  const issued=await this.request(`/app/installations/${fields.GITHUB_APP_INSTALLATION_ID}/access_tokens`,{method:'POST',authorization:jwt});
  assert.ok(typeof issued.token==='string' && issued.token.length>0 && Date.parse(issued.expires_at)>Date.now()+60000,'Invalid App token response');
  this.cached={token:issued.token,expires:Date.parse(issued.expires_at)};return issued.token;
 }
 async jobLog(path,{signal}={}){
  assert.match(path,/^\/[a-zA-Z0-9_./-]+$/);
  const budget=signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000);
  const authorization='Bearer '+await this.token();
  let response=await githubFetch(this.apiBase+path,{redirect:'manual',signal:budget,
   headers:{authorization,'user-agent':'waitron-disposable-ci'}});
  if(response.status===302){const target=new URL(response.headers.get('location'));
   await response.body?.cancel();assert.ok(target.protocol==='https:' &&
    (target.hostname.endsWith('.blob.core.windows.net') || target.hostname.endsWith('.actions.githubusercontent.com')),'Untrusted job log redirect');
   response=await fetch(target,{redirect:'error',signal:budget});}
  assert.ok(response.ok,'GitHub job log read refused');return (await boundedBody(response,64*1024*1024)).toString();
 }
 async call(path,options){return this.request(path,{...options,authorization:await this.token()});}
 get(path,options){return this.call(path,options);}
 post(path,body,options){return this.call(path,{...options,method:'POST',body});}
 patch(path,body,options){return this.call(path,{...options,method:'PATCH',body});}
 delete(path,options){return this.call(path,{...options,method:'DELETE'});}
}
