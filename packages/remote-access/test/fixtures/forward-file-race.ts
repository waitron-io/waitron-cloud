import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {dirname,join} from 'node:path';

const [scenario,serialized]=process.argv.slice(2),mapping=JSON.parse(serialized!);
let swaps=0,calls=0;
const originalOpen=fs.open;
fs.open=(async(path,flags,...rest)=>{
 if(scenario==='directory-open'&&path===dirname(mapping.file)){
  const directory=dirname(mapping.file),saved=directory+'-held';
  await fs.rename(directory,saved);await fs.symlink(saved,directory);swaps++;
  try{return await originalOpen(path,flags,...rest);}finally{await fs.unlink(directory);await fs.rename(saved,directory);}
 }
 const handle=await originalOpen(path,flags,...rest);
 if(scenario==='post-read'&&path===mapping.file&&typeof flags==='number'&&(flags&constants.O_DIRECTORY)===0){
  const originalRead=handle.read.bind(handle);
  handle.read=(async(...args:Parameters<typeof originalRead>)=>{
   const result=await originalRead(...args);
   if(result.bytesRead===0&&swaps===0){const saved=join(dirname(mapping.file),'held.json');await fs.rename(mapping.file,saved);await fs.symlink(saved,mapping.file);swaps++;}
   return result;
  }) as typeof handle.read;
 }
 return handle;
}) as typeof fs.open;
syncBuiltinESMExports();
const {collectForwardReport}=await import('../../src/forward-report-collector.ts');
await assert.rejects(collectForwardReport(mapping,{async record(){calls++;return 'accepted';},async prune(){return 0;}}),/^Error: forward_report_unavailable$/);
assert.equal(calls,0);if(scenario!=='fifo')assert.equal(swaps,1);
console.log('refused without storage');
