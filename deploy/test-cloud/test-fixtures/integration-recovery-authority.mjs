import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {mintBreakGlassKey} from '/waitron/apps/server/src/break-glass.ts';
import {establishNodeIdentity} from '/waitron/apps/server/src/node-identity.ts';
import {loadBoxEnv} from '/waitron/apps/server/src/box-env.ts';
const {openVenueDatabase} = createRequire('/waitron/apps/server/package.json')('@waitron/db');
const {loadKeyRing} = createRequire('/waitron/apps/server/package.json')('@waitron/credentials');

// Only the owning proof receives this separate authority over its private socket, before capture.
export async function prepareIntegrationRecoveryAuthority(root) {
  assert.equal(process.env.CLOUD_TEST_BACKUP_STATE, '1');
  const saved = JSON.parse(await readFile(root + '/fixture-env.json', 'utf8'));
  const store = await openVenueDatabase(root + '/venue', {exclusive: false});
  try {
    await establishNodeIdentity({ownerDb: store.venue, ring: loadKeyRing(await loadBoxEnv({}, root))}, saved.WAITRON_TILL_NODE_ID);
    const key = await mintBreakGlassKey(store.venue, saved.WAITRON_TILL_NODE_ID);
    return {...key, sourceNodeId: saved.WAITRON_TILL_NODE_ID, localVenueId: saved.WAITRON_TILL_LOCATION_ID};
  } finally {await store.close();}
}
