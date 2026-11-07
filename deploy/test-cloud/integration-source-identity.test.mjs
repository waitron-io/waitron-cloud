import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const load=async()=>{try{return await import('./test-fixtures/integration-source-identity.mjs');}catch(error){if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;}};
for(const [name,saved,ready,want] of [
 ['current',{WAITRON_NODE_ID:'current-node'},{localVenueId:'current-venue'},{nodeId:'current-node',localVenueId:'current-venue'}],
 ['old',{WAITRON_TILL_NODE_ID:'old-node'},{localVenueId:'old-venue'},{nodeId:'old-node',localVenueId:'old-venue'}],
 ['current names prevail',{WAITRON_NODE_ID:'current-node',WAITRON_TILL_NODE_ID:'stale-node'},{localVenueId:'current-venue'},{nodeId:'current-node',localVenueId:'current-venue'}],
])test(`reads the actual ${name} fixture identity`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'cloud-source-identity-'));
 try{await writeFile(join(root,'fixture-env.json'),JSON.stringify(saved));await writeFile(join(root,'ready.json'),JSON.stringify(ready));const {readIntegrationSourceIdentity}=await load();assert.equal(typeof readIntegrationSourceIdentity,'function','paired source identity reader is missing');assert.deepEqual(await readIntegrationSourceIdentity(root),want);}
 finally{await rm(root,{recursive:true,force:true});}
});
