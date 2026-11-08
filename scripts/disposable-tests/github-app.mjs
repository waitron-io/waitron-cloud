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
export class GithubApp {
 constructor({appEnv,appKey,apiBase='https://api.github.com'}){Object.assign(this,{appEnv,appKey,apiBase});
  assert.ok(apiBase==='https://api.github.com' || /^http:\/\/127\.0\.0\.1:[0-9]+$/.test(apiBase),'Untrusted GitHub API origin');}
 async request(path,{method='GET',body,authorization,signal}={}){
  const comparison=method==='GET' && /^\/repos\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/compare\/[a-f0-9]{40}\.\.\.[a-f0-9]{40}(?:\?per_page=1&page=2)?$/.test(path);
  assert.ok(/^\/[a-zA-Z0-9_./?=&%-]+$/.test(path) && (!path.includes('..') || comparison),'Invalid GitHub API path');
  const response=await fetch(this.apiBase+path,{method,redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),
   headers:{accept:'application/vnd.github+json','x-github-api-version':'2026-03-10','user-agent':'waitron-disposable-ci',
    authorization:'Bearer '+authorization,...(body===undefined?{}:{'content-type':'application/json'})},
   ...(body===undefined?{}:{body:JSON.stringify(body)})});
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
  let response=await fetch(this.apiBase+path,{redirect:'manual',signal:budget,
   headers:{authorization:'Bearer '+await this.token(),'user-agent':'waitron-disposable-ci'}});
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
