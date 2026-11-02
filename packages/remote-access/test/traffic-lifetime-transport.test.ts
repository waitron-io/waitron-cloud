import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomUUID} from 'node:crypto';
import {chmod,lstat,mkdir,mkdtemp,readFile,realpath,rename,rm,symlink,writeFile} from 'node:fs/promises';
import {createServer,connect,type Socket} from 'node:net';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {signTrafficLifecycle,type TrafficLifecycle} from '../src/traffic-lifecycle.ts';
import {signManifest,type ReportingGatewayManifest,type ManifestEnvelope} from '../src/manifest.ts';
import {TrafficChildJournal} from '../src/traffic-child-journal.ts';
import type {TrafficMapping} from '../src/traffic-coverage.ts';

const api=await import(new URL('../src/traffic-lifetime-transport.ts',import.meta.url).href).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;return undefined;});
const unavailable=/^Error: traffic_lifetime_transport_unavailable$/;
async function fixture(t:{after:(f:()=>Promise<void>)=>void}){
 const root=await realpath(await mkdtemp(join(tmpdir(),'lt-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const socket=join(root,'country.sock'),keys=generateKeyPairSync('ed25519'),cellId=randomUUID();
 const mapping:TrafficMapping={country:'ES',environment:'test',cellId,directory:join(root,'reports'),writerUid:process.geteuid!(),readerGid:process.getegid!()};
 const start:TrafficLifecycle={version:1,audience:'waitron-cloud-remote-traffic-lifecycle',kind:'start',cellId,gatewayId:randomUUID(),generation:1,processId:randomUUID(),
  manifestDigest:'a'.repeat(64),startedAt:'2026-11-02T00:00:00.000Z',predecessorId:null,endedAt:null,finalSequence:null};
 const envelope=signTrafficLifecycle(start,keys.privateKey),received:{mapping:TrafficMapping;envelope:unknown}[]=[];
 const store={async recordLifecycle(m:TrafficMapping,e:unknown){received.push({mapping:m,envelope:e});}};
 const serve=async(change:Record<string,unknown>={})=>{
  assert.equal(typeof api?.serveTrafficLifetimes,'function','private country lifetime server must exist');
  const server=await api!.serveTrafficLifetimes({socket,mappings:[mapping],store,...change});t.after(()=>server.close());return server;
 };
 const send=(e:ManifestEnvelope=envelope,path=socket)=>{
  assert.equal(typeof api?.sendTrafficLifetime,'function','private lifetime sender must exist');return api!.sendTrafficLifetime(path,e);
 };
 return {root,socket,keys,mapping,start,envelope,received,store,serve,send};
}
function held(){let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};}
async function raw(path:string,bytes:Buffer|string):Promise<string>{
 return new Promise((resolve,reject)=>{const socket=connect(path),chunks:Buffer[]=[];socket.once('connect',()=>socket.end(bytes));socket.on('data',b=>chunks.push(b));socket.once('end',()=>resolve(Buffer.concat(chunks).toString()));socket.once('error',reject);});
}
async function fake(t:{after:(f:()=>Promise<void>)=>void},path:string,reply:(socket:Socket)=>void){
 const server=createServer({allowHalfOpen:true},socket=>{socket.on('error',()=>{});socket.once('data',()=>reply(socket));});
 const connections=new Set<Socket>();server.on('connection',s=>{connections.add(s);s.once('close',()=>connections.delete(s));});
 await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(path,resolve);});await chmod(path,0o600);
 t.after(async()=>{for(const s of connections)s.destroy();await new Promise<void>(r=>server.close(()=>r()));});return server;
}

