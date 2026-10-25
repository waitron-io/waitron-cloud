import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {createServer as httpsServer} from 'node:https';
import {createServer as netServer} from 'node:net';
import type {Socket} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';

test('failed probes release sockets and let their process exit while peers stay open',async t=>{
 const root=await mkdtemp(join(tmpdir(),'cloud-probe-failure-pki-'));
 try{
  const key=join(root,'key.pem'),cert=join(root,'cert.pem');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','2','-subj','/CN=probe.example.test','-addext','subjectAltName=DNS:probe.example.test','-keyout',key,'-out',cert],{stdio:'ignore'});
  const material={key:await readFile(key),cert:await readFile(cert)};
  for(const failure of ['cancelled','timeout'] as const)for(const stage of ['before headers','during body'] as const)await t.test(`${failure} ${stage}`,async()=>{
   const sockets=new Set<Socket>();let staffEntered=false,publicEntered=false,cancelSent=false;
   let child:ReturnType<typeof spawn>|undefined;
   const cancelWhenReady=()=>{
    if(failure==='cancelled'&&staffEntered&&publicEntered&&!cancelSent){cancelSent=true;child!.send!('cancel');}
   };
   const staff=netServer({allowHalfOpen:true},socket=>{
    socket.on('error',()=>{});
    socket.on('data',()=>{staffEntered=true;cancelWhenReady();});
   });
   const publicServer=httpsServer({...material,allowHalfOpen:true},(req,res)=>{
    assert.equal(req.url,'/public/availability');
    if(stage==='during body'){res.setHeader('content-type','application/json');res.write('{');}
    publicEntered=true;cancelWhenReady();
   });
   for(const server of [staff,publicServer])server.on('connection',socket=>{
    sockets.add(socket);socket.once('close',()=>sockets.delete(socket));socket.on('error',()=>{});
   });
   const source=`
    import {probeTarget} from ${JSON.stringify(new URL('../src/probe.ts',import.meta.url).href)};
    const {staffPort,publicPort,ca}=JSON.parse(process.argv[1]);
    const stop=new AbortController();process.once('message',()=>stop.abort());
    const target={installationId:'10000000-0000-4000-8000-000000000001',venueId:'20000000-0000-4000-8000-000000000002',revision:7,staffHostname:'staff.probe.example.test',publicHostname:'probe.example.test'};
    const value=await probeTarget(target,{ca,signal:stop.signal,connect:hostname=>({address:'127.0.0.1',family:4,port:hostname.startsWith('staff.')?staffPort:publicPort})});
    process.removeAllListeners('message');process.disconnect();console.log(JSON.stringify(value));
   `;
   let watchdog:ReturnType<typeof setTimeout>|undefined,finishTimer:ReturnType<typeof setTimeout>|undefined;
   let exited:Promise<{code:number|null;signal:NodeJS.Signals|null}>|undefined;
   try{
    await new Promise<void>(resolve=>staff.listen(0,'127.0.0.1',resolve));
    await new Promise<void>(resolve=>publicServer.listen(0,'127.0.0.1',resolve));
    const staffAddress=staff.address(),publicAddress=publicServer.address();
    assert(staffAddress&&typeof staffAddress!=='string');assert(publicAddress&&typeof publicAddress!=='string');
    child=spawn(process.execPath,['--input-type=module','--eval',source,JSON.stringify({staffPort:staffAddress.port,publicPort:publicAddress.port,ca:material.cert.toString()})],{stdio:['ignore','pipe','pipe','ipc']});
    const processChild=child;let output='',errors='',forced=false;
    exited=new Promise((resolve,reject)=>{processChild.once('error',reject);processChild.once('close',(code,signal)=>resolve({code,signal}));});
    watchdog=setTimeout(()=>{forced=true;processChild.kill('SIGKILL');},8000);
    processChild.stdout!.on('data',chunk=>{
     output+=chunk;
     if(output.includes('\n')&&!finishTimer)finishTimer=setTimeout(()=>{forced=true;processChild.kill('SIGKILL');},1000);
    });
    processChild.stderr!.on('data',chunk=>{errors+=chunk;});
    const exit=await exited;
    assert(staffEntered,'The staff connection must reach its unfinished TLS handshake');
    assert(publicEntered,'The public request must reach the selected unfinished response');
    assert.equal(cancelSent,failure==='cancelled');
    assert.equal(forced,false,'The failed probes must release sockets without a peer close or forced process exit; '+errors);
    assert.deepEqual(exit,{code:0,signal:null},errors);
    const value=JSON.parse(output);
    for(const service of [value.public,value.staff]){
     assert.equal(service.status,'failed');assert.equal(service.failure,failure);
     assert.doesNotMatch(JSON.stringify(service),/127\.0\.0\.1|ECONN|certificate|socket/i);
    }
   }finally{
    clearTimeout(watchdog);clearTimeout(finishTimer);
    if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
    if(exited)await exited;
    for(const socket of sockets)socket.destroy();
    await Promise.all([staff,publicServer].map(server=>new Promise<void>(resolve=>server.close(()=>resolve()))));
   }
  });
 }finally{await rm(root,{recursive:true,force:true});}
});
