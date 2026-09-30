import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {createServer,request} from 'node:http';
import {createServer as createTlsServer} from 'node:https';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createPublicGate} from '../packages/remote-access/src/public-gate.ts';

export function solveProof(challenge,difficulty){
 for(let nonce=0;nonce<1e9;nonce++)if(createHash('sha256').update(`${challenge}:${nonce}`).digest().readUInt32BE(0)<2**(32-difficulty))return {challenge,nonce};
 throw Error('proof nonce bound exceeded');
}
export async function accessCookie(send,host){
 const challenge=await send(host,'/_cloud/challenge');assert.equal(challenge.status,200);
 const proof=JSON.parse(challenge.text);
 const answer=await send(host,'/_cloud/solve',{body:solveProof(proof.challenge,proof.difficulty)});assert.equal(answer.status,204);
 return answer.headers['set-cookie'][0].split(';')[0];
}
export async function sample(name,calls){
 const rows=await Promise.all(calls.map(async call=>{const start=performance.now();try{const r=await call();return {status:String(r.status),ms:performance.now()-start};}catch(error){return {status:'transport',ms:performance.now()-start};}}));
 const statuses={};for(const row of rows)statuses[row.status]=(statuses[row.status]??0)+1;
 const times=rows.map(row=>row.ms).sort((a,b)=>a-b);
 return {name,requests:rows.length,statuses,latencyMs:{min:times[0],p50:times[Math.ceil(times.length*.5)-1],p95:times[Math.ceil(times.length*.95)-1],max:times.at(-1)}};
}
function expect(phase,status,count){assert.deepEqual(phase.statuses,{[status]:count},phase.name);return phase;}
const calls=(count,fn)=>Array.from({length:count},(_,i)=>()=>fn(i));

// The real gateway supplies overwritten IP/SNI headers; this companion isolates the gate's own limits.
export async function measureControlledGate(){
 const root=await mkdtemp(join(tmpdir(),'cloud-public-limits-')),servers=[],pending=new Set(),observed=[],phases=[];
 let now=Date.now(),hold=false,broken=false,gate,receipt;
 const hosts=['sol.example.test','luna.example.test'];
 try{
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=staff.sol.example.test','-addext','subjectAltName=DNS:staff.sol.example.test,DNS:staff.luna.example.test','-keyout',join(root,'key.pem'),'-out',join(root,'cert.pem')],{stdio:'ignore'});
  const key=await readFile(join(root,'key.pem')),cert=await readFile(join(root,'cert.pem')),routes=[];
  async function listen(server){servers.push(server);await new Promise(r=>server.listen(0,'127.0.0.1',r));return server.address().port;}
  for(const [index,host]of hosts.entries()){
   const port=await listen(createTlsServer({key,cert},(req,res)=>{
    observed.push({index,path:req.url,headers:req.headers});
    const finish=()=>{pending.delete(finish);res.setHeader('Set-Cookie','management_session=must-not-escape');res.statusCode=index===0&&broken?503:200;res.end(JSON.stringify({venue:host}));};
    if(index===0&&hold){pending.add(finish);res.once('close',()=>pending.delete(finish));}else finish();
   }));routes.push({publicHostname:host,staffHostname:'staff.'+host,address:'127.0.0.1',port});
  }
  gate=createPublicGate({key:randomBytes(32),ca:cert,now:()=>now,routes:()=>routes});
  const port=await listen(createServer(gate.handle));
  const send=(host,path='/public/availability',options={})=>new Promise((resolve,reject)=>{
   const body=options.body===undefined?undefined:JSON.stringify(options.body);
   const req=request({host:'127.0.0.1',port,agent:false,path,method:body?'POST':'GET',headers:{host,'x-waitron-sni':host,'x-waitron-client-ip':options.ip??'192.0.2.1',...options.headers}},res=>{let text='';res.on('data',v=>text+=v);res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text}));});req.on('error',reject);req.setTimeout(8000,()=>req.destroy(Error('fixture request timeout')));req.end(body);
  });
  const a=hosts[0],b=hosts[1],cookies=await Promise.all(hosts.map(host=>accessCookie(send,host))),withCookie=i=>({headers:{cookie:cookies[i]}});
  phases.push(expect(await sample('unsolved',calls(8,i=>send(hosts[i%2]))),403,8));assert.equal(observed.length,0);
  phases.push(expect(await sample('solved-two-venues',calls(16,i=>send(hosts[i%2],undefined,withCookie(i%2)))),200,16));
  assert.equal(observed.filter(r=>r.index===0).length,8);assert.equal(observed.filter(r=>r.index===1).length,8);
  const before=observed.length;
  phases.push(expect(await sample('cross-host-cookie',[()=>send(b,undefined,withCookie(0))]),403,1));
  phases.push(expect(await sample('cross-ip-cookie',[()=>send(a,undefined,{...withCookie(0),ip:'192.0.2.2'})]),403,1));
  phases.push(expect(await sample('staff-paths',hosts.flatMap((host,i)=>['/management-api/session','/management-api/cloud/status'].map(path=>()=>send(host,path,withCookie(i))))),404,4));
  assert.equal(observed.length,before);
  for(let i=0;i<2;i++){
   const reply=await send(hosts[i],undefined,{headers:{cookie:cookies[i]+'; management_session=staff-secret',authorization:'Bearer staff-secret',forwarded:'for=staff','x-forwarded-for':'staff','x-forwarded-host':'staff','x-waitron-role':'manager'}});
   assert.equal(reply.status,200);assert.equal(reply.headers['set-cookie'],undefined);assert.equal(JSON.parse(reply.text).venue,hosts[i]);
   assert.deepEqual(Object.keys(observed.at(-1).headers).sort(),['accept','connection','host']);assert.equal(observed.at(-1).headers.host,'staff.'+hosts[i]);
  }
  now+=60001;
  phases.push(expect(await sample('shared-ip-budget-a',calls(120,()=>send(a,'/_cloud/challenge'))),200,120));
  phases.push(expect(await sample('shared-ip-budget-b',[()=>send(b,undefined,withCookie(1))]),429,1));
  phases.push(expect(await sample('different-ip-unaffected',[()=>send(b,'/_cloud/challenge',{ip:'192.0.2.2'})]),200,1));
  now+=60001;
  // Hold exactly 64 accepted upstream requests; inspect the other venue before releasing any.
  hold=true;const held=sample('held-a',calls(64,()=>send(a,undefined,withCookie(0))));
  const deadline=Date.now()+4500;while(pending.size<64&&Date.now()<deadline)await delay(10);
  assert.equal(pending.size,64);assert.equal(gate.stats().active,64);
  phases.push(expect(await sample('shared-concurrency-b',[()=>send(b,undefined,withCookie(1))]),429,1));
  hold=false;for(const finish of [...pending])finish();phases.push(expect(await held,200,64));
  phases.push(expect(await sample('after-release-b',[()=>send(b,undefined,withCookie(1))]),200,1));assert.equal(gate.stats().active,0);
  broken=true;
  phases.push(expect(await sample('upstream-failure-a',calls(4,()=>send(a,undefined,withCookie(0)))),503,4));
  phases.push(expect(await sample('upstream-failure-b',calls(4,()=>send(b,undefined,withCookie(1)))),200,4));assert.equal(gate.stats().active,0);broken=false;
  const challenge=JSON.parse((await send(a,'/_cloud/challenge')).text);now+=120001;
  phases.push(expect(await sample('expired-challenge',[()=>send(a,'/_cloud/solve',{body:solveProof(challenge.challenge,challenge.difficulty)})]),403,1));
  now+=180001;const count=observed.length;
  phases.push(expect(await sample('expired-access',hosts.map((host,i)=>()=>send(host,undefined,withCookie(i)))),403,2));assert.equal(observed.length,count);
  const renewed=await accessCookie(send,b);phases.push(expect(await sample('renewed-access',[()=>send(b,undefined,{headers:{cookie:renewed}})]),200,1));
  receipt={phases,clock:'injected; real sockets and default policy',peakActive:64,finalActive:gate.stats().active,upstreamRequests:observed.length,credentialsStripped:true,rejectedRequestsNotForwarded:true,venueBodiesMatched:true};
 }finally{
  for(const finish of [...pending])finish();
  for(const server of servers)server.closeAllConnections();
  await Promise.all(servers.map(server=>new Promise(resolve=>server.close(resolve))));await rm(root,{recursive:true,force:true});
 }
 assert.equal(servers.every(server=>!server.listening),true);await assert.rejects(access(root),{code:'ENOENT'});
 receipt.cleanup={listeners:0,temporaryDirectories:0};return receipt;
}

