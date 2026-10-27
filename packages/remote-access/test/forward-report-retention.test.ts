import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {forwardFixture} from './fixtures/forward-observations.ts';
// @ts-ignore The backup driver and this restore proof share the actual dump policy.
import {privateObservationDumpArgs} from '../../../scripts/database-backup-policy.mjs';

test('expiry_and_prune and unlogged_loss_is_unknown preserve durable reporter ordering',async()=>{
 const f=await forwardFixture();try{
  await f.send();const observed=Date.now()-301000;await f.db.pool.query('UPDATE remote_forward_observations SET observed_at=$1,expires_at=$2,manifest_expires_at=$3',[new Date(observed),new Date(observed+300000),new Date(observed+600000)]);
  assert.equal(await f.read(),null);assert.equal(await f.store.prune(f.cellId),1);assert.equal(await f.store.prune(f.cellId),0);
  await f.budget();await f.send(f.report(2));await f.db.pool.query('TRUNCATE remote_forward_observations');assert.equal(await f.read(),null);
  assert.equal((await f.db.pool.query('SELECT last_sequence FROM remote_forward_reporters')).rows[0].last_sequence,'2');
 }finally{await f.db.close();}
});
test('logical_restore_contains_no_causes but retains reporter authority and cursor',async()=>{
 const f=await forwardFixture();const restored='forward_restore_'+randomUUID().replaceAll('-','');let container:string|undefined,created=false;
 const docker=(args:string[],input?:Buffer)=>execFileSync('docker',args,{input,timeout:30000,maxBuffer:16*1024*1024});
 try{
  await f.send();const url=new URL(process.env.TEST_DATABASE_URL!);
  const candidates=docker(['ps','--filter','ancestor=postgres:18-alpine','--format','{{.ID}}']).toString().trim().split('\n').filter(Boolean);
  for(const id of candidates){const inspect=JSON.parse(docker(['inspect',id]).toString())[0];if(inspect.NetworkSettings.Ports['5432/tcp']?.some((p:{HostPort:string})=>p.HostPort===url.port)){container=id;break;}}
  assert(container,'locate only the PostgreSQL fixture bound to this test URL');
  const dump=docker(['exec',container,'pg_dump','-U','postgres','-d',url.pathname.slice(1),'-Fc','--schema='+f.db.schema,...privateObservationDumpArgs]);
  const control=docker(['exec',container,'pg_dump','-U','postgres','-d',url.pathname.slice(1),'-Fc','--schema='+f.db.schema]);
  const list=(data:Buffer)=>docker(['exec','-i',container!,'pg_restore','--list'],data).toString();
  assert.match(list(control),/TABLE DATA .* remote_forward_observations /);assert.doesNotMatch(list(dump),/TABLE DATA .* remote_forward_observations /);
  docker(['exec',container,'createdb','-U','postgres',restored]);created=true;
  docker(['exec','-i',container,'pg_restore','-U','postgres','-d',restored,'--exit-on-error'],dump);
  const sql=`SELECT count(*) FROM ${f.db.schema}.remote_forward_observations; SELECT last_sequence FROM ${f.db.schema}.remote_forward_reporters;`;
  assert.equal(docker(['exec',container,'psql','-U','postgres','-d',restored,'-Atc',sql]).toString(),'0\n1\n');
 }finally{if(created)docker(['exec',container!,'dropdb','-U','postgres',restored]);await f.db.close();}
});
