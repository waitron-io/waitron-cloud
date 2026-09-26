import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after,test} from 'node:test';

const directory=await mkdtemp(join(tmpdir(),'cell-movement-receipt-'));
after(()=>rm(directory,{recursive:true,force:true}));

const receipt={
 cloudHead:'a'.repeat(40),cloudDirty:false,
 movement:{version:1,failedApply:{cancelled:true,sourceStayedHealthy:true,destinationRemoved:true},hostnamesPreserved:true,certificatesPreserved:true,
  otherVenueIsolated:true,oldRouteRevoked:true,completedReplayMatched:true,reconnectionMs:1,
  sequences:{initialSource:1,failedTarget:1,cancelledTarget:2,stagedTarget:3,committedSource:2,committedTarget:4}}
};

async function verify(value){
 const path=join(directory,`${crypto.randomUUID()}.json`);await writeFile(path,JSON.stringify(value));
 return execFileSync(process.execPath,['scripts/verify-cell-movement-receipt.mjs',path],{encoding:'utf8'});
}

test('the movement receipt proves a clean exact Cloud head',async()=>{
 assert.match(await verify(receipt),/Verified local cell movement/);
 await assert.rejects(verify({...receipt,cloudDirty:true}));
 await assert.rejects(verify({...receipt,cloudHead:'not-a-commit'}));
});
