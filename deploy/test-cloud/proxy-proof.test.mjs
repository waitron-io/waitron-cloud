import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {request} from 'node:https';
import test from 'node:test';
const exec=promisify(execFile),image=process.env.TEST_CLOUD_DOCKER_PROOF_IMAGE;
test('real TLS proxy enforces authority before an independent backend and removes forwarding spoof', {skip:!image,timeout:45000},async t=>{
 const program=`import{bootstrapTestCloud}from'/app/deploy/test-cloud/bootstrap.mjs';import{readFile,writeFile}from'node:fs/promises';import{createServer}from'node:http';import{spawn}from'node:child_process';await bootstrapTestCloud('/tmp/private');let cfg=await readFile('/app/deploy/test-cloud/proxy.cfg','utf8');cfg=cfg.replace('/run/local-stack/lan/proxy.pem','/tmp/private/lan/proxy.pem').replace('account:3000','127.0.0.1:3001');if(process.env.MUTATION)cfg=cfg.split('\\n').filter(line=>!line.includes(process.env.MUTATION)).join('\\n');await writeFile('/tmp/proxy.cfg',cfg);const backend=createServer((req,res)=>res.end(JSON.stringify(req.headers)));await new Promise(r=>backend.listen(3001,'127.0.0.1',r));const child=spawn('haproxy',['-W','-db','-f','/tmp/proxy.cfg'],{stdio:'inherit'});child.on('exit',code=>process.exit(code??1));console.log('PUBLIC_CA '+(await readFile('/tmp/private/lan/ca.pem')).toString('base64'));`;
 const args=['run','--detach','--read-only','--memory','128m','--tmpfs','/tmp:mode=0700','--publish','127.0.0.1::3000',...(process.env.TEST_CLOUD_PROXY_MUTATION?['--env','MUTATION='+process.env.TEST_CLOUD_PROXY_MUTATION]:[]),image,'node','--input-type=module','-e',program];
 const run=async args=>(await exec('docker',args,{timeout:30000,maxBuffer:1024*1024})).stdout.trim();const id=await run(args);t.after(async()=>{await run(['stop','--time','5',id]);await run(['rm','-v',id]);});
 let ca;for(let n=0;n<100;n++){const line=(await run(['logs',id])).split('\n').find(line=>line.startsWith('PUBLIC_CA '));if(line){ca=Buffer.from(line.slice(10),'base64');break;}await new Promise(r=>setTimeout(r,100));}assert.ok(ca,'public CA missing');
 const port=Number((await run(['port',id,'3000/tcp'])).split(':').at(-1));
 const send=headers=>new Promise((yes,no)=>{const req=request({host:'127.0.0.1',port,servername:'waitron.local',ca,headers:{host:'waitron.local:3000',...headers}},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>yes({status:res.statusCode,body}));});req.on('error',no);req.end();});
 let response;for(let n=0;n<50;n++){try{response=await send({});break;}catch{}await new Promise(r=>setTimeout(r,100));}assert.equal(response?.status,200);
 assert.equal((await send({host:'wrong.local:3000'})).status,403,'proxy Host guard');assert.equal((await send({host:['waitron.local:3000','evil.test']})).status,400,'duplicate Host guard');assert.equal((await send({origin:['https://waitron.local:3000','https://waitron.local:3000']})).status,403,'duplicate Origin guard');assert.equal((await send({origin:'https://evil.test'})).status,403,'proxy Origin guard');
 const value=JSON.parse((await send({origin:'https://waitron.local:3000','x-forwarded-for':'spoof','x-forwarded-host':'evil.test','x-forwarded-proto':'http','x-forwarded-port':'1',forwarded:'for=evil','x-real-ip':'evil'})).body);
 assert.equal(value.host,'waitron.local:3000');assert.equal(value.origin,'https://waitron.local:3000');assert.notEqual(value['x-forwarded-for'],'spoof');assert.match(value['x-forwarded-for'],/^\d+\.\d+\.\d+\.\d+$/);assert.equal(value['x-forwarded-proto'],'https');
 for(const name of ['forwarded','x-forwarded-host','x-forwarded-port','x-real-ip'])assert.equal(value[name],undefined,name);
});
