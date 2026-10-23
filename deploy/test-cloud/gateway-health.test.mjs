import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,writeFile,utimes,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
// A live gateway with paid routes is healthy; old status from a stopped worker is not.
test('gateway health accepts live nonempty routing and rejects stale or unready state',async t=>{
 const api=await import('./gateway-health.mjs').catch(()=>({}));assert.equal(typeof api.testGatewayHealthy,'function');
 const dir=await mkdtemp(join(tmpdir(),'cloud-gateway-health-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'status.json');
 assert.equal(await api.testGatewayHealthy(path),false);
 await writeFile(path,JSON.stringify({ready:true,routes:2,sequence:3}));assert.equal(await api.testGatewayHealthy(path),true);
 const old=new Date(Date.now()-10000);await utimes(path,old,old);assert.equal(await api.testGatewayHealthy(path),false);
 await writeFile(path,JSON.stringify({ready:false,routes:0,sequence:3}));assert.equal(await api.testGatewayHealthy(path),false);
 await writeFile(path,'broken');assert.equal(await api.testGatewayHealthy(path),false);
});
