import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {lstat,mkdtemp,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {transaction} from '@waitron-cloud/registration';
import {venueServiceFixture,set} from '../../registration/test/fixtures/venue-service.ts';
import {RemoteAccessStore} from '../src/placement.ts';
import {registerForwardReporter} from '../src/forward-observations.ts';
import {TrafficCoverageStore,type TrafficMapping} from '../src/traffic-coverage.ts';
import {signManifest,type ReportingGatewayManifest} from '../src/manifest.ts';
import {TrafficChildJournal} from '../src/traffic-child-journal.ts';
import {TrafficSpool} from '../src/traffic-spool.ts';
import {TrafficSampler} from '../src/traffic-sampler.ts';
import {sendTrafficLifetime,serveTrafficLifetimes} from '../src/traffic-lifetime-transport.ts';
import {signTrafficLifecycle,verifyTrafficLifecycle} from '../src/traffic-lifecycle.ts';
import {cliEnvironment} from './fixtures/cli-environment.ts';

async function fixture(){
 const f=await venueServiceFixture();let root:string|undefined;
 try{
  await set(f,'connected');root=await realpath(await mkdtemp(join(tmpdir(),'ls-')));
  const cellId=randomUUID(),gatewayId=randomUUID(),keys=generateKeyPairSync('ed25519'),issuer=generateKeyPairSync('ed25519');
  const coverage=new TrafficCoverageStore(f.pool),remote=new RemoteAccessStore(f.pool,'test-venue-levels',coverage);
  await remote.createCell({id:cellId,country:'ES',provider:'aws',environment:'test',suffix:'lifetimes.example.test',subnet:24,publicKey:randomBytes(32).toString('base64'),endpoint:'gateway.example.test:51820'});
  const installationId=(await f.pool.query('SELECT id FROM installations WHERE venue_id=$1 AND revoked_at IS NULL',[f.venues[0]])).rows[0].id;
  await remote.provision(installationId,cellId,randomBytes(32).toString('base64'));
  await transaction(f.pool,c=>registerForwardReporter(c,{cellId,gatewayId,generation:1,publicKey:keys.publicKey.export({type:'spki',format:'pem'}).toString()}));
  let manifest:ReportingGatewayManifest;await remote.publishReportingManifest(cellId,async m=>{manifest=m as ReportingGatewayManifest;});
  const startedAt=new Date(manifest!.issuedAt).toISOString(),envelope=signManifest(manifest!,issuer.privateKey,manifest!.issuedAt),processId=randomUUID();
  const mapping:TrafficMapping={country:'ES',environment:'test',cellId,directory:join(root,'reports'),writerUid:process.geteuid!(),readerGid:process.getegid!()};
  const options={directory:join(root,'journal'),country:'ES' as const,environment:'test' as const,cellId,issuerKey:issuer.publicKey,reporterKey:keys.privateKey};
  const journal=new TrafficChildJournal(options),start=await journal.prepare({manifest:envelope,processId,startedAt,predecessorId:null});
  const spool=new TrafficSpool({directory:join(root,'spool'),maxBytes:32768}),sampler=new TrafficSampler({spool,envelope,issuerKey:issuer.publicKey,cellId,processId,startedAt,key:keys.privateKey,fresh:true});
  const socket=join(root,'country.sock');
  const rows=async()=>(await f.pool.query('SELECT to_jsonb(t) AS row FROM remote_traffic_processes t ORDER BY process_id')).rows;
  async function finish(){
   const id=installationId.replaceAll('-',''),csv=`# pxname,svname,bin,bout\ntraffic_user_staff_${id},BACKEND,0,0\ntraffic_user_public_${id},BACKEND,0,0\n`;
   const until=new Date(Date.parse(startedAt)+1).toISOString();await sampler.sample(csv,until);return journal.finish(spool,until);
  }
  return {...f,root,socket,mapping,keys,coverage,options,journal,start,processId,startedAt,rows,finish,
   async close(){try{await f.close();}finally{await rm(root!,{recursive:true,force:true});}}};
 }catch(e){await f.close();if(root)await rm(root,{recursive:true,force:true});throw e;}
}
async function command(f:Awaited<ReturnType<typeof fixture>>){
 const config=join(f.root,'config.json');await writeFile(config,JSON.stringify({socket:f.socket,mappings:[f.mapping]}),{mode:0o600});
 const url=new URL(process.env.TEST_DATABASE_URL!);url.searchParams.set('options','-c search_path='+f.schema);const application='lifetime-cli-'+randomUUID();url.searchParams.set('application_name',application);
 const child=spawn(process.execPath,[fileURLToPath(new URL('../src/traffic-lifetime-cli.ts',import.meta.url)),config],{env:cliEnvironment({DATABASE_URL:url.toString()}),stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
 const exited=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(r=>child.once('exit',(code,signal)=>r({code,signal}))),timer=setTimeout(()=>child.kill('SIGKILL'),20000);
 const stop=async()=>{if(child.exitCode===null&&child.signalCode===null&&!child.killed)child.kill('SIGTERM');const result=await exited;clearTimeout(timer);assert.deepEqual(result,{code:0,signal:null});assert.equal(stdout,'');assert.equal(stderr,'');};
 let ready=false;for(let n=0;n<200;n++){ready=await lstat(f.socket).then(s=>s.isSocket()&&(s.mode&0o7777)===0o600).catch(()=>false);if(ready||child.exitCode!==null)break;await delay(10);}
 if(!ready){child.kill('SIGKILL');await exited;clearTimeout(timer);assert.fail('lifetime command did not bind: '+stderr);}
 return {child,exited,application,stop};
}

// Losing the DB call, choosing a different schema or acknowledging refusal loses the journal's exact records.
test('separate country process commits exact journal start and final sample boundaries',async()=>{
 const f=await fixture();let c:Awaited<ReturnType<typeof command>>|undefined;
 try{
  c=await command(f);await f.journal.flush(e=>sendTrafficLifetime(f.socket,e));assert.deepEqual(await f.journal.pending(),[]);
  const first=await f.rows();assert.equal(first.length,1);assert.equal(first[0].row.process_id,f.processId);assert.equal(first[0].row.start_payload,f.start.payload);assert.equal(first[0].row.start_signature,f.start.signature);assert.equal(first[0].row.ended_at,null);
  const end=await f.finish();await f.journal.flush(e=>sendTrafficLifetime(f.socket,e));const rows=await f.rows();assert.equal(rows.length,1);assert.equal(rows[0].row.end_payload,end.payload);assert.equal(rows[0].row.end_signature,end.signature);assert.equal(rows[0].row.final_sequence,1);assert.deepEqual(await f.journal.pending(),[]);
  await transaction(f.pool,client=>registerForwardReporter(client,{cellId:f.mapping.cellId,gatewayId:randomUUID(),generation:2,publicKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}).toString()}));
  await sendTrafficLifetime(f.socket,f.start);await sendTrafficLifetime(f.socket,end);assert.deepEqual(await f.rows(),rows);
  const forged=signTrafficLifecycle(verifyTrafficLifecycle(f.start,f.keys.publicKey),generateKeyPairSync('ed25519').privateKey);
  await assert.rejects(sendTrafficLifetime(f.socket,forged),/^Error: traffic_lifetime_transport_unavailable$/);assert.deepEqual(await f.rows(),rows);
  assert.equal((await f.pool.query('SELECT count(*) FROM usage_events')).rows[0].count,'0');assert.equal((await f.pool.query('SELECT count(*) FROM remote_traffic_reports')).rows[0].count,'0');
 }finally{try{await c?.stop();}finally{await f.close();}}
});
test('country rollback retains the exact pending end until a process retry commits',async()=>{
 const f=await fixture();let c:Awaited<ReturnType<typeof command>>|undefined;
 try{
  c=await command(f);await f.journal.flush(e=>sendTrafficLifetime(f.socket,e));const end=await f.finish(),before=await f.rows();
  await f.pool.query(`CREATE FUNCTION refuse_lifetime_end() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private-canary'; END $$`);
  await f.pool.query('CREATE TRIGGER refuse_lifetime_end BEFORE UPDATE ON remote_traffic_processes FOR EACH ROW EXECUTE FUNCTION refuse_lifetime_end()');
  await assert.rejects(f.journal.flush(e=>sendTrafficLifetime(f.socket,e)),/^Error: traffic_child_journal_unavailable$/);assert.deepEqual(await f.rows(),before);assert.deepEqual(await f.journal.pending(),[end]);
  await f.pool.query('DROP TRIGGER refuse_lifetime_end ON remote_traffic_processes');await new TrafficChildJournal(f.options).flush(e=>sendTrafficLifetime(f.socket,e));assert.deepEqual(await f.journal.pending(),[]);
  const rows=await f.rows();assert.equal(rows[0].row.end_payload,end.payload);assert.equal(rows[0].row.final_sequence,1);
 }finally{try{await c?.stop();}finally{await f.close();}}
});
test('real country commit with lost reply retries against another pool without changing stored history',async()=>{
 const f=await fixture();let server:Awaited<ReturnType<typeof serveTrafficLifetimes>>|undefined;
 try{
  let lose=true;server=await serveTrafficLifetimes({socket:f.socket,mappings:[f.mapping],store:{async recordLifecycle(m,e){await f.coverage.recordLifecycle(m,e);if(lose)throw Error('lost-committed-reply');}}});
  await assert.rejects(f.journal.flush(e=>sendTrafficLifetime(f.socket,e)),/^Error: traffic_child_journal_unavailable$/);const before=await f.rows();assert.equal(before.length,1);assert.deepEqual(await f.journal.pending(),[f.start]);
  lose=false;await server.close();server=await serveTrafficLifetimes({socket:f.socket,mappings:[f.mapping],store:new TrafficCoverageStore(f.peer)});
  await new TrafficChildJournal(f.options).flush(e=>sendTrafficLifetime(f.socket,e));assert.deepEqual(await f.rows(),before);assert.deepEqual(await f.journal.pending(),[]);
 }finally{try{await server?.close();}finally{await f.close();}}
});
test('country command signal drains a database-blocked journal acknowledgement',async()=>{
 const f=await fixture(),lock=await f.peer.connect();let c:Awaited<ReturnType<typeof command>>|undefined,pending:Promise<void>|undefined;
 try{
  c=await command(f);await lock.query('BEGIN');await lock.query('SELECT * FROM remote_forward_reporters FOR UPDATE');
  pending=f.journal.flush(e=>sendTrafficLifetime(f.socket,e));let waiting=false;
  for(let n=0;n<150;n++){waiting=(await f.peer.query("SELECT count(*)::integer AS n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[c.application])).rows[0].n===1;if(waiting)break;await delay(10);}
  assert.equal(waiting,true);c.child.kill('SIGTERM');await delay(100);assert.equal(c.child.exitCode,null);assert.equal((await f.rows()).length,0);await lock.query('COMMIT');
  await pending;await c.stop();c=undefined;assert.deepEqual(await f.journal.pending(),[]);const rows=await f.rows();assert.equal(rows.length,1);assert.equal(rows[0].row.start_payload,f.start.payload);
 }finally{await lock.query('ROLLBACK');lock.release();await pending?.catch(()=>{});try{await c?.stop();}finally{await f.close();}}
});
