import {createHash} from 'node:crypto';
import {chmod,lstat,realpath} from 'node:fs/promises';
import {connect,createServer,type Socket} from 'node:net';
import {dirname,isAbsolute,normalize} from 'node:path';
import {trafficEnvelopeLifecycle} from './traffic-lifecycle.ts';
import {validateTrafficMapping,type TrafficMapping,type TrafficCoverageStore} from './traffic-coverage.ts';
import type {ManifestEnvelope} from './manifest.ts';

function unavailable():never{throw new Error('traffic_lifetime_transport_unavailable');}
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
async function privateParent(path:string){
 if(typeof path!=='string'||!isAbsolute(path)||normalize(path)!==path||path.length>100||!path.endsWith('.sock'))unavailable();
 const parent=dirname(path),s=await lstat(parent,{bigint:true});
 if(!s.isDirectory()||s.uid!==BigInt(process.geteuid!())||(s.mode&0o7777n)!==0o700n||await realpath(parent)!==parent)unavailable();
 return s;
}
async function privateSocket(path:string){
 await privateParent(path);const s=await lstat(path,{bigint:true});
 if(!s.isSocket()||s.uid!==BigInt(process.geteuid!())||(s.mode&0o7777n)!==0o600n||await realpath(path)!==path)unavailable();
 return s;
}

/** Only a matching committed reply may let the private journal acknowledge its signed retry. */
export async function sendTrafficLifetime(path:string,input:ManifestEnvelope):Promise<void>{
 let envelope:ManifestEnvelope,text:string;
 try{envelope=structuredClone(input);trafficEnvelopeLifecycle(envelope);text=JSON.stringify(envelope);if(Buffer.byteLength(text)+1>16384)unavailable();}catch{return unavailable();}
 try{
  const parent=await privateParent(path),before=await privateSocket(path);
  const reply=await new Promise<string>((resolve,reject)=>{
   const socket=connect({path,allowHalfOpen:true}),chunks:Buffer[]=[];let size=0,settled=false;
   const finish=async(error?:unknown)=>{if(settled)return;settled=true;clearTimeout(timer);
    try{
     if(error)unavailable();const reply=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size));
     const after=await privateSocket(path),p=await privateParent(path);
     if(after.dev!==before.dev||after.ino!==before.ino||p.dev!==parent.dev||p.ino!==parent.ino)unavailable();resolve(reply);
    }catch{reject(new Error('traffic_lifetime_transport_unavailable'));}finally{socket.destroy();}
   };
   const timer=setTimeout(()=>finish(new Error()),6000);
   socket.once('connect',()=>socket.write(text+'\n'));
   socket.on('data',b=>{size+=b.length;if(size>128){finish(new Error());return;}chunks.push(b);});
   socket.once('error',finish);socket.once('end',()=>finish());socket.once('close',()=>{if(!settled)finish(new Error());});
  });
  if(reply!==JSON.stringify({accepted:hash(text)})+'\n')unavailable();
 }catch{return unavailable();}
}

interface Options {socket:string;mappings:readonly TrafficMapping[];store:Pick<TrafficCoverageStore,'recordLifecycle'>}
/** The store owns signature authority and commit. Framing and mapped-cell lookup alone grant neither. */
export async function serveTrafficLifetimes(options:Options):Promise<{close:()=>Promise<void>}>{
 let path:string,parent:Awaited<ReturnType<typeof privateParent>>;const mappings=new Map<string,TrafficMapping>();
 try{
  path=options.socket;parent=await privateParent(path);const directories=new Set<string>();
  if(!Array.isArray(options.mappings)||!options.mappings.length)unavailable();
  for(const input of options.mappings){
   validateTrafficMapping(input);const m={...input};if(mappings.has(m.cellId)||directories.has(m.directory))unavailable();
   mappings.set(m.cellId,m);directories.add(m.directory);
  }
  try{await lstat(path);unavailable();}catch(e){if(!e||typeof e!=='object'||!('code'in e)||e.code!=='ENOENT')throw e;}
 }catch{return unavailable();}
 const sockets=new Set<Socket>(),work=new Set<Promise<void>>();let closing=false,closed:Promise<void>|undefined;
 const server=createServer({allowHalfOpen:true},socket=>{
  socket.on('error',()=>{});if(closing){socket.destroy();return;}
  sockets.add(socket);socket.once('close',()=>sockets.delete(socket));
  const chunks:Buffer[]=[];let size=0,started=false,finished=false;
  const total=setTimeout(()=>socket.destroy(),6000);
  const readTimer=setTimeout(()=>refuse(),1000);
  function refuse(){if(finished)return;finished=true;clearTimeout(readTimer);socket.end('{"error":"unavailable"}\n');}
  socket.once('close',()=>{clearTimeout(total);clearTimeout(readTimer);});
  socket.on('data',bytes=>{
   if(finished||started){socket.destroy();return;}if(closing){refuse();return;}size+=bytes.length;if(size>16384){refuse();return;}chunks.push(bytes);
   if(!bytes.includes(10))return;clearTimeout(readTimer);if(work.size>=32){refuse();return;}started=true;
   const operation=(async()=>{
    try{
     const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)),envelope:unknown=JSON.parse(text);
     const value=trafficEnvelopeLifecycle(envelope),mapping=mappings.get(value.cellId);
     if(!mapping||text!==JSON.stringify(envelope)+'\n')unavailable();
     const current=await privateSocket(path),p=await privateParent(path);
     if(current.dev!==identity!.dev||current.ino!==identity!.ino||p.dev!==parent.dev||p.ino!==parent.ino)unavailable();
     await options.store.recordLifecycle({...mapping},envelope);
     finished=true;socket.end(JSON.stringify({accepted:hash(text.slice(0,-1))})+'\n');
    }catch{refuse();}
   })();work.add(operation);void operation.finally(()=>work.delete(operation));
  });
  socket.once('end',()=>{if(!started)refuse();});
 });
 server.maxConnections=32;let identity:Awaited<ReturnType<typeof privateSocket>>|undefined;
 try{
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(path,resolve);});
  await chmod(path,0o600);identity=await privateSocket(path);
  const p=await privateParent(path);if(p.dev!==parent.dev||p.ino!==parent.ino)unavailable();
 }catch{
  if(server.listening)await new Promise<void>(r=>server.close(()=>r()));return unavailable();
 }
 server.on('error',()=>{});
 return {close(){
  if(closed)return closed;closing=true;
  closed=(async()=>{
   // Keep the bound pathname until current senders verify their replies; new connections are refused.
   // A disconnected exporter cannot cancel a country transaction already in progress.
   const drained=[...sockets].map(socket=>new Promise<void>(resolve=>socket.once('close',()=>resolve())));
   await Promise.all([...work]);await Promise.all(drained);
   await new Promise<void>(resolve=>server.close(()=>resolve()));
  })();return closed;
 }};
}
