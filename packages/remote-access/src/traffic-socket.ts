import {connect} from 'node:net';
import {lstat,realpath} from 'node:fs/promises';
import {isAbsolute,normalize} from 'node:path';
function unavailable():never{throw new Error('traffic_socket_unavailable');}
/** A private stats connection has a total deadline; activity cannot keep a sampler alive forever. */
export async function readTrafficSocket(path:string):Promise<string>{
 try{
  if(typeof path!=='string'||!isAbsolute(path)||normalize(path)!==path||path.length>100||!path.endsWith('.sock'))unavailable();
  const before=await lstat(path);
  if(!before.isSocket()||before.uid!==process.geteuid!()||(before.mode&0o7777)!==0o600||await realpath(path)!==path)unavailable();
  const text=await new Promise<string>((resolve,reject)=>{
   const socket=connect(path),chunks:Buffer[]=[];let size=0,settled=false;
   const finish=(error?:Error)=>{
    if(settled)return;settled=true;clearTimeout(timer);socket.destroy();
    if(error){reject(new Error('traffic_socket_unavailable'));return;}
    try{resolve(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,size)));}catch{reject(new Error('traffic_socket_unavailable'));}
   };
   const timer=setTimeout(()=>finish(new Error()),1000);
   socket.once('connect',()=>socket.write('show stat\n'));
   socket.on('data',bytes=>{size+=bytes.length;if(size>1048576){finish(new Error());return;}chunks.push(bytes);});
   socket.once('error',error=>finish(error));socket.once('end',()=>finish());
   socket.once('close',()=>{if(!settled)finish(new Error());});
  });
  const after=await lstat(path);
  if(after.dev!==before.dev||after.ino!==before.ino||after.uid!==before.uid||(after.mode&0o7777)!==0o600||await realpath(path)!==path)unavailable();
  return text;
 }catch{return unavailable();}
}