// Returning before the country call resolves would let the journal lose an uncommitted lifetime.
test('lifetime delivery preserves exact signed bytes and waits for country commit',async t=>{
 const f=await fixture(t),entered=held(),release=held();
 await f.serve({store:{async recordLifecycle(m:TrafficMapping,e:unknown){entered.resolve();await release.promise;await f.store.recordLifecycle(m,e);}}});
 let acknowledged=false;const pending=f.send().then(()=>acknowledged=true);t.after(async()=>{release.resolve();await pending.catch(()=>{});});
 try{await entered.promise;await delay(20);assert.equal(acknowledged,false);assert.deepEqual(f.received,[]);release.resolve();await pending;
 assert.deepEqual(f.received,[{mapping:f.mapping,envelope:f.envelope}]);assert.equal((await lstat(f.socket)).mode&0o7777,0o600);}
 finally{release.resolve();await pending.catch(()=>{});}
});
test('country refusal cannot acknowledge a pending lifetime',async t=>{
 const f=await fixture(t);await f.serve({store:{async recordLifecycle(){throw Error('private-canary');}}});
 await assert.rejects(f.send(),unavailable);assert.deepEqual(f.received,[]);
 assert.equal(await raw(f.socket,JSON.stringify(f.envelope)+'\n'),'{"error":"unavailable"}\n');
});
test('server binds each record to its configured cell and snapshots trusted mappings',async t=>{
 const f=await fixture(t),other={...f.mapping,cellId:randomUUID(),directory:join(f.root,'other')};
 const mappings=[f.mapping,other];await f.serve({mappings});mappings.length=0;f.mapping.directory='changed';
 await f.send();assert.equal(f.received[0]!.mapping.directory,join(f.root,'reports'));
 await f.send(signTrafficLifecycle({...f.start,cellId:other.cellId},f.keys.privateKey));assert.deepEqual(f.received[1]!.mapping,other);
 await assert.rejects(f.send(signTrafficLifecycle({...f.start,cellId:randomUUID()},f.keys.privateKey)),unavailable);assert.equal(f.received.length,2);
});
for(const fault of ['empty','invalid-later','duplicate-cell','duplicate-directory'])test(`server refuses ${fault} mappings before opening a socket`,async t=>{
 const f=await fixture(t);let mappings:unknown[]=[f.mapping];
 if(fault==='empty')mappings=[];
 if(fault==='invalid-later')mappings.push({...f.mapping,cellId:randomUUID(),directory:join(f.root,'other'),environment:'production'});
 if(fault==='duplicate-cell')mappings.push({...f.mapping,directory:join(f.root,'other')});
 if(fault==='duplicate-directory')mappings.push({...f.mapping,cellId:randomUUID()});
 await assert.rejects(f.serve({mappings}),unavailable);await assert.rejects(lstat(f.socket),/ENOENT/);assert.deepEqual(f.received,[]);
});
for(const fault of ['relative','non-normal','long','symlink-parent','open-parent','existing-file','existing-socket'])test(`private lifetime socket refuses ${fault} without replacing state`,async t=>{
 const f=await fixture(t);let path=f.socket;
 if(fault==='relative')path='relative.sock';
 if(fault==='non-normal')path=f.root+'/../'+f.root.split('/').at(-1)+'/country.sock';
 if(fault==='long')path=join(f.root,'x'.repeat(101)+'.sock');
 if(fault==='symlink-parent'){await symlink(f.root,f.root+'-link');t.after(()=>rm(f.root+'-link'));path=join(f.root+'-link','country.sock');}
 if(fault==='open-parent')await chmod(f.root,0o755);
 if(fault==='existing-file')await writeFile(path,'retain-me');
 if(fault==='existing-socket')await fake(t,path,s=>s.end());
 const before=await lstat(path).catch(()=>undefined);
 await assert.rejects(f.serve({socket:path}),unavailable);await assert.rejects(f.send(f.envelope,path),unavailable);
 if(before){const after=await lstat(path);assert.equal(after.ino,before.ino);if(fault==='existing-file')assert.equal(await readFile(path,'utf8'),'retain-me');}
 assert.deepEqual(f.received,[]);
});
for(const [name,bytes] of [
 ['malformed','not-json\n'],['extra-envelope',JSON.stringify({payload:'x',signature:'y',extra:true})+'\n'],
 ['extra-frame','{}\n{}\n'],['trailing-data','{}\nprivate-canary'],['invalid-utf8',Buffer.from([0xff,0x0a])],['oversize','x'.repeat(16385)],
] as const)test(`country refuses ${name} framing before any store write`,async t=>{
 const f=await fixture(t);await f.serve();assert.equal(await raw(f.socket,bytes),'{"error":"unavailable"}\n');assert.deepEqual(f.received,[]);
});
for(const name of ['wrong-digest','extra-reply-key','malformed','too-large','missing-newline','two-replies'])test(`sender retains its lifetime on ${name} reply`,async t=>{
 const f=await fixture(t),digest=createHash('sha256').update(JSON.stringify(f.envelope)).digest('hex');
 const correct=JSON.stringify({accepted:digest})+'\n';
 const replies:Record<string,string>={'wrong-digest':JSON.stringify({accepted:'0'.repeat(64)})+'\n','extra-reply-key':JSON.stringify({accepted:digest,extra:true})+'\n',malformed:'not-json\n','too-large':'x'.repeat(129),'missing-newline':correct.trim(),'two-replies':correct+correct};
 const reply=replies[name];assert.ok(reply);await fake(t,f.socket,s=>s.end(reply));await assert.rejects(f.send(),unavailable);
});
test('sender snapshots the envelope before asynchronous filesystem checks',async t=>{
 const f=await fixture(t);await f.serve();const original={...f.envelope},pending=f.send();f.envelope.payload='changed';await pending;assert.deepEqual(f.received[0]!.envelope,original);
});
test('sender refuses an open socket before connecting',async t=>{
 const f=await fixture(t);await f.serve();await chmod(f.socket,0o666);await assert.rejects(f.send(),unavailable);assert.deepEqual(f.received,[]);
});
test('replaced private socket cannot acknowledge the original connection',async t=>{
 const f=await fixture(t),entered=held(),release=held();await f.serve({store:{async recordLifecycle(){entered.resolve();await release.promise;}}});
 const refused=assert.rejects(f.send(),unavailable);t.after(async()=>{release.resolve();await refused.catch(()=>{});});await entered.promise;
 await rename(f.socket,join(f.root,'old.sock'));await fake(t,f.socket,s=>s.end());release.resolve();await refused;
});
test('shutdown refuses new connections but drains a country call before resolving',async t=>{
 const f=await fixture(t),entered=held(),release=held();const server=await f.serve({store:{async recordLifecycle(m:TrafficMapping,e:unknown){entered.resolve();await release.promise;await f.store.recordLifecycle(m,e);}}});
 const sent=f.send();t.after(async()=>{release.resolve();await sent.catch(()=>{});});await entered.promise;
 let closed=false;const closing=server.close().then(()=>closed=true);
 try{await delay(20);assert.equal(closed,false);assert.deepEqual(f.received,[]);
 await assert.rejects(f.send(),unavailable);release.resolve();await sent;await closing;assert.equal(f.received.length,1);await server.close();}
 finally{release.resolve();await sent.catch(()=>{});await closing;}
});
test('journal retries a lost country reply byte-for-byte after sender restart',async t=>{
 const f=await fixture(t),issuer=generateKeyPairSync('ed25519');
 const manifest:ReportingGatewayManifest={version:2,audience:'waitron-cloud-gateway',cellId:f.mapping.cellId,sequence:1,issuedAt:Date.parse(f.start.startedAt),expiresAt:Date.parse(f.start.startedAt)+600000,reporter:{gatewayId:f.start.gatewayId,generation:1},routes:[]};
 const options={directory:join(f.root,'journal'),country:'ES' as const,environment:'test' as const,cellId:f.mapping.cellId,issuerKey:issuer.publicKey,reporterKey:f.keys.privateKey};
 const journal=new TrafficChildJournal(options);const envelope=await journal.prepare({manifest:signManifest(manifest,issuer.privateKey,manifest.issuedAt),processId:f.start.processId,startedAt:f.start.startedAt,predecessorId:null});
 let lose=true;await f.serve({store:{async recordLifecycle(m:TrafficMapping,e:unknown){await f.store.recordLifecycle(m,e);if(lose)throw Error('lost-reply');}}});
 await assert.rejects(journal.flush(e=>f.send(e)),/^Error: traffic_child_journal_unavailable$/);assert.deepEqual(await journal.pending(),[envelope]);
 lose=false;const restarted=new TrafficChildJournal(options);await restarted.flush(e=>f.send(e));assert.deepEqual(await restarted.pending(),[]);
 assert.deepEqual(f.received.map(r=>r.envelope),[envelope,envelope]);
});

