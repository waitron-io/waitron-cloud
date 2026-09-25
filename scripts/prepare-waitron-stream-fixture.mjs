import assert from 'node:assert/strict';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

let text='';for await(const chunk of process.stdin)text+=chunk;
const input=JSON.parse(text),waitron=resolve(process.env.WAITRON_CHECKOUT??'');
assert(waitron&&input.root&&input.nodeId&&input.env);
const [{openVenueDatabase},{loadKeyRing},{establishNodeIdentity},{seedTermZeroMembership}]=await Promise.all([
 import(pathToFileURL(join(waitron,'packages/db/src/index.ts'))),
 import(pathToFileURL(join(waitron,'packages/credentials/src/index.ts'))),
 import(pathToFileURL(join(waitron,'apps/server/src/node-identity.ts'))),
 import(pathToFileURL(join(waitron,'apps/server/src/membership-seed.ts'))),
]);
const db=await openVenueDatabase(join(input.root,'venue')),ring=loadKeyRing(input.env);
try{await establishNodeIdentity({ownerDb:db.venue,ring},input.nodeId);await seedTermZeroMembership({db:db.venue,ring},input.nodeId,input.env.WAITRON_MANAGEMENT_ORIGIN);}finally{await db.close();}
console.log(JSON.stringify({prepared:true}));
