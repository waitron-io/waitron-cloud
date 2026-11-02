import assert from 'node:assert/strict';
import {chmod,mkdtemp,realpath,rm,unlink} from 'node:fs/promises';
import {createServer,type Socket} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
const api=await import(new URL('../src/traffic-quiescence.ts',import.meta.url).href).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return undefined;});
const unavailable=/^Error: traffic_quiescence_unavailable$/;
const header='# pxname,svname,scur,qcur,status,type,bin,bout\n';
const rows=[['ingress','FRONTEND','0','','PAUSED','0','23','23'],['public_https','FRONTEND','0','','PAUSED','0','0','0'],['user','BACKEND','0','0','UP','1','23','23']];
const csv=(change?:(rows:string[][])=>void)=>{const copy=structuredClone(rows);change?.(copy);return header+copy.map(r=>r.join(',')).join('\n')+'\n';};
async function fixture(t:{after:(fn:()=>Promise<void>)=>void},reply:(n:number,s:Socket)=>string|undefined){
 const root=await realpath(await mkdtemp(join(tmpdir(),'tq-'))),path=join(root,'stats.sock'),clients=new Set<Socket>();let paused=false,reads=0,commands:string[]=[];
 const server=createServer(s=>{clients.add(s);s.once('close',()=>clients.delete(s));let buffer='';s.on('data',bytes=>{
  buffer+=bytes;for(;;){const i=buffer.indexOf('\n');if(i<0)break;const command=buffer.slice(0,i);buffer=buffer.slice(i+1);commands.push(command);
   if(command==='prompt'){s.write('\n> ');continue;}assert.equal(command,'show stat');assert.equal(paused,true,'pause must follow the interactive handshake and precede the snapshot');
   const value=reply(++reads,s);if(value!==undefined)s.write(value+'\n> ');
  }
 });});
 await new Promise<void>(r=>server.listen(path,r));await chmod(path,0o600);
 t.after(async()=>{for(const s of clients)s.destroy();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});});
 return {path,root,commands,clients,read:async(pause:()=>boolean=()=>true)=>{assert.equal(typeof api?.readQuiescentTrafficSocket,'function','quiescent snapshot reader must exist');return api!.readQuiescentTrafficSocket(path,()=>{const result=pause();paused=result;return result;});}};
}
// Skipping pause confirmation, accepting active sessions, or changing the final snapshot must fail these checks.
test('quiescence retains the exact final snapshot on the connection opened before pause',async t=>{
 const f=await fixture(t,()=>csv());assert.equal(await f.read(),csv());assert.deepEqual(f.commands,['prompt','show stat']);
});
test('active paused sessions drain before final counters are returned',async t=>{
 const first=csv(r=>{r[0]![2]='1';r[2]![2]='1';r[2]![6]='12';});const f=await fixture(t,n=>n===1?first:csv());
 assert.equal(await f.read(),csv());assert.deepEqual(f.commands,['prompt','show stat','show stat']);
});
test('open listeners must report paused before a zero-session snapshot can close',async t=>{
 const f=await fixture(t,n=>n===1?csv(r=>{r[0]![4]='OPEN';}):csv());assert.equal(await f.read(),csv());assert.equal(f.commands.length,3);
});
for(const [name,change] of [
 ['missing public frontend',(r:string[][])=>{r.splice(1,1);}],
 ['duplicate frontend',(r:string[][])=>{r.push([...r[0]!]);}],
 ['unexpected listening frontend',(r:string[][])=>{r.push(['foreign','FRONTEND','0','','PAUSED','0','0','0']);}],
 ['unrecognized replacement frontend',(r:string[][])=>{r[1]![0]='foreign';}],
 ['malformed active sessions',(r:string[][])=>{r[0]![2]='-1';}],
 ['unsafe active sessions',(r:string[][])=>{r[0]![2]='4294967296';}],
 ['wrong frontend type',(r:string[][])=>{r[0]![5]='1';}],
 ['wrong backend type',(r:string[][])=>{r[2]![5]='0';}],
 ['missing backend',(r:string[][])=>{r.pop();}],
 ['malformed queued sessions',(r:string[][])=>{r[2]![3]='';}],
 ['truncated row',(r:string[][])=>{r[2]!.pop();}],
] as const)test(`quiescence refuses ${name}`,async t=>{const f=await fixture(t,()=>csv(change));await assert.rejects(f.read(),unavailable);});
test('queued backend work cannot close even when frontend sessions are zero',async t=>{
 const f=await fixture(t,n=>n===1?csv(r=>{r[2]![3]='1';}):csv());assert.equal(await f.read(),csv());assert.equal(f.commands.length,3);
});
test('failed captured-handle pause refuses before requesting counters',async t=>{
 const f=await fixture(t,()=>csv());await assert.rejects(f.read(()=>false),unavailable);assert.deepEqual(f.commands,['prompt']);
});
test('duplicate header fields refuse closure',async t=>{
 const f=await fixture(t,()=>csv().replace(',bin,bout',',bin,bin'));await assert.rejects(f.read(),unavailable);
});
test('oversized counter response refuses without waiting for a prompt',async t=>{
 const f=await fixture(t,(_n,s)=>{s.write('x'.repeat(1048577));return undefined;});const started=performance.now();await assert.rejects(f.read(),unavailable);assert.ok(performance.now()-started<1500,'oversize must disconnect before the general drain deadline');
});
test('invalid UTF-8 refuses instead of decoding a different snapshot',async t=>{
 const f=await fixture(t,(_n,s)=>{s.write(Buffer.from([0xff,10,62,32]));return undefined;});await assert.rejects(f.read(),unavailable);
});
test('unexpected socket end cannot close a lifetime',async t=>{
 const f=await fixture(t,(_n,s)=>{s.end(csv());return undefined;});await assert.rejects(f.read(),unavailable);
});
test('a non-private stats socket refuses before the pause callback',async t=>{
 const f=await fixture(t,()=>csv());await chmod(f.path,0o666);let called=false;await assert.rejects(f.read(()=>{called=true;return true;}),unavailable);assert.equal(called,false);
});
test('a replaced stats socket refuses even with a valid old connected reply',async t=>{
 const f=await fixture(t,()=>undefined);let paused=false;
 const result=f.read(()=>{paused=true;void unlink(f.path).then(async()=>{const replacement=createServer();await new Promise<void>(r=>replacement.listen(f.path,r));await chmod(f.path,0o600);t.after(async()=>{await new Promise<void>(r=>replacement.close(()=>r()));});for(const s of f.clients)s.write(csv()+'\n> ');});return true;});
 await assert.rejects(result,unavailable);assert.equal(paused,true);
});
test('silent paused children refuse within the bounded drain deadline',async t=>{
 const f=await fixture(t,()=>undefined);const start=performance.now();await assert.rejects(f.read(),unavailable);assert.ok(performance.now()-start<6500);
});
test('a full UNIX accept queue cannot outlive the drain deadline',async t=>{
 const {spawn}=await import('node:child_process');const {connect}=await import('node:net');const {readFile}=await import('node:fs/promises');const {setTimeout:delay}=await import('node:timers/promises');
 const root=await realpath(await mkdtemp(join(tmpdir(),'tqb-'))),path=join(root,'stats.sock'),ready=join(root,'ready');
 const code="const {createServer}=require('node:net'),{chmodSync,writeFileSync}=require('node:fs');createServer().listen(process.argv[1],1,()=>{chmodSync(process.argv[1],0o600);writeFileSync(process.argv[2],'ready');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);});";
 const child=spawn(process.execPath,['-e',code,path,ready],{stdio:'ignore'}),exited=new Promise<void>(r=>child.once('exit',()=>r())),fillers:Socket[]=[];t.diagnostic(`owned backlog fixture PID ${child.pid}`);
 t.after(async()=>{for(const c of fillers)c.destroy();child.kill('SIGKILL');await exited;await rm(root,{recursive:true,force:true});});
 const end=Date.now()+4000;for(;;){try{await readFile(ready);break;}catch(e){if(Date.now()>end)throw e;await delay(5);}}
 for(let i=0;i<16;i++){const c=connect(path);c.on('error',()=>{});fillers.push(c);}await delay(100);
 assert.equal(typeof api?.readQuiescentTrafficSocket,'function');
 const result=api!.readQuiescentTrafficSocket(path,()=>true).then(()=> 'snapshot',()=> 'refused');assert.equal(await Promise.race([result,delay(6000).then(()=> 'still pending')]),'refused');
});
for(const [name,row] of [['frontend',0],['backend',2]] as const)test(`a lone active ${name} session prevents final closure`,async t=>{
 const f=await fixture(t,n=>n===1?csv(r=>{r[row]![2]='1';}):csv());assert.equal(await f.read(),csv());assert.equal(f.commands.length,3);
});
