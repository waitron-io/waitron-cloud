import {readFile} from 'node:fs/promises';

export async function readIntegrationSourceIdentity(root) {
  const saved=JSON.parse(await readFile(root+'/fixture-env.json','utf8'));
  const connection=JSON.parse(await readFile(root+'/cloud/connection.json','utf8'));
  return {nodeId:saved.WAITRON_NODE_ID??saved.WAITRON_TILL_NODE_ID,streamId:connection.venueId};
}
