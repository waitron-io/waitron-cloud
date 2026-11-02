import {lstat,realpath} from 'node:fs/promises';
import {connect} from 'node:net';
import {isAbsolute,normalize} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
function unavailable():never{throw new Error('traffic_quiescence_unavailable');}
function drained(csv:string):boolean{
 const lines=csv.trim().split(/\r?\n/),first=lines.shift();if(!first?.startsWith('# '))unavailable();
 const header=first.slice(2).split(','),names=header.filter(Boolean);
 if(new Set(names).size!==names.length)unavailable();
 const positions=['pxname','svname','scur','qcur','status','type'].map(name=>header.indexOf(name));if(positions.some(i=>i<0))unavailable();
 const [px,sv,scur,qcur,status,type]=positions as [number,number,number,number,number,number];
 const fronts=new Set<string>();let backends=0,ready=true;
 const count=(v:string|undefined)=>{if(v===undefined||!/^(0|[1-9][0-9]{0,9})$/.test(v)||BigInt(v)>4294967295n)unavailable();return v==='0';};
 for(const line of lines){
  const row=line.split(',');if(row.length!==header.length)unavailable();
  if(row[sv]==='FRONTEND'){
   const name=row[px]!;if(!['ingress','public_https'].includes(name)||fronts.has(name)||row[type]!=='0')unavailable();fronts.add(name);
   if(!count(row[scur])||row[status]!=='PAUSED')ready=false;
  }else if(row[sv]==='BACKEND'){
   if(row[type]!=='1')unavailable();backends++;if(!count(row[scur])||!count(row[qcur]))ready=false;
  }
 }
 if(fronts.size!==2||backends===0)unavailable();return ready;
}
/** Pause also closes HAProxy's stats listener. Retain the established private connection until every listener and session is quiet. */
export async function readQuiescentTrafficSocket(path:string,pause:()=>boolean):Promise<string>{
 try{
  if(!isAbsolute(path)||normalize(path)!==path||path.length>100||!path.endsWith('.sock'))unavailable();
  const before=await lstat(path);
  if(!before.isSocket()||before.uid!==process.geteuid!()||(before.mode&0o7777)!==0o600||await realpath(path)!==path)unavailable();
  const socket=connect(path);let buffer=Buffer.alloc(0),total=0,failed=false,wake:(()=>void)|undefined;
  const fail=()=>{failed=true;wake?.();};
  const timer=setTimeout(fail,5000);
  socket.on('error',fail);socket.on('end',fail);socket.on('close',fail);
  socket.on('data',(bytes:Buffer)=>{total+=bytes.length;if(buffer.length+bytes.length>1048576||total>8388608){fail();return;}buffer=Buffer.concat([buffer,bytes]);wake?.();});
  async function frame():Promise<string>{
   for(;;){
    if(failed)unavailable();const i=buffer.indexOf('\n> ');
    if(i>=0){const bytes=buffer.subarray(0,i);buffer=buffer.subarray(i+3);return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
    await new Promise<void>(resolve=>{wake=resolve;});
   }
  }
  try{
   await new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
   socket.write('prompt\n');if(await frame()!==''||!pause())unavailable();
   for(;;){
    socket.write('show stat\n');const csv=await frame();
    if(drained(csv)){
     const after=await lstat(path);
     if(failed||after.dev!==before.dev||after.ino!==before.ino||after.uid!==before.uid||(after.mode&0o7777)!==0o600||await realpath(path)!==path)unavailable();
     return csv;
    }
    await delay(25);
   }
  }finally{clearTimeout(timer);socket.destroy();}
 }catch{return unavailable();}
}
