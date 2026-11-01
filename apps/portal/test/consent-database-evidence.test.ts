import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Pool,type PoolClient} from 'pg';
import {database} from '../../../packages/account-http/test/fixtures.ts';
import {failConsentDatabaseWait} from './consent-database-evidence.ts';

async function report(pool:Pool,schema:string){
 const original=new Error('private-original');let value='';
 await assert.rejects(failConsentDatabaseWait(pool,schema,original,text=>{value=text;}),error=>error===original);
 assert.equal(value.includes('private'),false);assert.equal(value.includes(schema),false);
 return JSON.parse(value);
}

test('consent failure evidence sees blocked session and consent queries despite a fully checked-out application pool',async()=>{
 const db=await database(),clients:PoolClient[]=[];
 const pending:Promise<unknown>[]=[];
 try{
  for(let n=0;n<10;n++)clients.push(await db.pool.connect());
  await clients[0]!.query('BEGIN');
  await clients[0]!.query('LOCK TABLE cloud_sessions, translation_consents IN ACCESS EXCLUSIVE MODE');
  pending.push(clients[1]!.query("SELECT count(*) FROM cloud_sessions /* private-session-token */"));
  pending.push(clients[2]!.query("SELECT count(*) FROM translation_consents /* private-consent-value */"));
  // Observe the actual PostgreSQL wait before testing its diagnostic classification.
  for(let n=0;n<100;n++){
   const blocked=await db.secondPool.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[db.schema]);
   if(blocked.rows[0].count===2)break;
   assert.ok(n<99,'both controlled reads must reach their database lock');
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  const result=await report(db.pool,db.schema);
  assert.deepEqual(result.pool,{total:10,idle:0,waiting:0});
  for(const operation of ['session','consent'])assert.ok(result.connections.some((row:any)=>row.operation===operation&&row.state==='active'&&row.waitType==='Lock'&&row.blockedBy===1),operation);
  assert.ok(result.connections.some((row:any)=>row.state==='idle in transaction'));
  assert.equal(result.connections.length,11); // Ten application clients and the independent observation client.
  for(const row of result.connections)assert.deepEqual(Object.keys(row).sort(),['blockedBy','operation','state','waitType']);
 }finally{
  await clients[0]?.query('ROLLBACK');await Promise.allSettled(pending);
  for(const client of clients)client.release();await db.close();
 }
});

test('consent failure evidence excludes another fixture and distinguishes an idle database from a lock wait',async()=>{
 const db=await database(),other=new Pool({...db.pool.options,application_name:'private-other-fixture'});
 try{
  await other.query("SELECT 'private-value' AS private_alias");
  const result=await report(db.pool,db.schema);
  assert.ok(Array.isArray(result.connections),'a reachable database must provide connection evidence');
  assert.equal(result.connections.length,1);
  assert.deepEqual(result.connections[0],{state:'idle',waitType:'Client',blockedBy:0,operation:'idle'});
  assert.equal(result.sampleLimit,20);
 }finally{await other.end();await db.close();}
});

test('consent evidence limits its sample to 20 connections and retains a newer lock waiter',async()=>{
 const db=await database(),pool=new Pool({...db.pool.options,max:22}),clients:PoolClient[]=[];
 let pending:Promise<unknown>|undefined;
 try{
  for(let n=0;n<22;n++)clients.push(await pool.connect());
  await clients[0]!.query('BEGIN');await clients[0]!.query('LOCK TABLE cloud_sessions IN ACCESS EXCLUSIVE MODE');
  pending=clients[21]!.query('SELECT count(*) FROM cloud_sessions');
  for(let n=0;n<100;n++){
   const blocked=await db.secondPool.query("SELECT count(*)::int AS count FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[db.schema]);
   if(blocked.rows[0].count===1)break;
   assert.ok(n<99,'the newest connection must reach its lock wait');await new Promise(resolve=>setTimeout(resolve,10));
  }
  const result=await report(pool,db.schema);
  assert.equal(result.connections.length,20);
  assert.equal(result.connections[0].waitType,'Lock');assert.equal(result.connections[0].blockedBy,1);
 }finally{
  await clients[0]?.query('ROLLBACK');await pending;
  for(const client of clients)client.release();await pool.end();await db.close();
 }
});
