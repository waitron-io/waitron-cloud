import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {request} from 'node:https';
import test,{before,after} from 'node:test';
import {randomUUID} from 'node:crypto';
import {connect as tlsConnect} from 'node:tls';
const exec=promisify(execFile);let image=process.env.TEST_CLOUD_DOCKER_PROOF_IMAGE,ownedImage;
before(async()=>{if(!image){const tag='cloud-test-proxy-'+randomUUID();await exec('docker',['build','-q','-f','deploy/test-cloud/test-fixtures/proxy.Dockerfile','-t',tag,'.'],{timeout:180000,maxBuffer:1024*1024});image=tag;ownedImage=tag;}},{timeout:180000});
after(async()=>{if(ownedImage)await exec('docker',['image','rm',ownedImage],{timeout:30000});});
test('real TLS proxy enforces authority before an independent backend and removes forwarding spoof', {timeout:45000},async t=>{
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

test('Amazon SNI shares TLS, preserves caller identity, refuses forged proxy input and reloads a held response',{timeout:120000},async t=>{
 const program=`
 import{bootstrapTestCloud}from'/app/deploy/test-cloud/bootstrap.mjs';import{readFile,writeFile}from'node:fs/promises';import{createServer}from'node:http';import{spawn,execFileSync}from'node:child_process';import{renderHaproxy}from'/app/packages/remote-access/src/config.ts';
 await bootstrapTestCloud('/tmp/private');const id='11111111-1111-4111-8111-111111111111',publicHostname='v-'+id+'.r.waitron.local';
 process.env.TEST_CLOUD_HOST='waitron.local';process.env.TEST_CLOUD_ORIGIN='https://waitron.local';process.env.TEST_CLOUD_CERTIFICATE='/tmp/private/lan/proxy.pem';
 const run=args=>execFileSync('openssl',args,{stdio:'ignore'});run(['req','-new','-newkey','rsa:2048','-nodes','-keyout','/tmp/public.key','-out','/tmp/public.csr','-subj','/CN='+publicHostname,'-addext','subjectAltName=DNS:'+publicHostname]);await writeFile('/tmp/public.ext','subjectAltName=DNS:'+publicHostname+'\\nbasicConstraints=critical,CA:FALSE\\n');run(['x509','-req','-in','/tmp/public.csr','-CA','/tmp/private/lan/ca.pem','-CAkey','/tmp/private/lan/ca-key.pem','-set_serial','12','-out','/tmp/public.crt','-days','1','-extfile','/tmp/public.ext']);await writeFile('/tmp/private/public-certs/venue.pem',await readFile('/tmp/public.key')+await readFile('/tmp/public.crt'),{mode:0o600});
 let held;const account=createServer((q,r)=>{if(q.url==='/held'){held=r;r.writeHead(200,{'content-type':'text/plain','connection':'close'});r.write('before');}else if(q.url==='/release'){held.end('after');r.end('released');}else r.end(JSON.stringify(q.headers));});await new Promise(r=>account.listen(3001,'127.0.0.1',r));const gate=createServer((q,r)=>r.end(JSON.stringify(q.headers)));await new Promise(r=>gate.listen(8080,'127.0.0.1',r));
 const route={installationId:id,venueId:id,staffHostname:'staff-'+publicHostname,publicHostname,address:'10.77.61.2',port:443,peerPublicKey:Buffer.alloc(32,1).toString('base64')};await writeFile('/tmp/gateway.cfg',renderHaproxy([route],{port:4444,publicTlsPort:8444,gatePort:8080,certificateDirectory:'/tmp/private/public-certs',proxySource:'127.0.0.1'}));
 const gateway=spawn('haproxy',['-W','-db','-f','/tmp/gateway.cfg'],{stdio:'inherit'});gateway.on('exit',c=>{if(c)process.exit(c);});
 const config=(await readFile('/app/deploy/test-cloud/proxy.cfg','utf8')).replace('account:3000','127.0.0.1:3001');const amazon=(await readFile('/app/deploy/test-cloud/proxy.amazon.cfg','utf8').catch(()=>Buffer.from(''))).toString().replace('gateway:443','127.0.0.1:4444');await writeFile('/tmp/proxy.cfg',config);await writeFile('/tmp/proxy.amazon.cfg',amazon);
 const proxy=spawn('haproxy',['-W','-db','-f','/tmp/proxy.cfg','-f','/tmp/proxy.amazon.cfg'],{stdio:'inherit'});await writeFile('/tmp/proxy.pid',String(proxy.pid));proxy.on('exit',c=>{if(c)process.exit(c);});console.log('PUBLIC_CA '+(await readFile('/tmp/private/lan/ca.pem')).toString('base64'));
 `;
 const run=async args=>(await exec('docker',args,{timeout:30000,maxBuffer:1024*1024})).stdout.trim();
 const id=await run(['run','-d','--read-only','--memory','192m','--tmpfs','/tmp:mode=0700','-p','127.0.0.1::443',image,'node','--input-type=module','-e',program]);t.after(async()=>{await run(['stop','--time','5',id]);await run(['rm','-v',id]);});
 let ca;for(let i=0;i<80;i++){const line=(await run(['logs',id])).split('\n').find(l=>l.startsWith('PUBLIC_CA '));if(line){ca=Buffer.from(line.slice(10),'base64');break;}await new Promise(r=>setTimeout(r,100));}assert.ok(ca,'fixture CA missing');
 const port=Number((await run(['port',id,'443/tcp'])).split(':').at(-1)),publicHostname='v-11111111-1111-4111-8111-111111111111.r.waitron.local';
 const send=(servername,path='/',headers={})=>new Promise((resolve,reject)=>{const req=request({host:'127.0.0.1',port,servername,ca,path,headers:{host:servername,...headers}},res=>{let body='';res.on('data',v=>body+=v);res.on('end',()=>resolve({status:res.statusCode,body}));});req.setTimeout(2000,()=>req.destroy(Error('request timeout')));req.on('error',reject);req.end();});
 let account;for(let i=0;i<40;i++){try{account=await send('waitron.local');break;}catch{}await new Promise(r=>setTimeout(r,100));}assert.equal(account?.status,200,'account SNI listener missing');
 const accountHeaders=JSON.parse(account.body);assert.equal((await send('waitron.local','/',{host:publicHostname})).status,403);assert.equal((await send('waitron.local','/',{origin:'https://evil.example.test'})).status,403);
 let remote;await assert.doesNotReject(async()=>{remote=await send(publicHostname,'/',{'x-waitron-client-ip':'192.0.2.9','x-forwarded-for':'spoof',forwarded:'for=spoof','x-waitron-sni':'spoof'});},'the gateway must accept its trusted front proxy');assert.equal(remote.status,200);const seen=JSON.parse(remote.body);assert.equal(seen['x-waitron-client-ip'],accountHeaders['x-forwarded-for']);assert.notEqual(seen['x-waitron-client-ip'],'192.0.2.9');assert.equal(seen['x-waitron-sni'],publicHostname);assert.equal(seen.forwarded,undefined);assert.equal(seen['x-forwarded-for'],undefined);
 const limits=JSON.parse(await run(['exec',id,'node','--input-type=module','-e',`import{connect}from'node:tls';const held=[];async function open(source){return new Promise(resolve=>{const s=connect({host:'127.0.0.1',port:443,localAddress:source,servername:${JSON.stringify(publicHostname)},rejectUnauthorized:false},()=>{held.push(s);resolve(true);});s.on('error',()=>resolve(false));s.setTimeout(2000,()=>{s.destroy();resolve(false);});});}const distinct=await Promise.all(Array.from({length:40},(_,n)=>open('127.0.1.'+(n+1))));for(const s of held.splice(0))s.destroy();const same=await Promise.all(Array.from({length:33},()=>open('127.0.3.1')));for(const s of held)s.destroy();console.log(JSON.stringify({distinct:distinct.filter(Boolean).length,same:same.filter(Boolean).length}));`]));assert.deepEqual(limits,{distinct:40,same:32},'caller limits must stay separate behind the front proxy');
 async function handshake(servername){return new Promise(resolve=>{let done=false;const finish=value=>{if(done)return;done=true;clearTimeout(timer);socket.destroy();resolve(value);};const socket=tlsConnect({host:'127.0.0.1',port,servername,rejectUnauthorized:false},()=>finish('accepted'));const timer=setTimeout(()=>finish('timeout'),2000);socket.on('error',()=>finish('refused'));});}
 assert.equal(await handshake('unknown.example.test'),'refused');assert.equal(await handshake(''),'refused');
 assert.equal(await handshake('menus.waitron.local'),'refused');
 const direct=JSON.parse(await run(['exec',id,'node','--input-type=module','-e',`import{request}from'node:https';import{readFileSync}from'node:fs';const req=request({host:'127.0.0.1',localAddress:'127.0.0.3',port:4444,servername:${JSON.stringify(publicHostname)},ca:readFileSync('/tmp/private/lan/ca.pem'),headers:{host:${JSON.stringify(publicHostname)}}},r=>{let b='';r.on('data',v=>b+=v);r.on('end',()=>console.log(b));});req.on('error',()=>process.exit(1));req.end();`]));assert.equal(direct['x-waitron-client-ip'],'127.0.0.3');
 const forged=await run(['exec',id,'node','--input-type=module','-e',`import{connect}from'node:net';import{connect as tls}from'node:tls';const s=connect({host:'127.0.0.1',port:4444,localAddress:'127.0.0.3'},()=>{s.write('PROXY TCP4 192.0.2.9 127.0.0.1 12345 443\\r\\n');const c=tls({socket:s,servername:${JSON.stringify(publicHostname)},rejectUnauthorized:false},()=>{console.log('accepted');c.destroy();});c.on('error',()=>{console.log('refused');c.destroy();});});setTimeout(()=>{console.log('timeout');s.destroy();},8000).unref();`]);assert.equal(forged,'refused');
 const workers=async()=>JSON.parse(await run(['exec',id,'node','-e',"const fs=require('fs'),p=fs.readFileSync('/tmp/proxy.pid','utf8');console.log(JSON.stringify(fs.readFileSync('/proc/'+p+'/task/'+p+'/children','utf8').trim().split(/\\s+/).filter(Boolean)))"]));const before=await workers();assert.ok(before.length);
 let began;const started=new Promise(r=>began=r),held=new Promise((resolve,reject)=>{const req=request({host:'127.0.0.1',port,servername:'waitron.local',ca,path:'/held',headers:{host:'waitron.local',connection:'close'}},res=>{let body='';res.on('data',v=>{body+=v;if(body==='before')began();});res.on('end',()=>resolve(body));res.on('error',reject);});req.on('error',reject);req.end();});await started;
 await run(['exec',id,'node','-e',"process.kill(Number(require('fs').readFileSync('/tmp/proxy.pid','utf8')),'SIGUSR2')"]);let after=[];for(let n=0;n<30;n++){after=await workers();if(after.some(pid=>!before.includes(pid)))break;await new Promise(r=>setTimeout(r,100));}assert.ok(after.some(pid=>!before.includes(pid)),'graceful reload did not start a new worker');assert.ok(before.some(pid=>after.includes(pid)),'the held connection lost its old worker');assert.equal((await send('waitron.local','/release')).status,200);assert.equal(await held,'beforeafter');
});


test('account HTTPS starts without a gateway and follows its replacement without shortening remote idle time',{timeout:90000},async t=>{
 const {waitFor}=await import('../../scripts/remote-fixtures.mjs');
 const run=async args=>{const result=await exec('docker',args,{timeout:30000,maxBuffer:1024*1024});return(args[0]==='logs'?result.stdout+result.stderr:result.stdout).trim();},network='cloud-proxy-dns-'+randomUUID(),ids=[];
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');const settings=await mkdtemp(join(tmpdir(),'cloud-proxy-dns-config-'));t.after(()=>rm(settings,{recursive:true,force:true}));await writeFile(join(settings,'resolv.conf'),'nameserver 127.0.0.1\noptions attempts:1 timeout:15\n',{mode:0o600});
 await run(['network','create',network]);t.after(async()=>{for(const id of ids.reverse()){t.diagnostic((await run(['logs',id])).slice(-6000));await run(['rm','-f','-v',id]);}await run(['network','rm',network]);});
 const subnet=await run(['network','inspect',network,'--format','{{(index .IPAM.Config 0).Subnet}}']),base=subnet.split('/')[0].split('.');
 const ip=last=>[...base.slice(0,3),last].join('.');
 const front=`import{bootstrapTestCloud}from'/app/deploy/test-cloud/bootstrap.mjs';import{readFile,writeFile}from'node:fs/promises';import{createServer}from'node:http';import{spawn}from'node:child_process';import{createSocket}from'node:dgram';console.error('fixture: binding private DNS control');await new Promise(r=>createSocket('udp4').bind(53,'127.0.0.1',r));console.error('fixture: preparing private identity');await bootstrapTestCloud('/tmp/private');console.error('fixture: starting account fixture');process.env.TEST_CLOUD_HOST='waitron.local';process.env.TEST_CLOUD_ORIGIN='https://waitron.local';process.env.TEST_CLOUD_CERTIFICATE='/tmp/private/lan/proxy.pem';await new Promise(r=>createServer((q,s)=>s.end('account')).listen(3001,'0.0.0.0',r));await writeFile('/tmp/proxy.cfg',(await readFile('/app/deploy/test-cloud/proxy.cfg','utf8')).replace('account:3000','127.0.0.1:3001'));console.error('fixture: starting HAProxy');const p=spawn('haproxy',['-W','-db','-f','/tmp/proxy.cfg','-f','/app/deploy/test-cloud/proxy.amazon.cfg'],{stdio:'inherit'});p.on('exit',code=>process.exit(code??1));`;
 const frontId=await run(['run','-d','--read-only','--memory','128m','--tmpfs','/tmp:mode=0700','--network',network,'--mount','type=bind,source='+join(settings,'resolv.conf')+',target=/etc/resolv.conf,readonly','-p','127.0.0.1::443',image,'node','--input-type=module','-e',front]);ids.push(frontId);
 const port=Number((await run(['port',frontId,'443/tcp'])).split(':').at(-1));
 await waitFor(async()=> (await run(['logs',frontId])).includes('fixture: starting HAProxy'),30000);
 const send=(name)=>new Promise((resolve,reject)=>{const q=request({host:'127.0.0.1',port,servername:name,rejectUnauthorized:false,signal:AbortSignal.timeout(1000),headers:{host:name}},r=>{let body='';r.on('data',v=>body+=v);r.on('end',()=>resolve({status:r.statusCode,body}));});q.setTimeout(1000,()=>q.destroy(Error('request_timeout')));q.on('error',reject);q.end();});
 async function waitBody(name,body){let actual;try{await waitFor(async()=>{actual=await send(name);return actual.status===200&&actual.body===body;},10000);}catch{assert.deepEqual(actual,{status:200,body},'HTTPS body unavailable: '+body);}}
 await waitBody('waitron.local','account');
 const gateway=body=>`import{bootstrapTestCloud}from'/app/deploy/test-cloud/bootstrap.mjs';import{writeFile}from'node:fs/promises';import{spawn}from'node:child_process';await bootstrapTestCloud('/tmp/private');await writeFile('/tmp/gateway.cfg','global\\n maxconn 100\\ndefaults\\n mode http\\n timeout connect 3s\\n timeout client 60s\\n timeout server 60s\\n timeout http-request 60s\\nfrontend test\\n bind :443 accept-proxy ssl crt /tmp/private/lan/proxy.pem\\n http-request return status 200 content-type text/plain string ${body}\\n');const p=spawn('haproxy',['-W','-db','-f','/tmp/gateway.cfg'],{stdio:'inherit'});p.on('exit',code=>process.exit(code??1));`;
 const start=async(last,body)=>{const id=await run(['run','-d','--read-only','--memory','128m','--tmpfs','/tmp:mode=0700','--network',network,'--network-alias','gateway','--ip',ip(last),image,'node','--input-type=module','-e',gateway(body)]);ids.push(id);return id;};
 const first=await start(11,'first'),name='staff-v-11111111-1111-4111-8111-111111111111.r.waitron.local';await waitBody(name,'first');
 const idle=await new Promise((resolve,reject)=>{const s=tlsConnect({host:'127.0.0.1',port,servername:name,rejectUnauthorized:false},()=>resolve(s));s.on('error',reject);});t.after(()=>idle.destroy());idle.on('error',()=>{});await new Promise(r=>setTimeout(r,16000));assert.equal(idle.destroyed,false,'front proxy shortened the gateway idle window');idle.destroy();
 await run(['rm','-f','-v',first]);ids.splice(ids.indexOf(first),1);await waitBody('waitron.local','account');
 await start(12,'second');await waitBody(name,'second');await waitBody('waitron.local','account');
});

test('the Amazon guest name uses the shared TLS listener, exact authority and a verified private backend',{timeout:45000},async t=>{
 const account='cloud.example.test',guest='menus.'+account;
 const program=`
 import{bootstrapTestCloud}from'/app/deploy/test-cloud/bootstrap.mjs';
 import{readFile,writeFile}from'node:fs/promises';
 import{createServer as http}from'node:http';import{createServer as https}from'node:https';
 import{spawn,execFileSync}from'node:child_process';
 const dir='/tmp/private',lan=dir+'/lan',account=${JSON.stringify(account)},guest=${JSON.stringify(guest)};
 await bootstrapTestCloud(dir);
 const read=name=>readFile(lan+'/'+name),run=args=>execFileSync('openssl',args,{stdio:'ignore'});
 run(['req','-new','-newkey','rsa:2048','-nodes','-keyout','/tmp/public.key','-out','/tmp/public.csr','-subj','/CN='+account]);
 await writeFile('/tmp/public.ext','subjectAltName=DNS:'+account+',DNS:'+guest+'\\nbasicConstraints=critical,CA:FALSE\\n');
 run(['x509','-req','-in','/tmp/public.csr','-CA',lan+'/ca.pem','-CAkey',lan+'/ca-key.pem','-set_serial','123','-out','/tmp/public.crt','-days','1','-extfile','/tmp/public.ext']);
 await writeFile('/tmp/public.pem',Buffer.concat([await readFile('/tmp/public.key'),await readFile('/tmp/public.crt')]));
 let listener;
 const start=async tls=>{
  listener=https(tls,(q,r)=>r.end(JSON.stringify({headers:q.headers,sni:q.socket.servername})));
  await new Promise(resolve=>listener.listen(3443,'127.0.0.2',resolve));
 };
 await start({key:await read('key.pem'),cert:await read('cert.pem')});
 await new Promise(resolve=>http((q,r)=>{
  if(q.url==='/wrong-backend-name')listener.close(async()=>{
   await start({key:await readFile('/tmp/public.key'),cert:await readFile('/tmp/public.crt')});r.end('replaced');
  });else r.end('account');
 }).listen(3001,'127.0.0.1',resolve));
 process.env.TEST_CLOUD_HOST=account;process.env.TEST_CLOUD_ORIGIN='https://'+account;
 process.env.TEST_CLOUD_GUEST_HOST=guest;process.env.TEST_CLOUD_CERTIFICATE='/tmp/public.pem';process.env.TEST_CLOUD_GUEST_CA=lan+'/ca.pem';
 for(const [name,from,to] of [['proxy','account:3000','127.0.0.1:3001'],['proxy.amazon','10.79.0.3:3443','127.0.0.2:3443']]){
  const cfg=await readFile('/app/deploy/test-cloud/'+name+'.cfg','utf8');
  await writeFile('/tmp/'+name+'.cfg',cfg.replace(from,to));
 }
 const proxy=spawn('haproxy',['-W','-db','-f','/tmp/proxy.cfg','-f','/tmp/proxy.amazon.cfg'],{stdio:'inherit'});
 proxy.on('exit',code=>process.exit(code??1));
 console.log('PUBLIC_CA '+(await read('ca.pem')).toString('base64'));
 `;
 const run=async args=>(await exec('docker',args,{timeout:30000,maxBuffer:1024*1024})).stdout.trim();
 const id=await run(['run','-d','--read-only','--memory','128m','--tmpfs','/tmp:mode=0700','-p','127.0.0.1::443',image,'node','--input-type=module','-e',program]);
 t.after(async()=>{await run(['rm','-f','-v',id]);});
 let ca;
 for(let n=0;n<100;n++){
  const line=(await run(['logs',id])).split('\n').find(line=>line.startsWith('PUBLIC_CA '));
  if(line){ca=Buffer.from(line.slice(10),'base64');break;}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(ca,'public CA missing');
 const port=Number((await run(['port',id,'443/tcp'])).split(':').at(-1));
 const send=(servername,host=servername,path='/',headers={})=>new Promise((resolve,reject)=>{
  const req=request({host:'127.0.0.1',port,servername,ca,path,headers:{host,...headers}},res=>{
   let body='';res.on('data',bytes=>body+=bytes);res.on('end',()=>resolve({status:res.statusCode,body}));
  });req.setTimeout(2000,()=>req.destroy(Error('request timeout')));req.on('error',reject);req.end();
 });
 let ready;
 for(let n=0;n<30;n++){
  try{ready=await send(account);break;}catch{}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.deepEqual(ready,{status:200,body:'account'});
 const response=await send(guest,guest,'/',{'x-forwarded-for':'192.0.2.99',forwarded:'for=spoof','x-real-ip':'192.0.2.99'});
 assert.equal(response.status,200);
 const seen=JSON.parse(response.body);
 assert.equal(seen.sni,'waitron.local');assert.equal(seen.headers.host,guest);
 assert.match(seen.headers['x-forwarded-for'],/^\d+\.\d+\.\d+\.\d+$/);
 assert.notEqual(seen.headers['x-forwarded-for'],'192.0.2.99');
 assert.equal(seen.headers.forwarded,undefined);assert.equal(seen.headers['x-real-ip'],undefined);
 assert.equal((await send(account,guest)).status,403);
 assert.equal((await send(guest,account)).status,403);
 assert.equal((await send(account,account,'/wrong-backend-name')).body,'replaced');
 assert.equal((await send(guest)).status,503);
});

// Run the real provider and proxy in the same disposable network namespace.
async function proveAmazonUpload(){
 const {default:assert}=await import('node:assert/strict');
 const {startBackupStorage}=await import('./scripts/backup-storage-fixture.mjs');
 const {bootstrapTestCloud}=await import('./deploy/test-cloud/bootstrap.mjs');
 const {createRequire}=await import('node:module');
 const {readFile,writeFile}=await import('node:fs/promises');
 const {spawn}=await import('node:child_process');
 const {once}=await import('node:events');
 const {Agent,request}=await import('node:https');
 const {createServer}=await import('node:http');
 const {setTimeout:delay}=await import('node:timers/promises');
 const {S3Client,PutObjectCommand}=createRequire(process.cwd()+'/packages/backups/package.json')('@aws-sdk/client-s3');
 await bootstrapTestCloud('/tmp/private');
 const storage=await startBackupStorage({tokenDuration:'8s',tlsHostname:'waitron.local'});
 const account=createServer((q,r)=>{r.writeHead(q.url==='/ready'?200:404);r.end();});
 await new Promise(resolve=>account.listen(3001,'127.0.0.1',resolve));
 const ca=await readFile('/tmp/private/lan/ca.pem');
 const agent=new Agent({ca,lookup(_host,options,callback){
  if(options.all)callback(null,[{address:'127.0.0.1',family:4}]);else callback(null,'127.0.0.1',4);
 }});
 const host='waitron.local',endpoint='https://'+host;
 const bucket='venue-11111111-1111-4111-8111-111111111111',key='incoming/22222222-2222-4222-8222-222222222222';
 const path='/'+bucket+'/'+key,body=Buffer.from('synthetic backup bytes');
 const send=(method,path,headers={})=>new Promise((resolve,reject)=>{
  const req=request(endpoint+path,{agent,servername:host,method,headers,signal:AbortSignal.timeout(2000)},res=>{res.resume();res.once('end',()=>resolve(res.statusCode));});
  req.once('error',error=>reject(new Error(method+' '+path+' ('+String(req.getHeader('host'))+', Length '+String(req.getHeader('content-length'))+') failed: '+error.code,{cause:error})));
  req.end(headers['content-length']===1?'x':undefined);
 });
 const readConfig=name=>readFile('deploy/test-cloud/'+name+'.cfg','utf8');
 await writeFile('/tmp/proxy.cfg',(await readConfig('proxy')).replace('account:3000','127.0.0.1:3001'));
 await writeFile('/tmp/amazon.cfg',(await readConfig('proxy.amazon')).replace('storage:8333',new URL(storage.endpoint).host));
 await writeFile('/tmp/storage-ca.pem',storage.ca);
 const start=async enabled=>{
  const env={...process.env,TEST_CLOUD_HOST:host,TEST_CLOUD_ORIGIN:endpoint,TEST_CLOUD_CERTIFICATE:'/tmp/private/lan/proxy.pem'};
  if(enabled)Object.assign(env,{TEST_CLOUD_STORAGE_CA:'/tmp/storage-ca.pem',
   TEST_CLOUD_GUEST_HOST:'menus.waitron.local',TEST_CLOUD_GUEST_CA:'/tmp/private/lan/ca.pem'});
  const child=spawn('haproxy',['-W','-db','-f','/tmp/proxy.cfg','-f','/tmp/amazon.cfg'],{env,stdio:'inherit'});
  const exited=once(child,'exit');
  try{
   for(let n=0;n<30;n++){
    if(child.exitCode!==null)break;
    if(await send('GET','/ready').catch(()=>null)===200)return async()=>{child.kill();await exited;};
    await delay(100);
   }
   throw Error('Amazon test proxy never became ready');
  }catch(error){if(child.exitCode===null)child.kill();await exited;throw error;}
 };
 let stop;
 try{
  stop=await start(true);
  const location=await storage.bucket(bucket);
  const grant=await storage.authority.grant(location,{kind:'capture',bucket,scope:key},storage.ca);
  const put=async credentials=>{
   const client=new S3Client({endpoint,region:'local',credentials,forcePathStyle:true,maxAttempts:1,requestChecksumCalculation:'WHEN_REQUIRED',requestHandler:{httpsAgent:agent}});
   try{return (await client.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:body,ContentLength:body.length}),{abortSignal:AbortSignal.timeout(3000)})).$metadata.httpStatusCode;}
   catch(error){if(error.$metadata?.httpStatusCode)return error.$metadata.httpStatusCode;throw error;}
   finally{client.destroy();}
  };
  assert.equal(await put(grant.credentials),200,'signed PUT reaches the real storage provider');
  for(const [method,url,headers,status] of [
   ['PUT',path,{'content-length':0},400],['PUT',path,{'content-length':536870913},413],
   ['PUT',path,{'content-length':1,'x-amz-copy-source':'/private/key'},403],
   ['PUT',path+'?uploads',{'content-length':1},403],['PUT','/'+bucket+'/snapshots/'+key.split('/')[1],{'content-length':1},403],
   ['GET',path,{},403],['DELETE',path,{},403],['PUT',path,{'content-length':1,host:'other.example.test'},403]
  ])assert.equal(await send(method,url,headers),status,method+' '+url);
  assert.equal(await send('PUT',path,{'content-length':1}),403,'unsigned PUT');
  assert.equal(await put({...grant.credentials,secretAccessKey:'incorrect-test-signing-key'}),403,'incorrect signature');
  await delay(Math.max(0,Date.parse(grant.expiresAt)-Date.now()+1100));
  assert.equal(await put(grant.credentials),403,'expired storage grant');
  await stop();stop=await start(false);
  assert.equal(await put(grant.credentials),404,'the ordinary proxy leaves the storage path closed');
 }finally{await stop?.();account.closeAllConnections();await new Promise(resolve=>account.close(resolve));await storage.stop();agent.destroy();}
}

test('Amazon backup proxy accepts only a bounded signed PUT to the reserved object',{timeout:180000},async()=>{
 const {fileURLToPath}=await import('node:url');
 const source=fileURLToPath(new URL('../../',import.meta.url));
 const result=await exec('docker',['run','--rm','--memory','512m','--mount','type=bind,source='+source+',target=/workspace,readonly',
  '-w','/workspace',image,'node','--input-type=module','-e','await ('+proveAmazonUpload.toString()+')()'],{timeout:150000,maxBuffer:1024*1024}).catch(error=>assert.fail(error.stderr||error.message));
 assert.doesNotMatch(result.stderr,/http-request.*placed after.*use_backend/);
 for(const line of result.stdout.split('\n').filter(Boolean))console.log(line);
});
