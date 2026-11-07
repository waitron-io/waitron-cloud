import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {database} from '../../account-http/test/fixtures.ts';
import {staffProblemReports} from '../src/staff-problem-reports.ts';

const cli=new URL('../src/staff-reports-cli.ts',import.meta.url);
async function command(args:string[],env:NodeJS.ProcessEnv){
 return new Promise<{status:number|null;stdout:string;stderr:string}>((resolve,reject)=>{
  const child=spawn(process.execPath,[cli.pathname,...args],{env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';
  child.stdout.on('data',c=>{stdout+=c;});child.stderr.on('data',c=>{stderr+=c;});child.on('error',reject);child.on('close',status=>resolve({status,stdout,stderr}));
 });
}
test('the local reader lists unmatched reports and groups distinct staff reports with automatic error counts',async()=>{
 const db=await database();try{
  const org=randomUUID(),business=randomUUID(),venue=randomUUID(),installation=randomUUID(),reportId=randomUUID(),emptyId=randomUUID();
  await db.pool.query("INSERT INTO organisations(id,name) VALUES($1,'Synthetic organisation')",[org]);
  await db.pool.query("INSERT INTO legal_businesses(id,organisation_id,name,country_code) VALUES($1,$2,'Synthetic business','ES')",[business,org]);
  await db.pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,local_venue_id,environment) VALUES($1,$2,$3,$4,'test')",[venue,org,business,randomUUID()]);
  await db.pool.query("INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,'synthetic-key')",[installation,venue]);
  const log={level:'error',code:'storage.disk_full',source:'packages/storage/src/archive.ts#write'},details={device:'till',equipment:['printer'],upgradedAt:null,hosting:'unknown'};
  for(const [id,logs,text,at] of [[reportId,[log,log],'Printer stopped\u202e.','2026-11-07T10:00:00Z'],[emptyId,[],null,'2026-11-07T11:00:00Z']] as const){
   await db.pool.query(`INSERT INTO installation_error_reports(installation_id,operation_id,environment,digest,kind,version_major,version_minor,version_patch,reported_at,received_at,logs,details,description)
    VALUES($1,$2,'test',$3,'staff',1,2,3,$4,$4,$5,$6,$7)`,[installation,id,'a'.repeat(64),at,JSON.stringify(logs),JSON.stringify(details),text]);
  }
  for(const [environment,version,count] of [['test',3,5],['production',3,99],['test',4,77]] as const){
   await db.pool.query(`INSERT INTO installation_error_reports(installation_id,operation_id,environment,digest,code,source,version_major,version_minor,version_patch,reported_at,occurrences,logs)
    VALUES($1,$2,$3,$4,'storage.disk_full','packages/storage/src/archive.ts#write',1,2,$5,'2026-11-07T10:00:00Z',$6,'[]')`,[installation,randomUUID(),environment,'b'.repeat(64),version,count]);
  }
  const env={...process.env,DATABASE_URL:process.env.TEST_DATABASE_URL,PGOPTIONS:`-c search_path=${db.schema}`};
  const result=await command(['--environment','test'],env);assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');
  assert.equal(result.stdout.includes('\u202e'),false);assert(result.stdout.includes('\\u202e'));
  const value=JSON.parse(result.stdout);assert.equal(value.environment,'test');assert.equal(value.reports.length,2);
  assert.deepEqual(value.reports.map((r:{reportId:string})=>r.reportId),[emptyId,reportId]);
  assert.deepEqual(value.reports[0].codes,[]);assert.equal(value.reports[1].description,'Printer stopped\u202e.');
  assert.equal(value.reports[1].venueId,venue);assert.deepEqual(value.reports[1].details,details);
  assert.deepEqual(value.groups,[{code:'storage.disk_full',version:'1.2.3',automaticOccurrences:'5',staffReports:1}]);
  const production=await command(['--environment','production'],env);assert.equal(production.status,0,production.stderr);assert.deepEqual(JSON.parse(production.stdout),{environment:'production',reports:[],groups:[]});
  assert.equal((await db.pool.query('SELECT count(*) FROM installation_error_reports')).rows[0].count,'5');
  await db.pool.query(`INSERT INTO installation_error_reports(installation_id,operation_id,environment,digest,kind,version_major,version_minor,version_patch,reported_at,received_at,logs,details)
   SELECT $1,('00000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'test',$2,'staff',1,2,3,'2026-11-07T12:00:00Z','2026-11-07T12:00:00Z',$3,$4
   FROM generate_series(1,101) g`,[installation,'c'.repeat(64),JSON.stringify([{...log,code:'printer.offline'}]),JSON.stringify(details)]);
  let queries=0;
  const counted=new Proxy(db.pool,{get(target,property,receiver){
   if(property==='query')return new Proxy(target.query,{apply(fn,_self,args){queries++;return Reflect.apply(fn,target,args);}});
   return Reflect.get(target,property,receiver);
  }});
  const bounded=await staffProblemReports(counted,'test');assert.equal(queries,2);assert.equal(bounded.reports.length,100);
  assert.equal(bounded.reports[0]!.reportId,'00000000-0000-4000-8000-000000000001');
  assert.equal(bounded.reports[99]!.reportId,'00000000-0000-4000-8000-000000000100');
  assert.deepEqual(bounded.groups,[{code:'printer.offline',version:'1.2.3',automaticOccurrences:'0',staffReports:101}]);
  assert.equal(JSON.stringify(bounded).includes('Synthetic organisation'),false);assert.equal(JSON.stringify(bounded).includes('synthetic-key'),false);
  queries=0;await assert.rejects(staffProblemReports(counted,'unknown' as 'test'));assert.equal(queries,0);
  await db.pool.query('CREATE TABLE read_write_probe(id integer)');
  await db.pool.query('CREATE FUNCTION probe_description(value text) RETURNS text LANGUAGE plpgsql VOLATILE AS $$ BEGIN INSERT INTO read_write_probe VALUES(1); RETURN value; END $$');
  await db.pool.query('ALTER TABLE installation_error_reports RENAME TO stored_error_reports');
  await db.pool.query(`CREATE VIEW installation_error_reports AS SELECT installation_id,operation_id,environment,kind,version_major,version_minor,version_patch,
   reported_at,received_at,logs,details,probe_description(description) AS description,code,occurrences FROM stored_error_reports`);
  const guarded=await command(['--environment','test'],env);assert.equal(guarded.status,1);assert.equal(guarded.stdout,'');
  assert.equal(guarded.stderr,'Staff report read failed; check environment, database and migrations\n');
  assert.equal((await db.pool.query('SELECT count(*) FROM read_write_probe')).rows[0].count,'0');
 }finally{await db.close();}
});

test('the local reader refuses an implicit environment and extra arguments before connecting',async()=>{
 for(const args of [[],['--environment','staging'],['--environment','test','extra']]){
  const result=await command(args,{...process.env,DATABASE_URL:'postgres://synthetic.invalid/unused'});
  assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr,'Staff report read failed; check environment, database and migrations\n');
 }
});
