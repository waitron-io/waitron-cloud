import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import crypto, {createHash} from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import {RelayGrantStore} from '../src/relay-grants.ts';
import {readFile, mkdtemp, copyFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {test, type TestContext} from 'node:test';
import {Pool} from 'pg';
import {migrate, migrationNames} from '../src/migrate.ts';
import {fixture} from './fixtures/relay-worker.ts';

function capture(t:TestContext, broken=false){
 const lines:unknown[][]=[];
 t.mock.method(console,'error',(...args:unknown[])=>{lines.push(args);if(broken)throw new Error('reporter refused');});
 return lines;
}
async function thrown(action:()=>Promise<unknown>){try{await action();}catch(error){return {error};}assert.fail('expected the original failure');}
function database(failAt:number,error:unknown,applied=false){
 const queries:{sql:string,args:unknown}[]=[];let released:unknown;let client:EventEmitter;
 client=Object.assign(new EventEmitter(),{
  async query(sql:string,args?:unknown[]){
   queries.push({sql,args});if(queries.length===failAt)throw error;
   let rows:unknown[]=[];
   if(applied&&sql==='SELECT digest FROM schema_migrations WHERE name = $1'){
    const text=await readFile(new URL(`../migrations/${args![0]}`,import.meta.url),'utf8');
    rows=[{digest:createHash('sha256').update(text).digest('hex')}];
   }
   return {rows,rowCount:rows.length,command:'SELECT',oid:0,fields:[]};
  },release(discard:unknown){released=discard;}
 });
 return {pool:{async connect(){return client;}} as unknown as Pool,queries,client,get released(){return released;}};
}

// Removing a stage assignment or reporting the caught error must break these controls.
for(const [at,stage,ordinal] of [
 [1,'transaction-start',undefined],[2,'advisory-lock',undefined],[3,'ledger-create',undefined],
 [4,'ledger-compatibility',undefined],[5,'migration-lookup',1],[6,'migration-apply',1],
 [7,'migration-record',1],[137,'transaction-finish',undefined],[54,'migration-apply',17],[135,'migration-apply',44],
] as const){
 test(`migration failure names ${stage} ${ordinal??'without ordinal'} and preserves rollback`,async t=>{
  const lines=capture(t);const error=Object.freeze(new Error('private SQL and credential'));
  const db=database(at,error);
  assert.equal((await thrown(()=>migrate(db.pool))).error,error);
  assert.deepEqual(lines,[[JSON.stringify({event:'cloud-migration-setup-failed',stage,...(ordinal===undefined?{}:{migrationOrdinal:ordinal})})]]);
  assert.equal(db.queries.at(-1)!.sql,'ROLLBACK');assert.equal(db.queries.length,at+1);
  assert.equal(db.released,false);assert.equal(db.client.listenerCount('error'),0);
 });
}
test('successful migrations keep query order, SQL, arguments and silence',async t=>{
 const lines=capture(t);const db=database(-1,null);await migrate(db.pool);
 assert.deepEqual(lines,[]);assert.equal(db.queries.length,137);
 assert.equal(db.queries[0]!.sql,'BEGIN');assert.equal(db.queries[1]!.sql,"SELECT pg_advisory_xact_lock(hashtext(current_schema()), hashtext('cloud_migrations'))");
 assert.equal(db.queries[2]!.sql,`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, digest text NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
    )`);
 assert.deepEqual(db.queries[3],{sql:'SELECT name FROM schema_migrations WHERE NOT (name = ANY($1::text[]))',args:[migrationNames]});
 for(let i=0;i<migrationNames.length;i++){
  const name=migrationNames[i];const sql=await readFile(new URL(`../migrations/${name}`,import.meta.url),'utf8');
  assert.deepEqual(db.queries.slice(4+i*3,7+i*3),[
   {sql:'SELECT digest FROM schema_migrations WHERE name = $1',args:[name]},
   {sql,args:undefined},{sql:'INSERT INTO schema_migrations (name, digest) VALUES ($1, $2)',args:[name,createHash('sha256').update(sql).digest('hex')]}
  ]);
 }
 assert.equal(db.queries.at(-1)!.sql,'COMMIT');assert.equal(db.released,false);
});
test('already applied migrations stay silent and retain every lookup without reapplication',async t=>{
 const lines=capture(t);const db=database(-1,null,true);await migrate(db.pool);
 assert.deepEqual(lines,[]);assert.equal(db.queries.length,49);assert.equal(db.queries.at(-1)!.sql,'COMMIT');
});
test('migration reporting never reads hostile thrown values and reporter failure keeps the original',async t=>{
 capture(t,true);const error=new Proxy({}, {get(){assert.fail('diagnostics read caught value');},ownKeys(){assert.fail('diagnostics enumerated caught value');}});
 const db=database(6,error);assert.equal((await thrown(()=>migrate(db.pool))).error,error);assert.equal(db.released,false);
});

function relayDatabase(t:TestContext,failAt:number,error:unknown){
 const queries:{sql:string,args:unknown}[]=[];const ended:Pool[]=[];
 t.mock.method(Pool.prototype,'query',async function(this:Pool,sql:string,args?:unknown[]){
  queries.push({sql,args});if(queries.length===failAt)throw error;
  return {rows:sql==='SELECT clock_timestamp() AS now'?[{now:new Date('2026-10-28T00:00:00Z')}]:[],rowCount:0,command:'SELECT',oid:0,fields:[]};
 });
 t.mock.method(Pool.prototype,'end',async function(this:Pool){ended.push(this);});
 return {queries,ended};
}
for(const [at,stage] of [[1,'create-schema'],[2,'bounds-clock'],[3,'account-insert'],[4,'credential-insert'],[5,'organisation-insert'],[6,'membership-insert'],[7,'business-insert'],[8,'venue-insert'],[9,'installation-insert']] as const){
 test(`relay fixture failure names ${stage} without exposing inputs`,async t=>{
  const lines=capture(t);const error=Object.freeze(new Error('private parameters/schema/account'));
  const db=relayDatabase(t,at,error);
  if(at<=2){assert.equal((await thrown(()=>fixture(async()=>{}))).error,error);assert.equal(db.ended.length,2);}
  else {const f=await fixture(async()=>{});try{assert.equal((await thrown(()=>f.venue())).error,error);assert.equal(db.ended.length,0);}finally{await f.close();}assert.equal(db.ended.length,2);}
  assert.deepEqual(lines,[[JSON.stringify({event:'cloud-relay-fixture-setup-failed',stage})]]);
  assert.match(db.queries[0]!.sql,/^CREATE SCHEMA relay_worker_[a-f0-9]+$/);
  if(at>1)assert.match(db.queries.at(-1)!.sql,/^DROP SCHEMA relay_worker_[a-f0-9]+ CASCADE$/);
  if(at>=3){assert.equal(db.queries[2]!.sql,'INSERT INTO cloud_accounts(id) VALUES($1)');assert.equal((db.queries[2]!.args as string[]).length,1);}
 });
}
test('relay initialise failure is labelled before cleanup and preserves a simultaneous cleanup failure',async t=>{
 const lines=capture(t);const original=new Error('private migration');const cleanup=new Error('private cleanup');
 const db=relayDatabase(t,2,cleanup);
 const error=(await thrown(()=>fixture(async()=>{throw original;}))).error;
 assert.ok(error instanceof AggregateError);assert.equal(error.cause,original);assert.deepEqual(error.errors,[original,cleanup]);assert.equal(db.ended.length,2);
 assert.deepEqual(lines,[[JSON.stringify({event:'cloud-relay-fixture-setup-failed',stage:'migrate'})]]);
});
test('successful relay fixture setup and cleanup are silent and retain the statement limit',async t=>{
 const lines=capture(t);const db=relayDatabase(t,-1,null);const f=await fixture(async pool=>{
  assert.match(pool.options.options!,/^-c search_path=relay_worker_[a-f0-9]+ -c statement_timeout=5000$/);
 });await f.close();assert.deepEqual(lines,[]);assert.equal(db.ended.length,2);assert.equal(db.queries.length,3);
});

test('relay reporting cannot read a hostile error or replace it when the reporter throws',async t=>{
 capture(t,true);const error=new Proxy({}, {get(){assert.fail('relay read caught value');},ownKeys(){assert.fail('relay enumerated caught value');}});
 const db=relayDatabase(t,3,error);const f=await fixture(async()=>{});
 try{assert.equal((await thrown(()=>f.venue())).error,error);}finally{await f.close();}
 assert.equal(db.ended.length,2);
});
test('migration connection refusal reports no ordinal and keeps the caught value',async t=>{
 const lines=capture(t);const error=Object.freeze(new Error('private connection'));
 assert.equal((await thrown(()=>migrate({connect:async()=>{throw error;}} as unknown as Pool))).error,error);
 assert.deepEqual(lines,[[JSON.stringify({event:'cloud-migration-setup-failed',stage:'transaction-start'})]]);
});
for(const [connection,stage] of [[1,'session-create'],[2,'grant-approve']] as const){
 test(`relay fixture distinguishes ${stage} transaction connection refusal`,async t=>{
  const lines=capture(t);const error=new Error('private connection');const db=relayDatabase(t,-1,null);let calls=0;
  const queries:string[]=[];const client=Object.assign(new EventEmitter(),{
   async query(sql:string){queries.push(sql);return {rows:[],rowCount:1,command:'SELECT',oid:0,fields:[]};},release(){}
  });
  t.mock.method(Pool.prototype,'connect',async()=>{if(++calls===connection)throw error;return client;});
  const f=await fixture(async()=>{});try{assert.equal((await thrown(()=>f.venue())).error,error);}finally{await f.close();}
  assert.deepEqual(lines,[[JSON.stringify({event:'cloud-relay-fixture-setup-failed',stage})]]);
  assert.equal(db.ended.length,2);
  if(connection===2){assert.equal(queries[0],'BEGIN');assert.equal(queries.at(-1),'COMMIT');assert.equal(queries.length,4);}
 });
}
test('concurrent relay venue failures keep their own setup stage',async t=>{
 const lines=capture(t);relayDatabase(t,-1,null);const errorA=new Error('private A'),errorB=new Error('private B');
 const f=await fixture(async()=>{});const query=f.pool.query.bind(f.pool);let accounts=0;let entered!:()=>void;let release!:()=>void;
 const started=new Promise<void>(resolve=>{entered=resolve;});const gate=new Promise<void>(resolve=>{release=resolve;});
 t.mock.method(f.pool,'query',async(sql:string,args:unknown[])=>{
  if(sql==='INSERT INTO cloud_accounts(id) VALUES($1)'&&++accounts===1){entered();await gate;throw errorA;}
  if(sql.startsWith('INSERT INTO cloud_credentials'))throw errorB;
  return query(sql,args);
 });
 try{
  const a=thrown(()=>f.venue());await started;assert.equal((await thrown(()=>f.venue())).error,errorB);release();assert.equal((await a).error,errorA);
 }finally{release();await f.close();}
 assert.deepEqual(lines,[[JSON.stringify({event:'cloud-relay-fixture-setup-failed',stage:'credential-insert'})],[JSON.stringify({event:'cloud-relay-fixture-setup-failed',stage:'account-insert'})]]);
});

test('an unreadable migration names its load boundary without publishing the filesystem error',async t=>{
 const lines=capture(t);const root=await mkdtemp(join(tmpdir(),'cloud-migration-read-'));
 try{
  for(const name of ['migrate.ts','transaction.ts'])await copyFile(new URL('../src/'+name,import.meta.url),join(root,name));
  const isolated=await import(pathToFileURL(join(root,'migrate.ts')).href);const db=database(-1,null);
  const error=(await thrown(()=>isolated.migrate(db.pool))).error;
  assert.equal((error as NodeJS.ErrnoException).code,'ENOENT');
  assert.deepEqual(lines,[[JSON.stringify({event:'cloud-migration-setup-failed',stage:'migration-load',migrationOrdinal:1})]]);
  assert.equal(db.queries.at(-1)!.sql,'ROLLBACK');assert.equal(db.released,false);
 }finally{await rm(root,{recursive:true,force:true});}
});

for(const [method,stage,queries] of [['generateKeyPairSync','issuer-create',1],['randomBytes','relay-config',2]] as const){
 test(`relay preparation failure names ${stage} after the preceding database step succeeded`,async t=>{
  const lines=capture(t);const error=new Error('private preparation failure');const db=relayDatabase(t,-1,null);
  const patched=t.mock.method(crypto,method,()=>{throw error;});syncBuiltinESMExports();
  try{
   assert.equal((await thrown(()=>fixture(async()=>{}))).error,error);
   assert.deepEqual(lines,[[JSON.stringify({event:'cloud-relay-fixture-setup-failed',stage})]]);
   assert.equal(db.ended.length,2);assert.equal(db.queries.length,queries+1);
  }finally{patched.mock.restore();syncBuiltinESMExports();}
 });
}
test('venue key preparation failure is distinct from account insertion',async t=>{
 const lines=capture(t);const error=new Error('private signing key');const db=relayDatabase(t,-1,null);const f=await fixture(async()=>{});
 const patched=t.mock.method(crypto,'generateKeyPairSync',()=>{throw error;});syncBuiltinESMExports();
 try{
  assert.equal((await thrown(()=>f.venue())).error,error);
  assert.deepEqual(lines,[[JSON.stringify({event:'cloud-relay-fixture-setup-failed',stage:'venue-prepare'})]]);
  assert.equal(db.queries.length,2);
 }finally{patched.mock.restore();syncBuiltinESMExports();await f.close();}
});
test('lease construction failure is distinct from the successfully approved grant',async t=>{
 const lines=capture(t);const error=new Error('private lease');relayDatabase(t,-1,null);const f=await fixture(async()=>{});
 const client=Object.assign(new EventEmitter(),{async query(){return {rows:[],rowCount:1,command:'SELECT',oid:0,fields:[]};},release(){}});
 t.mock.method(Pool.prototype,'connect',async()=>client);
 t.mock.method(RelayGrantStore.prototype,'approve',async()=>({id:'controlled-grant'} as any));
 t.mock.method(f.issuer,'issue',()=>{throw error;});
 try{
  assert.equal((await thrown(()=>f.venue())).error,error);
  assert.deepEqual(lines,[[JSON.stringify({event:'cloud-relay-fixture-setup-failed',stage:'lease-build'})]]);
 }finally{await f.close();}
});
