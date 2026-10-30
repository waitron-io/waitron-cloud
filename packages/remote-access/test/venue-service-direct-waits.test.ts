import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {crypto as acmeCrypto} from 'acme-client';
import {venueServiceFixture,set} from '../../registration/test/fixtures/venue-service.ts';
import {RemoteAccessStore} from '../src/placement.ts';

const peer=()=>randomBytes(32).toString('base64');
async function fixture(){
 const f=await venueServiceFixture();
 try{
  await set(f,'connected');
  const store=new RemoteAccessStore(f.pool,'test-venue-levels'),cellId=randomUUID(),target=randomUUID(),key=peer();
  for(const [id,subnet] of [[cellId,84],[target,85]] as const)await store.createCell({id,country:'ES',provider:'aws',environment:'test',suffix:`direct-${id}.example.test`,subnet,publicKey:peer(),endpoint:'gateway.example.test:51820'});
  const id=(await f.pool.query('SELECT id FROM installations WHERE venue_id=$1 AND revoked_at IS NULL',[f.venues[0]])).rows[0].id;
  const placement=await store.provision(id,cellId,key);
  const revision=Number((await f.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[id])).rows[0].configuration_revision);
  const [,csr]=await acmeCrypto.createCsr({commonName:placement.staffHostname,altNames:[placement.staffHostname]});
  return {...f,store,cellId,target,key,id,placement,revision,csr:csr.toString()};
 }catch(error){await f.close();throw error;}
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function waitForBlock(f:Fixture,pid:number,settled:()=>boolean){
 for(let n=0;n<300&&!settled();n++){
  if((await f.admin.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND $2=ANY(pg_blocking_pids(pid))',[f.schema,pid])).rowCount)return;
  await new Promise(resolve=>setTimeout(resolve,10));
 }
 assert.fail('direct remote admission must reach its real lock wait');
}

// An old venue grant must not authorise the same UUID after its venue or key changes.
for(const action of ['provision','dns','certificate'] as const)for(const change of ['venue','key'] as const)
test(`venue direct ${action} rejects changed ${change} after authority wait`,async()=>{
 const f=await fixture(),holder=await f.peer.connect();let pending:Promise<unknown>|undefined;
 try{
  await holder.query('BEGIN');await holder.query('SELECT id FROM venues WHERE id=$1 FOR NO KEY UPDATE',[f.venues[0]]);
  const pid=Number((await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);let settled=false;
  pending=(action==='provision'?f.store.provision(f.id,f.cellId,f.key):action==='dns'?f.store.hostnameInstructions(f.id,'staff','custom.example.test'):f.store.authorizeCertificate(f.id,'staff',f.csr)).finally(()=>{settled=true;});void pending.catch(()=>{});
  await waitForBlock(f,pid,()=>settled);
  if(change==='venue'){
   await holder.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE venue_id=$1 AND revoked_at IS NULL',[f.venues[1]]);
   await holder.query('UPDATE installations SET venue_id=$2 WHERE id=$1',[f.id,f.venues[1]]);
  }else await holder.query('UPDATE installations SET public_key=$2 WHERE id=$1',[f.id,randomUUID()]);
  await holder.query('COMMIT');
  await assert.rejects(pending,/permission_denied/);
  assert.equal((await f.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[f.id])).rows[0].configuration_revision,f.revision);
  assert.equal((await f.pool.query('SELECT count(*) AS n FROM remote_hostname_changes')).rows[0].n,'0');
 }finally{await holder.query('ROLLBACK');await pending?.catch(()=>{});holder.release();await f.close();}
});

// Reading setup before an installation wait must not admit a move after setup is cleared.
test('venue direct move rereads setup after installation wait',async()=>{
 const f=await fixture(),holder=await f.peer.connect();let pending:Promise<unknown>|undefined;
 try{
  await holder.query('BEGIN');await holder.query('SELECT id FROM installations WHERE id=$1 FOR UPDATE',[f.id]);
  const pid=Number((await holder.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);let settled=false;
  pending=f.store.stageMove({operationId:randomUUID(),installationId:f.id,targetCellId:f.target,targetPeerPublicKey:peer(),expectedRevision:f.revision}).finally(()=>{settled=true;});void pending.catch(()=>{});
  await waitForBlock(f,pid,()=>settled);
  await holder.query("UPDATE installation_services SET state='unconfigured',configuration='{}' WHERE installation_id=$1 AND service='remote_access'",[f.id]);await holder.query('COMMIT');
  await assert.rejects(pending,/permission_denied/);
  assert.equal((await f.pool.query('SELECT count(*) AS n FROM remote_cell_moves')).rows[0].n,'0');
  assert.equal((await f.pool.query('SELECT next_address FROM remote_cells WHERE id=$1',[f.target])).rows[0].next_address,2);
 }finally{await holder.query('ROLLBACK');await pending?.catch(()=>{});holder.release();await f.close();}
});
