import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {Pool} from 'pg';
import {test} from 'node:test';
import * as fixtures from './fixtures/venue-service.ts';

test('template-backed venue fixtures isolate data and keep every migration',async()=>{
 assert.equal(typeof fixtures.createVenueServiceTemplate,'function','the guard wrapper needs an owned migrated template');
 const template=await fixtures.createVenueServiceTemplate();
 const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
 let first:Awaited<ReturnType<typeof fixtures.venueServiceFixture>>|undefined,second:typeof first;
 const databases:string[]=[];
 try{
  first=await fixtures.venueServiceFixture(template.name);
  second=await fixtures.venueServiceFixture(template.name);
  for(const f of [first,second]){
   const db=(await f.pool.query('SELECT current_database() AS name')).rows[0].name as string;
   databases.push(db);assert.match(db,/^venue_service_clone_[a-f0-9]{8}_[a-f0-9]{32}$/);
   assert.ok(db.startsWith('venue_service_clone_'+template.name.slice(-8)+'_'));
   assert.equal((await f.pool.query('SELECT count(*) AS n FROM schema_migrations')).rows[0].n,'51');
   assert.equal((await f.pool.query('SELECT current_schema() AS name')).rows[0].name,f.schema);
  }
  assert.notEqual(databases[0],databases[1]);
  const marker=randomUUID();await first.pool.query('INSERT INTO organisations(id) VALUES($1)',[marker]);
  assert.equal((await second.pool.query('SELECT id FROM organisations WHERE id=$1',[marker])).rowCount,0);
  await first.close();first=undefined;
  assert.equal((await second.pool.query('SELECT count(*) AS n FROM venues')).rows[0].n,'5');
  await second.close();second=undefined;
  assert.equal((await admin.query('SELECT datname FROM pg_database WHERE datname=ANY($1::text[])',[databases])).rowCount,0);
 }finally{await first?.close();await second?.close();await template.close();await admin.end();}
});

test('the guard child verifies template migration digests and cleans a refused clone',async()=>{
 const template=await fixtures.createVenueServiceTemplate(),admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
 const poison=new Pool({connectionString:template.connectionString,options:'-c search_path=venue_service_seed'});
 try{
  await poison.query("UPDATE schema_migrations SET digest='invalid' WHERE name='001_registration.sql'");await poison.end();
  const env:NodeJS.ProcessEnv={...process.env,TEST_VENUE_SERVICE_TEMPLATE:template.name};delete env.NODE_TEST_CONTEXT;
  const result=await promisify(execFile)(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=^legacy remote eligibility waits for first enrolment$','test/venue-service-legacy-locks.test.ts'],{cwd:fileURLToPath(new URL('../../remote-access/',import.meta.url)),env})
   .then(r=>({code:0,output:r.stdout+r.stderr}),e=>({code:e.code,output:e.stdout+e.stderr}));
  assert.equal(result.code,1,'the real guard child must refuse a stale template: '+result.output);
  assert.match(result.output,/Applied migration has changed: 001_registration.sql/);
  const prefix='venue_service_clone_'+template.name.slice(-8)+'_';
  assert.equal((await admin.query('SELECT datname FROM pg_database WHERE left(datname,length($1))=$1',[prefix])).rowCount,0);
 }finally{if(!poison.ended)await poison.end();await template.close();await admin.end();}
});
