import {readFile} from 'node:fs/promises';

export async function readIntegrationSourceIdentity(root) {
  const saved=JSON.parse(await readFile(root+'/fixture-env.json','utf8'));
  const ready=JSON.parse(await readFile(root+'/ready.json','utf8'));
  return {nodeId:saved.WAITRON_NODE_ID??saved.WAITRON_TILL_NODE_ID,localVenueId:ready.localVenueId};
}