test('disconnected exporters cannot exceed the bound on unfinished country transactions',async t=>{
 const f=await fixture(t),entered=held(),release=held();let calls=0;
 await f.serve({store:{async recordLifecycle(){calls++;if(calls===32)entered.resolve();if(calls<=32)await release.promise;}}});
 const clients:Socket[]=[];t.after(async()=>{release.resolve();for(const s of clients)s.destroy();});
 for(let n=0;n<32;n++){const s=connect(f.socket);s.on('error',()=>{});clients.push(s);await new Promise<void>(r=>s.once('connect',r));s.write(JSON.stringify(f.envelope)+'\n');}
 await entered.promise;for(const s of clients)s.destroy();await Promise.all(clients.map(s=>s.closed?Promise.resolve():new Promise<void>(r=>s.once('close',()=>r()))));
 try{await delay(6200);const denied=f.send();await assert.rejects(denied,unavailable);assert.equal(calls,32);}
 finally{release.resolve();for(const s of clients)s.destroy();}
});
test('an unfinished request cannot keep its connection alive by trickling bytes',async t=>{
 const f=await fixture(t);await f.serve();const s=connect(f.socket);let text='';s.on('data',b=>text+=b);s.on('error',()=>{});
 const ended=new Promise<void>(r=>s.once('end',()=>r())),start=performance.now(),timer=setInterval(()=>s.write(' '),100);
 try{const result=await Promise.race([ended.then(()=>true),delay(2500).then(()=>false)]);assert.equal(result,true);assert.ok(performance.now()-start<2500);assert.equal(text,'{"error":"unavailable"}\n');assert.deepEqual(f.received,[]);}
 finally{clearInterval(timer);s.destroy();}
});
test('an oversized incomplete request refuses before the one-second read deadline',async t=>{
 const f=await fixture(t);await f.serve();const s=connect(f.socket);let text='';s.on('data',b=>text+=b);s.on('error',()=>{});
 const ended=new Promise<void>(r=>s.once('end',()=>r()));let deadline:ReturnType<typeof setTimeout>|undefined;
 try{
  await new Promise<void>(r=>s.once('connect',r));s.write('x'.repeat(16385));
  const result=await Promise.race([ended.then(()=>true),new Promise<boolean>(r=>deadline=setTimeout(()=>r(false),500))]);
  assert.equal(result,true,'oversize refusal must not wait for timeout');assert.equal(text,'{"error":"unavailable"}\n');assert.deepEqual(f.received,[]);
 }finally{if(deadline)clearTimeout(deadline);s.destroy();}
});
test('a reply that trickles bytes still reaches the sender total deadline',async t=>{
 const f=await fixture(t);let timer:ReturnType<typeof setInterval>|undefined;
 await fake(t,f.socket,s=>{timer=setInterval(()=>s.write(' '),200);s.once('close',()=>{if(timer)clearInterval(timer);});});
 const start=performance.now();try{const result=await Promise.race([f.send().then(()=>'accepted',(e:unknown)=>{assert.match(String(e),unavailable);return 'refused';}),delay(8500).then(()=>'late')]);assert.equal(result,'refused');assert.ok(performance.now()-start>=5500);assert.ok(performance.now()-start<8500);}
 finally{if(timer)clearInterval(timer);}
});


