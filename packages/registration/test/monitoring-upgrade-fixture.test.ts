import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {randomBytes} from 'node:crypto';
import {fixture} from './fixtures/relay-worker.ts';
import {migrationRelease} from './fixtures/migration-release.ts';
import {migrate} from '../src/migrate.ts';
const root=new URL('../../../',import.meta.url).pathname;
const release=await migrationRelease(36);after(()=>release.close());
test('monitoring upgrade fixture preserves legacy payloads and restored deadlines, recipients and late receipts',async()=>{
 const f=await fixture(release.migrate);
 try{
  const {seed}=await import(new URL('../../../scripts/schema-upgrade-fixture.mjs',import.meta.url).href);
  const {seedMonitoring,monitoringState,legacyMonitoring,restoredMonitoring}=await import(new URL('../../../scripts/schema-upgrade-monitoring-fixture.mjs',import.meta.url).href);
  const email={activeKeyId:'upgrade',keys:{upgrade:randomBytes(32).toString('hex')}},pairing={activeKeyId:'pairing',keys:{pairing:randomBytes(32).toString('hex')}};
  const state=await seed(root,f.pool,email,pairing);await seedMonitoring(root,f.pool,state,email);
  const old=await monitoringState(f.pool);await migrate(f.pool);
  assert.deepEqual((await monitoringState(f.pool)).mail,old.mail,'migration never rewrites delivery payloads or receipts');
  await f.pool.query('UPDATE installations SET last_contact_at=clock_timestamp() WHERE id=$1',[state.installations[0].installationId]);
  await legacyMonitoring(root,f.pool,email);
  const {EmailOutbox}=await import('../src/email-outbox.ts');
  const legacyRecovery=(await f.pool.query("SELECT e.* FROM email_outbox e JOIN service_alert_deliveries d ON d.outbox_id=e.id WHERE d.state='recovered'")).rows;
  assert.ok(legacyRecovery.length>0);for(const row of legacyRecovery){const message=new EmailOutbox(email).open(row);assert('state' in message);assert.equal(message.state,'recovered');}
  const proof=await seedMonitoring(root,f.pool,state,email),before=await monitoringState(f.pool);
  const result=await restoredMonitoring(root,f.pool,proof,email);
  assert.deepEqual(result,{deadlinesPreserved:true,recipientSnapshotPreserved:true,lateReceiptRecovery:true,restoredMatchingKeys:true,restoredWrongKeysRefused:true,restoredMissingKeysRefused:true});
  assert.ok(before.episodes.some((e:{quiet_seconds:number})=>e.quiet_seconds===120));assert.ok(before.recipients.some((r:{reminder_due_at:Date|null})=>r.reminder_due_at!==null));
 }finally{await f.close();}
});
