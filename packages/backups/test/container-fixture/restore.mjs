import {mkdir,writeFile} from 'node:fs/promises';
export async function validateArtifact({artifact,stateDir}){
 const mode=artifact[0];
 if(mode===1){const buffers=[];for(let i=0;i<64;i++)buffers.push(Buffer.alloc(8*1024*1024,1));}
 if(mode===2||mode===6){try{for(let i=0;i<128;i++)await writeFile(stateDir+'/'+i,Buffer.alloc(512*1024,1));}catch(error){if(mode!==6||error.code!=='ENOSPC')throw error;await new Promise(()=>setInterval(()=>{},1000));}}
 if(mode===3)await new Promise(()=>setInterval(()=>{},1000));
 if(mode===4)throw Error('private fixture failure');
 return {manifest:{modules:{fake:1},createdAt:'2026-09-26T00:00:00.000Z'},dumpEntry:{bytes:artifact.subarray(1)},secretEntries:[{name:'secrets/trading.env',bytes:Buffer.from('WAITRON_NODE_ID=00000000-0000-4000-8000-'+String(mode).padStart(12,'0'))}]};
}
export async function writeValidated(_checked,deps){await mkdir(deps.venueDir,{recursive:true});await writeFile(deps.venueDir+'/restored','yes');deps.log('info','restore.hook.done',{module:'fake'});}
