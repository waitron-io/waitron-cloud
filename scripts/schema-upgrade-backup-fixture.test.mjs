import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {database} from '../packages/account-http/test/fixtures.ts';
import {seed,seedAccountState} from './schema-upgrade-fixture.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
test('backup upgrade fixture proves legacy refusal, actual key unsealing and exact recovery evidence, and detects lost state',async()=>{
 const path=new URL('./schema-upgrade-backup-fixture.mjs',import.meta.url);
 const {existsSync}=await import('node:fs');assert(existsSync(path),'backup upgrade fixture is missing');
 const fixture=await import(path.href),db=await database();
 try{
  const email={activeKeyId:'fixture',keys:{fixture:randomBytes(32).toString('hex')}},pairing={activeKeyId:'pair',keys:{pair:randomBytes(32).toString('hex')}};
  const state=await seed(root,db.pool,email,pairing);await seedAccountState(root,db.pool,state);
  await fixture.seedBackupMonitoring(root,db.pool,email);
  assert.notEqual((await db.pool.query('SELECT count(*) FROM venue_alert_episodes')).rows[0].count,'0');
  const proof=await fixture.seedLegacyBackups(root,db.pool,state);
  const legacy=await fixture.upgradedBackups(root,db.pool,state,proof);
  assert.deepEqual(legacy,{legacyUnqualified:true,historyPreserved:true,keysPreserved:true,holdsPreserved:true});
  const fresh=await fixture.freshBackupEvidence(root,db.pool,state,proof);
  assert.deepEqual(fresh,{freshEvidence:true,v2Binding:true});
  const before=await fixture.backupState(db.pool);
  assert.deepEqual(await fixture.restoredBackups(root,db.pool,proof,before),{restoredEvidence:true,restoredHistory:true,restoredKeys:true,restoredHolds:true,restoredV2Binding:true,restoredLegacyUnqualified:true});
  for(const sql of ["UPDATE backup_points SET verification='pending' WHERE id=$1","DELETE FROM backup_verifications WHERE point_id=$1","UPDATE backup_key_versions SET sealed='broken' WHERE venue_id=$1","DELETE FROM backup_recoveries WHERE id=$1"]){
   const client=await db.pool.connect();await client.query('BEGIN');
   try{
    const value=sql.includes('backup_key_versions')?proof.venueId:sql.includes('backup_recoveries')?proof.holdId:proof.pointId;
    await client.query(sql,[value]);await assert.rejects(fixture.restoredBackups(root,client,proof,before));
   }finally{await client.query('ROLLBACK');client.release();}
  }
 }finally{await db.close();}
});
