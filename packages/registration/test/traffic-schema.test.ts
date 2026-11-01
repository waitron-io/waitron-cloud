import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {venueServiceFixture} from './fixtures/venue-service.ts';

// Raw SQL must not rebind measured bytes, erase missing coverage or detach history from its parents.
async function fixture(){
 const f=await venueServiceFixture();
 try{
  const cell=randomUUID(),gateway=randomUUID(),process=randomUUID();
  await f.pool.query("INSERT INTO remote_cells(id,country,provider,environment,suffix,subnet,public_key,endpoint) VALUES($1,'ES','aws','test','traffic.test',13,'fixture-key','fixture-endpoint')",[cell]);
  const installation=(await f.pool.query('SELECT id FROM installations WHERE venue_id=$1 AND revoked_at IS NULL',[f.venues[0]])).rows[0].id as string;
  const publicKey=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}).toString();
  const processRow={cell_id:cell,gateway_id:gateway,generation:'1',process_id:process,reporter_public_key:publicKey,
   start_manifest_digest:'a'.repeat(64),started_at:'2026-11-01T00:00:00.000Z',start_payload:'e30',start_signature:'a'.repeat(86),last_until:'2026-11-01T00:00:00.000Z'};
  const sampleRow={cell_id:cell,gateway_id:gateway,generation:'1',process_id:process,sequence:'1',organisation_id:f.scope.organisationId,
   legal_business_id:f.scope.legalBusinessId,venue_id:f.venues[0],installation_id:installation,configuration_revision:'0',route_binding:'b'.repeat(64),channel:'staff',
   from_at:'2026-11-01T23:59:59.000Z',until_at:'2026-11-02T00:00:00.000Z',complete:true,ingress:'10',egress:'25',
   report_digest:'c'.repeat(64),report_payload:'e30',report_signature:'a'.repeat(86)};
  const coverageRow={cell_id:cell,gateway_id:gateway,generation:'1',manifest_digest:'a'.repeat(64),manifest_sequence:'1',
   issued_at:'2026-11-01T00:00:00.000Z',expires_at:'2026-11-01T00:10:00.000Z',kind:'route',organisation_id:f.scope.organisationId,
   legal_business_id:f.scope.legalBusinessId,venue_id:f.venues[0],installation_id:installation,configuration_revision:'0',route_binding:'b'.repeat(64),channel:'staff'};
  const insert=async(table:string,row:Record<string,unknown>)=>f.pool.query(`INSERT INTO ${table}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map((_,i)=>'$'+(i+1)).join(',')}) RETURNING *`,Object.values(row));
  return {...f,cell,gateway,process,processRow,sampleRow,coverageRow,insert,
   processInsert(value:Record<string,unknown>={}){return insert('remote_traffic_processes',{...processRow,...value});},
   sampleInsert(value:Record<string,unknown>={}){return insert('remote_traffic_samples',{...sampleRow,...value});},
   coverageInsert(value:Record<string,unknown>={}){return insert('remote_traffic_coverage',{...coverageRow,...value});}};
 }catch(error){await f.close();throw error;}
}

test('traffic schema retains exact source identity midnight attribution and immutable aggregate history',async()=>{
 const f=await fixture();try{
  await f.processInsert();const sample=(await f.sampleInsert()).rows[0];
  assert.equal(sample.source_reference,`${f.process}:1:${f.sampleRow.installation_id}:staff`);
  assert.equal((await f.pool.query('SELECT day::text AS day FROM remote_traffic_samples')).rows[0].day,'2026-11-02');assert.equal(sample.ingress,'10');assert.equal(sample.egress,'25');
  await assert.rejects(f.sampleInsert(),{code:'23505'});
  for(const sql of ['UPDATE remote_traffic_samples SET ingress=11','DELETE FROM remote_traffic_samples'])await assert.rejects(f.pool.query(sql),{code:'55000'});
  await assert.rejects(f.pool.query('DELETE FROM remote_cells WHERE id=$1',[f.cell]),{code:'23503'});
  await assert.rejects(f.pool.query('DELETE FROM installations WHERE id=$1',[f.sampleRow.installation_id]),{code:'23503'});
 }finally{await f.close();}
});

test('traffic schema refuses fractional overflow crossed scope and unbound process samples',async()=>{
 const f=await fixture();try{
  await f.processInsert();
  for(const change of [{generation:'0'},{sequence:'0'},{sequence:'1.5'},{configuration_revision:'-1'},{ingress:'0.5'},
   {ingress:'-1'},{ingress:'9223372036854775807',egress:'1'},{channel:'operational'},{from_at:f.sampleRow.until_at},
   {until_at:'infinity'},{report_digest:'invalid'},{report_signature:'bad'}])await assert.rejects(f.sampleInsert(change),{code:'23514'});
  for(const change of [{organisation_id:f.foreign.organisationId},{legal_business_id:f.other.legalBusinessId},{venue_id:f.venues[1]},
   {process_id:randomUUID()},{cell_id:randomUUID()}])await assert.rejects(f.sampleInsert(change),{code:'23503'});
  assert.equal((await f.pool.query('SELECT count(*) FROM remote_traffic_samples')).rows[0].count,'0');
  const max=(await f.sampleInsert({ingress:'9223372036854775807',egress:'0'})).rows[0];assert.equal(max.ingress,'9223372036854775807');
 }finally{await f.close();}
});