export async function measureGatewayTraffic({hosts,send,failA,recoverA}){
 const phases=[];let attempts=0;const counted=(...args)=>{attempts++;return send(...args);};
 const cookies=await Promise.all(hosts.map(host=>accessCookie(counted,host))),options=i=>({headers:{cookie:cookies[i]}});
 phases.push(expect(await sample('unsolved',calls(8,i=>counted(hosts[i%2]))),403,8));
 for(let i=0;i<2;i++)phases.push(expect(await sample('solved-'+i,calls(8,()=>counted(hosts[i],undefined,options(i)))),200,8));
 phases.push(expect(await sample('cross-host-cookie',[()=>counted(hosts[1],undefined,options(0))]),403,1));
 phases.push(expect(await sample('staff-paths',hosts.map((host,i)=>()=>counted(host,'/management-api/session',options(i)))),404,2));
 phases.push(expect(await sample('spoofed-sni',[()=>counted(hosts[0],undefined,{headers:{host:hosts[1],'x-waitron-sni':hosts[1],'x-waitron-client-ip':'192.0.2.99'}})]),421,1));
 await failA();
 try{
  const [a,b]=await Promise.all([sample('failed-upstream-a',[()=>counted(hosts[0],undefined,options(0))]),sample('failed-upstream-b',calls(4,()=>counted(hosts[1],undefined,options(1))))]);
  phases.push(expect(a,503,1),expect(b,200,4));
 }finally{await recoverA();}
 phases.push(expect(await sample('recovered-a',[()=>counted(hosts[0],undefined,options(0))]),200,1));
 // A mismatched Host/SNI is refused before accounting. Every other call consumes this source's quota.
 const remaining=120-(attempts-1);assert.ok(remaining>0);
 for(let offset=0;offset<remaining;offset+=8)phases.push(expect(await sample('budget-fill-'+offset,calls(Math.min(8,remaining-offset),()=>counted(hosts[0],'/_cloud/challenge'))),200,Math.min(8,remaining-offset)));
 phases.push(expect(await sample('shared-budget-b',[()=>counted(hosts[1],undefined,options(1))]),429,1));
 return {phases,accountedBeforeRefusal:120,sharedSource:true,failedVenueDidNotBlockOther:true};
}
