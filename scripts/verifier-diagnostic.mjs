import cp from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {readFileSync} from 'node:fs';
const original=cp.spawn;
const heap="const values=[];for(let i=0;i<5_000_000;i++)values.push(i);console.log('{}')";
let sequence=0;
cp.spawn=function(...args){
 const start=performance.now(),id=++sequence;
 const log=(event,data={})=>console.log(JSON.stringify({id,event,ms:Math.round(performance.now()-start),...data}));
 const child=original.apply(this,args);log('spawn',{pid:child.pid});
 let tail='';
 child.stderr.on('data',b=>{tail=(tail+b).slice(-8192);log('stderr',{bytes:b.length,heap:/heap out of memory|reached heap limit|ineffective mark-compacts/i.test(tail)});});
 child.stdout.on('data',b=>log('stdout',{bytes:b.length}));
 const timer=setInterval(()=>{let state=null,wchan=null;try{state=readFileSync('/proc/'+child.pid+'/stat','utf8').split(') ')[1]?.split(' ')[0];wchan=readFileSync('/proc/'+child.pid+'/wchan','utf8').trim();}catch{}log('sample',{state,wchan});},500);
 child.on('exit',(code,signal)=>log('exit',{code,signal}));
 child.on('close',(code,signal)=>{clearInterval(timer);log('close',{code,signal});});
 child.stdin.on('error',e=>log('stdin-error',{code:e.code}));
 return child;
};
syncBuiltinESMExports();
const {runNodeVerifier}=await import(process.argv[2]);
console.log(JSON.stringify({node:process.version,platform:process.platform,concurrency:Number(process.argv[3]??1)}));
try{console.log('core-pattern '+readFileSync('/proc/sys/kernel/core_pattern','utf8').trim());}catch{}
await Promise.all(Array.from({length:Number(process.argv[3]??1)},async()=>{const start=performance.now();try{await runNodeVerifier(['-e',heap],{input:{},timeoutMs:5000,limits:{heapMiB:16}});console.log('unexpected-success');}catch(e){console.log(JSON.stringify({result:e.message,ms:Math.round(performance.now()-start)}));}}));
