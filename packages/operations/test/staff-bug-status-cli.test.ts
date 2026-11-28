import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {database} from '../../account-http/test/fixtures.ts';
import {bugStatusCommand} from './staff-bug-status-fixture.ts';

test('staff links one exact test report and refreshes it without sending report data', async t => {
 const db = await database();
 try {
  const org = randomUUID(), business = randomUUID(), venue = randomUUID(), installation = randomUUID(), report = randomUUID();
  await db.pool.query("INSERT INTO organisations(id,name) VALUES($1,'Synthetic organisation')", [org]);
  await db.pool.query("INSERT INTO legal_businesses(id,organisation_id,name) VALUES($1,$2,'Synthetic business')", [business,org]);
  await db.pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,environment) VALUES($1,$2,$3,'test')", [venue,org,business]);
  await db.pool.query("INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,'synthetic-key')", [installation,venue]);
  const insert = (id: string, environment: string, body: string|null) => db.pool.query(`INSERT INTO installation_error_reports
   (installation_id,operation_id,environment,digest,kind,version_major,version_minor,version_patch,reported_at,logs,details,staff_report_body,staff_receipt_owner_id)
   VALUES($1,$2,$3,repeat('a',64),'staff',1,2,3,clock_timestamp(),'[]','{}',$4,CASE WHEN $4::text IS NOT NULL THEN $5::uuid END)`, [installation,id,environment,body,org]);
  const old = randomUUID(), production = randomUUID(), exact = '{"description":"Synthetic private diagnostics"}';
  await insert(report,'test',exact);
  await insert(old,'test',null);
  await insert(production,'production',exact);
  const command = await bugStatusCommand(t, db.schema);
  const read = async () => (await db.pool.query(`SELECT bug_issue_repository,bug_issue_number,bug_status,fixed_version,staff_report_body
   FROM installation_error_reports WHERE installation_id=$1 AND operation_id=$2`, [installation,report])).rows[0];
  await command.reply({labels:[{name:'in progress'}]});
  await assert.rejects(command.run(randomUUID(),report));
  await assert.rejects(command.run(installation,old));
  await assert.rejects(command.run(installation,production));
  await assert.rejects(command.run(installation,report,'other/project'));
  await assert.rejects(command.run(installation,report,'clintongormley/waitron','0'));
  await db.pool.query("UPDATE venues SET environment='production' WHERE id=$1", [venue]);
  await assert.rejects(command.run(installation,report));
  assert.equal(await command.calls(),'');
  await db.pool.query("UPDATE venues SET environment='test' WHERE id=$1", [venue]);
  await command.run(installation,report);
  const first = {bug_issue_repository:'clintongormley/waitron',bug_issue_number:18,bug_status:'in_progress',fixed_version:null,staff_report_body:exact};
  assert.deepEqual(await read(),first);
  assert.equal(await command.calls(),'api\n--hostname\ngithub.com\nrepos/clintongormley/waitron/issues/18\n');
  await command.reply({pull_request:{},labels:[{name:'fixed in 9.0.0'}]});
  await assert.rejects(command.run(installation,report));
  assert.deepEqual(await read(),first);
  await command.reply({labels:[{name:'fixed in 1.2.4'}],state:'closed',body:'Ignored GitHub text'});
  const result = await command.run(installation,report,'waitron-io/waitron-cloud','19');
  assert.ok(!result.stdout.includes('Ignored GitHub text'));
  assert.deepEqual(await read(),{...first,bug_issue_repository:'waitron-io/waitron-cloud',bug_issue_number:19,bug_status:'fixed',fixed_version:'1.2.4'});
 } finally { await db.close(); }
});