test('a replaced private parent cannot acknowledge the unchanged socket inode',async t=>{
 const f=await fixture(t),entered=held(),release=held();await f.serve({store:{async recordLifecycle(){entered.resolve();await release.promise;}}});
 const pending=assert.rejects(f.send(),unavailable),old=f.root+'-old';
 try{
  await entered.promise;await rename(f.root,old);await mkdir(f.root,{mode:0o700});await rename(join(old,'country.sock'),f.socket);release.resolve();await pending;
 }finally{release.resolve();await pending.catch(()=>{});await rm(old,{recursive:true,force:true});}
});
test('a reply larger than its cap refuses before waiting for connection EOF',async t=>{
 const f=await fixture(t);await fake(t,f.socket,s=>s.write('x'.repeat(129)));
 const result=await Promise.race([f.send().then(()=>'accepted',(e:unknown)=>{assert.match(String(e),unavailable);return 'refused';}),delay(500).then(()=>'late')]);
 assert.equal(result,'refused');
});


test('idle lifetime connections are bounded before another signed request can enter',async t=>{
 const f=await fixture(t);await f.serve();const clients:Socket[]=[];
 try{
  for(let n=0;n<32;n++){const s=connect(f.socket);s.on('error',()=>{});clients.push(s);await new Promise<void>(r=>s.once('connect',r));s.write(' ');}
  await assert.rejects(f.send(),unavailable);assert.deepEqual(f.received,[]);
 }finally{for(const s of clients)s.destroy();}
});
test('country refuses trailing whitespace outside its exact lifetime frame',async t=>{
 const f=await fixture(t);await f.serve();assert.equal(await raw(f.socket,JSON.stringify(f.envelope)+'\n '),'{"error":"unavailable"}\n');assert.deepEqual(f.received,[]);
});
test('country receipt binds the exact received signed envelope',async t=>{
 const f=await fixture(t);await f.serve();const receipt=await raw(f.socket,JSON.stringify(f.envelope)+'\n');
 assert.equal(receipt,JSON.stringify({accepted:createHash('sha256').update(JSON.stringify(f.envelope)).digest('hex')})+'\n');assert.deepEqual(f.received,[{mapping:f.mapping,envelope:f.envelope}]);
});


