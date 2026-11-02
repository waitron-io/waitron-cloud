import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {join} from 'node:path';
const [scenario,serialized]=process.argv.slice(2),mapping=JSON.parse(serialized!);
const name=(await fs.readdir(mapping.directory))[0]!,file=join(mapping.directory,name);
const originalOpen=fs.open;let swaps=0,calls=0;
fs.open=(async(path,flags,...rest)=>{
 if(scenario==='directory-open'&&path===mapping.directory){
  const saved=mapping.directory+'-held';await fs.rename(mapping.directory,saved);await fs.symlink(saved,mapping.directory);swaps++;
  try{return await originalOpen(path,flags,...rest);}finally{await fs.unlink(mapping.directory);await fs.rename(saved,mapping.directory);}
 }
 const handle=await originalOpen(path,flags,...rest);
 if(path===file&&typeof flags==='number'&&(flags&constants.O_DIRECTORY)===0){
  if(scenario==='post-read'){
   const read=handle.read.bind(handle);
   handle.read=(async(...args:Parameters<typeof read>)=>{const result=await read(...args);if(!result.bytesRead&&!swaps){await fs.rename(file,file+'.held');await fs.symlink(file+'.held',file);swaps++;}return result;}) as typeof handle.read;
  }
  if(scenario==='file-uid'||scenario==='file-gid'){
   const stat=handle.stat.bind(handle);
   handle.stat=(async(...args:Parameters<typeof stat>)=>{const s=await stat(...args);swaps++;return {...s,isFile:()=>s.isFile(),uid:BigInt(s.uid)+(scenario==='file-uid'?1n:0n),gid:BigInt(s.gid)+(scenario==='file-gid'?1n:0n)};}) as typeof handle.stat;
  }
 }
 return handle;
}) as typeof fs.open;
const originalLstat=fs.lstat;
fs.lstat=(async(...args:Parameters<typeof originalLstat>)=>{
 const s=await originalLstat(...args);
 if(args[0]===mapping.directory&&(scenario==='directory-uid'||scenario==='directory-gid')){
  swaps++;return {...s,isDirectory:()=>s.isDirectory(),uid:BigInt(s.uid)+(scenario==='directory-uid'?1n:0n),gid:BigInt(s.gid)+(scenario==='directory-gid'?1n:0n)};
 }
 return s;
}) as typeof fs.lstat;
syncBuiltinESMExports();
const {collectTraffic}=await import('../../src/traffic-collector.ts');
await assert.rejects(collectTraffic(mapping,{async record(){calls++;throw Error('unexpected storage');}}),/^Error: traffic_collection_unavailable$/);
assert.equal(calls,0);assert.equal(swaps,1);console.log('refused without storage');