test('traffic process checkpoints advance contiguously without losing a gap or changing signed start facts',async()=>{
 const f=await fixture();try{
  await f.processInsert();
  for(const change of ["last_sequence=2,last_until='2026-11-01T00:00:01Z'","last_sequence=1,last_until=started_at","process_id=gen_random_uuid()","reporter_public_key='other'","start_payload='e31'"])
   await assert.rejects(f.pool.query('UPDATE remote_traffic_processes SET '+change),{code:'55000'});
  await f.pool.query("UPDATE remote_traffic_processes SET last_sequence=1,last_until='2026-11-01T00:00:01Z',has_gap=true");
  const before=(await f.pool.query('SELECT * FROM remote_traffic_processes')).rows;
  for(const change of ['last_sequence=0','has_gap=false',"started_at='2026-10-31T00:00:00Z'"])
   await assert.rejects(f.pool.query('UPDATE remote_traffic_processes SET '+change),{code:'55000'});
  assert.deepEqual((await f.pool.query('SELECT * FROM remote_traffic_processes')).rows,before);
  await assert.rejects(f.pool.query('DELETE FROM remote_traffic_processes'),{code:'55000'});
  const peer=randomUUID();await f.processInsert({process_id:peer,predecessor_id:f.process});
  const original=(await f.pool.query('SELECT ended_at,final_sequence FROM remote_traffic_processes WHERE process_id=$1',[f.process])).rows[0];
  assert.deepEqual(original,{ended_at:null,final_sequence:null});
 }finally{await f.close();}
});

test('stored process endings are once set and cannot precede accepted bytes or close another process',async()=>{
 const f=await fixture();try{
  await f.processInsert();await f.pool.query("UPDATE remote_traffic_processes SET last_sequence=1,last_until='2026-11-01T00:00:01Z'");
  await assert.rejects(f.pool.query("UPDATE remote_traffic_processes SET ended_at='2026-11-01T00:00:00Z',final_sequence=0,end_payload='e30',end_signature=$1",['a'.repeat(86)]),{code:'23514'});
  await assert.rejects(f.pool.query("UPDATE remote_traffic_processes SET ended_at='2026-11-01T00:00:02Z'"),{code:'23514'});
  await f.pool.query("UPDATE remote_traffic_processes SET ended_at='2026-11-01T00:00:02Z',final_sequence=2,end_payload='e30',end_signature=$1",['a'.repeat(86)]);
  for(const change of ["ended_at='2026-11-01T00:00:03Z'",'final_sequence=3','ended_at=NULL,final_sequence=NULL,end_payload=NULL,end_signature=NULL'])
   await assert.rejects(f.pool.query('UPDATE remote_traffic_processes SET '+change),{code:'55000'});
  await f.pool.query("UPDATE remote_traffic_processes SET last_sequence=2,last_until='2026-11-01T00:00:02Z'");
  await assert.rejects(f.pool.query("UPDATE remote_traffic_processes SET last_sequence=3,last_until='2026-11-01T00:00:03Z'"),{code:'23514'});
 }finally{await f.close();}
});

test('expected route journal keeps both channels and empty publications as immutable separate evidence',async()=>{
 const f=await fixture();try{
  await f.coverageInsert();await f.coverageInsert({channel:'public'});
  await assert.rejects(f.coverageInsert(),{code:'23505'});
  const empty={...f.coverageRow,manifest_digest:'d'.repeat(64),manifest_sequence:'2',kind:'empty',organisation_id:null,legal_business_id:null,venue_id:null,
   installation_id:null,configuration_revision:null,route_binding:null,channel:null};
  await f.insert('remote_traffic_coverage',empty);await assert.rejects(f.insert('remote_traffic_coverage',empty),{code:'23505'});
  for(const change of [{venue_id:f.venues[1]},{organisation_id:f.foreign.organisationId}])await assert.rejects(f.coverageInsert({...change,manifest_digest:'e'.repeat(64)}),{code:'23503'});
  for(const change of [{kind:'empty'},{channel:'operational'},{expires_at:'2026-11-01T00:10:00.001Z'},{expires_at:f.coverageRow.issued_at},{configuration_revision:'0.5'}])
   await assert.rejects(f.coverageInsert({...change,manifest_digest:'e'.repeat(64)}),{code:'23514'});
  for(const sql of ["UPDATE remote_traffic_coverage SET expires_at=expires_at-interval '1 second'",'DELETE FROM remote_traffic_coverage'])await assert.rejects(f.pool.query(sql),{code:'55000'});
  assert.equal((await f.pool.query('SELECT count(*) FROM remote_traffic_coverage')).rows[0].count,'3');
 }finally{await f.close();}
});

test('traffic journal refuses production cells malformed process identities and reused process UUIDs',async()=>{
 const f=await fixture();try{
  for(const change of [{generation:'0'},{generation:'1.5'},{started_at:'infinity'},{reporter_public_key:''},
   {predecessor_id:f.process},{start_signature:'bad'},{start_manifest_digest:'invalid'}])await assert.rejects(f.processInsert(change),{code:'23514'});
  await f.pool.query("UPDATE remote_cells SET environment='production' WHERE id=$1",[f.cell]);
  await assert.rejects(f.processInsert(),{code:'23503'});await assert.rejects(f.coverageInsert(),{code:'23503'});
  await f.pool.query("UPDATE remote_cells SET environment='test' WHERE id=$1",[f.cell]);await f.processInsert();
  await assert.rejects(f.processInsert({generation:'2'}),{code:'23505'});
  assert.equal((await f.pool.query('SELECT count(*) FROM remote_traffic_processes')).rows[0].count,'1');
 }finally{await f.close();}
});