test('country refuses a replaced socket before dispatching an already connected request',async t=>{
 const f=await fixture(t);await f.serve();const s=connect(f.socket),chunks:Buffer[]=[];s.on('data',b=>chunks.push(b));s.on('error',()=>{});
 const ended=new Promise<void>(r=>s.once('end',()=>r()));
 try{
  await new Promise<void>(r=>s.once('connect',r));await rename(f.socket,join(f.root,'old.sock'));await fake(t,f.socket,c=>c.end());
  s.end(JSON.stringify(f.envelope)+'\n');await ended;assert.equal(Buffer.concat(chunks).toString(),'{"error":"unavailable"}\n');assert.deepEqual(f.received,[]);
 }finally{s.destroy();}
});

test('shutdown refuses a request on an idle connection accepted before closing',async t=>{
 const f=await fixture(t),server=await f.serve(),s=connect(f.socket),chunks:Buffer[]=[];s.on('data',b=>chunks.push(b));s.on('error',()=>{});
 const ended=new Promise<void>(r=>s.once('end',()=>r()));
 try{
  await new Promise<void>(r=>s.once('connect',r));s.write('');await delay(20);const closed=server.close();s.end(JSON.stringify(f.envelope)+'\n');
  await ended;await closed;assert.equal(Buffer.concat(chunks).toString(),'{"error":"unavailable"}\n');assert.deepEqual(f.received,[]);
 }finally{s.destroy();}
});
