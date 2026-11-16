import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:https';
import {randomUUID,X509Certificate} from 'node:crypto';
import test from 'node:test';
const exec=promisify(execFile),root=new URL('../../',import.meta.url).pathname,image=process.env.TEST_CLOUD_DOCKER_PROOF_IMAGE;

test('configured test Cloud serves trusted HTTPS and captures public signup links while rejecting other authorities',{skip:!image,timeout:240000},async t=>{
 const project='cloud-public-proof-'+randomUUID().slice(0,8),dir=await mkdtemp(join(tmpdir(),'cloud-public-proof-')),origin='https://cloud.example.test';
 const command=async(file,args)=>(await exec(file,args,{cwd:root,env:{...process.env,TEST_CLOUD_IMAGE:image,TEST_CLOUD_ORIGIN:origin,TEST_CLOUD_CERTIFICATE_SOURCE:dir},timeout:180000,maxBuffer:2*1024*1024})).stdout.trim();
 await command('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'privkey.pem'),'-out',join(dir,'fullchain.pem'),'-days','2','-subj','/CN=cloud.example.test','-addext','subjectAltName=DNS:cloud.example.test','-addext','basicConstraints=critical,CA:FALSE']);
 const ca=await readFile(join(dir,'fullchain.pem'));
 const override=join(dir,'proof.yaml');await writeFile(override,`services:\n  proxy:\n    ports: !override ["127.0.0.1::3000"]\n    healthcheck:\n      test: ["CMD", "curl", "--fail", "--silent", "--cacert", "/run/local-stack/lan/public-proxy.pem", "--connect-to", "::127.0.0.1:3000", "${origin}/api/health/ready"]\n  mailpit:\n    ports: !override ["127.0.0.1::8025"]\n`);
 const prefix=['compose','--project-name',project,'--env-file','deploy/test-cloud/test.env','-f','compose.yaml','-f','deploy/test-cloud/compose.yaml','-f','deploy/test-cloud/compose.amazon.yaml','-f',override],docker=args=>command('docker',args);
 t.after(async()=>{
  try{
   const ids=(await docker(['ps','-aq','--no-trunc','--filter',`label=com.docker.compose.project=${project}`])).split(/\s+/).filter(Boolean);
   if(ids.length){await docker(['stop','--time','10',...ids]);await docker(['rm','-v',...ids]);}
   for(const kind of ['network','volume'])for(const id of (await docker([kind,'ls','-q','--filter',`label=com.docker.compose.project=${project}`])).split(/\s+/).filter(Boolean))await docker([kind,'rm',id]);
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 try{await docker([...prefix,'up','--no-build','--pull','never','--detach','--wait','--wait-timeout','120']);}
 catch(error){console.error(await docker([...prefix,'logs','--no-color','--tail','12','bootstrap','storage','account','email-worker','proxy']));throw error;}
 let port=Number((await docker([...prefix,'port','proxy','3000'])).split(':').at(-1)),mailPort=Number((await docker([...prefix,'port','mailpit','8025'])).split(':').at(-1));
 const send=({path='/api/health/ready',method='GET',headers={},body,trust=ca}={})=>new Promise((yes,no)=>{
  const req=request({host:'127.0.0.1',port,servername:'cloud.example.test',ca:trust,path,method,headers:{host:'cloud.example.test',...headers}},res=>{const certificate=new X509Certificate(res.socket.getPeerCertificate().raw).fingerprint256;let text='';res.setEncoding('utf8');res.on('data',c=>text+=c);res.on('end',()=>yes({status:res.statusCode,text,certificate}));});req.on('error',no);req.end(body);
 });
 assert.equal((await send()).status,200);await assert.rejects(send({trust:[]}),/certificate|self.signed|issuer/i);
 assert.equal((await send({headers:{host:'waitron.local:3000'}})).status,403);
 assert.equal((await send({headers:{origin:'https://other.example.test'}})).status,403);
 assert.equal((await send({headers:{origin:['https://cloud.example.test','https://cloud.example.test']}})).status,403);
 assert.equal((await send({headers:{origin,forwarded:'for=evil','x-forwarded-host':'evil.test','x-forwarded-proto':'http'}})).status,200);
 const signup=await send({path:'/api/account/signup/request',method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:'public-proof@example.test',locale:'en'})});assert.equal(signup.status,202,signup.text);
 let message;for(let n=0;n<80;n++){const inbox=await(await fetch(`http://127.0.0.1:${mailPort}/api/v1/messages`)).json();if(inbox.messages?.length){message=await(await fetch(`http://127.0.0.1:${mailPort}/api/v1/message/${inbox.messages[0].ID}`)).json();break;}await new Promise(r=>setTimeout(r,250));}
 assert.match(message?.Text??'',/https:\/\/cloud\.example\.test\/signup#token=/);
 const proxy=(await docker([...prefix,'ps','-q','proxy'])).trim(),before=await docker(['exec',proxy,'sha256sum','/run/local-stack/lan/ca.pem','/run/local-stack/lan/ca-key.pem']);
 const first=(await send()).certificate;
 await command('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'privkey.pem'),'-out',join(dir,'fullchain.pem'),'-days','2','-subj','/CN=cloud.example.test','-addext','subjectAltName=DNS:cloud.example.test','-addext','basicConstraints=critical,CA:FALSE']);
 await docker([...prefix,'run','--rm','bootstrap']);await docker([...prefix,'restart','proxy']);
 port=Number((await docker([...prefix,'port','proxy','3000'])).split(':').at(-1));
 const renewed=await readFile(join(dir,'fullchain.pem'));let response,lastError;
 for(let n=0;n<50;n++){try{response=await send({trust:renewed});break;}catch(error){lastError=error;}await new Promise(r=>setTimeout(r,100));}
 if(!response)console.error(await docker([...prefix,'logs','--no-color','--tail','15','proxy']));
 assert.equal(response?.status,200,lastError?.message);assert.notEqual(response.certificate,first);
 assert.equal(await docker(['exec',proxy,'sha256sum','/run/local-stack/lan/ca.pem','/run/local-stack/lan/ca-key.pem']),before);
});
