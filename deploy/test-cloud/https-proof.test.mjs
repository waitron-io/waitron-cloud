import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:https';
import {randomUUID} from 'node:crypto';
import test from 'node:test';
const execute=promisify(execFile),root=new URL('../../',import.meta.url).pathname;
const image=process.env.TEST_CLOUD_DOCKER_PROOF_IMAGE;
test('real HTTPS signup, proxy authority, private restart identity and owned rollback', {skip:!image,timeout:240000},async t=>{
 const project='waitron-cloud-test-proof-'+randomUUID().slice(0,8),dir=await mkdtemp(join(tmpdir(),'cloud-lan-proof-'));
 const override=join(dir,'proof.yaml');await writeFile(override,`name: ${project}\nservices:\n  proxy:\n    ports: !override ["127.0.0.1::3000"]\n  postgres:\n    ports: !override ["127.0.0.1::5432"]\n  mailpit:\n    ports: !override ["127.0.0.1::1025", "127.0.0.1::8025"]\n  storage:\n    ports: !override ["127.0.0.1::8333"]\n  gateway:\n    ports: !override ["127.0.0.1::443", "127.0.0.1::51820/udp"]\n`);
 const prefix=['compose','--project-name',project,'--env-file','deploy/test-cloud/test.env','-f','compose.yaml','-f','deploy/test-cloud/compose.yaml','-f',override];
 const docker=async args=>(await execute('docker',args,{cwd:root,env:{...process.env,TEST_CLOUD_IMAGE:image},timeout:180000,maxBuffer:2*1024*1024})).stdout.trim();
 let started=false,ids=[],volumes=[],networks=[];
 t.after(async()=>{
  try{
   if(started){ids=(await docker(['ps','-aq','--no-trunc','--filter',`label=com.docker.compose.project=${project}`])).split(/\s+/).filter(Boolean);if(ids.length){await docker(['stop','--time','10',...ids]);await docker(['rm','-v',...ids]);}
    networks=(await docker(['network','ls','-q','--filter',`label=com.docker.compose.project=${project}`])).split(/\s+/).filter(Boolean);for(const id of networks)await docker(['network','rm',id]);
    volumes=(await docker(['volume','ls','-q','--filter',`label=com.docker.compose.project=${project}`])).split(/\s+/).filter(Boolean);for(const id of volumes)await docker(['volume','rm',id]);
   }
  }finally{await rm(dir,{recursive:true,force:true});}
 });
 started=true;
 try{await docker([...prefix,'up','--no-build','--pull','never','--detach','--wait','--wait-timeout','120']);}
 catch(error){console.error(await docker([...prefix,'ps','-a','--format','json']));console.error(await docker([...prefix,'logs','--no-color','--tail','15','account','email-worker','proxy']));throw new Error('Disposable test Cloud failed startup', {cause:error});}
 ids=(await docker(['ps','-aq','--no-trunc','--filter',`label=com.docker.compose.project=${project}`])).split(/\s+/).filter(Boolean);
 const services=JSON.parse(await docker([...prefix,'ps','-a','--format','json']).then(text=>text.startsWith('[')?text:'['+text.split('\n').join(',')+']'));
 const proxy=services.find(s=>s.Service==='proxy'),account=services.find(s=>s.Service==='account'),mail=services.find(s=>s.Service==='mailpit');
 let port=Number((await docker([...prefix,'port','proxy','3000'])).split(':').at(-1));const mailPort=Number((await docker([...prefix,'port','mailpit','8025'])).split(':').at(-1));
 const ca=Buffer.from(await docker(['exec',proxy.ID,'cat','/run/local-stack/lan/ca.pem'])+'\n');assert.match(ca.toString(),/BEGIN CERTIFICATE/);assert.doesNotMatch(ca.toString(),/PRIVATE/);
 const fetchTLS=({path='/api/health/ready',method='GET',headers={},body,trust=ca,servername='waitron.local'}={})=>new Promise((yes,no)=>{
  const req=request({host:'127.0.0.1',port,servername,ca:trust,path,method,headers:{host:'waitron.local:3000',...headers}},res=>{let text='';res.setEncoding('utf8');res.on('data',c=>text+=c);res.on('end',()=>yes({status:res.statusCode,headers:res.headers,body:text}));});req.on('error',no);req.end(body);
 });
 assert.equal((await fetchTLS()).status,200);await assert.rejects(fetchTLS({trust:null}),/certificate|issuer|verify/i);await assert.rejects(fetchTLS({servername:'wrong.local'}),/Hostname\/IP does not match|certificate/i);
 assert.equal((await fetchTLS({headers:{host:'wrong.local:3000'}})).status,403);assert.equal((await fetchTLS({headers:{origin:'https://wrong.local:3000'}})).status,403);
 assert.equal((await fetchTLS({headers:{origin:'https://waitron.local:3000','x-forwarded-for':'garbage','x-forwarded-host':'evil.test','x-forwarded-proto':'http',forwarded:'for=evil'}})).status,200);
 const signup=await fetchTLS({path:'/api/account/signup/request',method:'POST',headers:{origin:'https://waitron.local:3000','content-type':'application/json'},body:JSON.stringify({email:'lan-proof@example.test',locale:'en'})});assert.equal(signup.status,202,signup.body);
 let message;for(let n=0;n<80;n++){const inbox=await(await fetch(`http://127.0.0.1:${mailPort}/api/v1/messages`)).json();if(inbox.messages?.length){message=await(await fetch(`http://127.0.0.1:${mailPort}/api/v1/message/${inbox.messages[0].ID}`)).json();break;}await new Promise(r=>setTimeout(r,250));}
 assert.match(message?.Text??'',/https:\/\/waitron\.local:3000\/signup#token=/);
 assert.equal((await fetchTLS({path:'/signup'})).status,200);
 const before=await docker(['exec',proxy.ID,'sha256sum','/run/local-stack/runtime.json','/run/local-stack/lan/proxy.pem']);
 await docker([...prefix,'restart','account','proxy','email-worker']);port=Number((await docker([...prefix,'port','proxy','3000'])).split(':').at(-1));
 for(let n=0;n<60;n++){try{if((await fetchTLS()).status===200)break;}catch{}await new Promise(r=>setTimeout(r,250));}
 assert.equal((await fetchTLS()).status,200);assert.equal(await docker(['exec',proxy.ID,'sha256sum','/run/local-stack/runtime.json','/run/local-stack/lan/proxy.pem']),before);
 await docker(['stop','--time','10',...ids]);assert.equal((await docker(['ps','-q','--filter',`label=com.docker.compose.project=${project}`])).length,0);
 const preserved=await docker(['volume','ls','-q','--filter',`label=com.docker.compose.project=${project}`]);assert.ok(preserved.includes('local-stack-config'));assert.ok(preserved.includes('local-stack-postgres'));
 console.log(JSON.stringify({project,containers:ids.length,https:true,signupCaptured:true,proxyGuards:true,restartIdentity:true,stopPreservedVolumes:true,accountBackendPublished:account.Publishers?.some(p=>p.PublishedPort>0)??false}));
});
