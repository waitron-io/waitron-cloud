import assert from 'node:assert/strict';
import {test} from 'node:test';
import {workerObjects} from '../src/worker-config.ts';
test('worker credentials are pinned to the configured HTTPS endpoint and region',()=>{
 const factory=workerObjects({CLOUD_BACKUP_ENDPOINT:'https://localhost:443',CLOUD_BACKUP_REGION:'local',CLOUD_BACKUP_ACCESS_KEY:'local',CLOUD_BACKUP_SECRET_KEY:'local'});
 try{
  assert.throws(()=>factory.objects({endpoint:'https://example.test',region:'local',bucket:'venue-test'}),/backup.storage_configuration/);
  assert.throws(()=>factory.objects({endpoint:'https://localhost:443',region:'other',bucket:'venue-test'}),/backup.storage_configuration/);
  assert(factory.objects({endpoint:'https://localhost:443',region:'local',bucket:'venue-test'}));
 }finally{factory.close();}
 assert.throws(()=>workerObjects({CLOUD_BACKUP_ENDPOINT:'http://localhost',CLOUD_BACKUP_REGION:'local',CLOUD_BACKUP_ACCESS_KEY:'local',CLOUD_BACKUP_SECRET_KEY:'local'}),/backup.storage_configuration/);
 assert.throws(()=>workerObjects({}),/backup.storage_configuration/);
});
