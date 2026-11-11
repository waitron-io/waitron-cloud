import {readFile,statfs} from 'node:fs/promises';
import {loadavg,cpus} from 'node:os';

export async function readMachine({read=readFile,diskStat=statfs,load=loadavg,cpuCount=()=>cpus().length}={}){
 const [diskResult,memoryResult]=await Promise.allSettled([diskStat('/run/local-stack'),read('/proc/meminfo','utf8')]);
 let disk=null,memory=null,pressure=null;
 if(diskResult.status==='fulfilled'){
  const {blocks,bavail}=diskResult.value;
  if(Number.isFinite(blocks)&&blocks>0&&Number.isFinite(bavail)&&bavail>=0&&bavail<=blocks)disk=1-bavail/blocks;
 }
 if(memoryResult.status==='fulfilled'){
  const total=Number(memoryResult.value.match(/^MemTotal:\s+(\d+)\s+kB$/m)?.[1]);
  const available=Number(memoryResult.value.match(/^MemAvailable:\s+(\d+)\s+kB$/m)?.[1]);
  if(Number.isFinite(total)&&total>0&&Number.isFinite(available)&&available>=0&&available<=total)memory=1-available/total;
 }
 try{
  const value=load()[2],count=cpuCount();
  if(Number.isFinite(value)&&value>=0&&Number.isSafeInteger(count)&&count>0)pressure=value/count;
 }catch{}
 return {disk,memory,load:pressure};
}
