import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import {RegistrationStore,SignupStore,transaction} from '@waitron-cloud/registration';
import {database} from '../../account-http/test/fixtures.ts';
import {RemoteAccessStore} from '../src/placement.ts';
import {RemoteProbeStore} from '../src/probe-targets.ts';

const peerKey=()=>randomBytes(32).toString('base64');
const installationKey=()=>generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url');
let db:Awaited<ReturnType<typeof database>>;

before(async()=>{db=await database();});
after(async()=>db?.close());

test('targets are bounded current authorised placements with stable tenant identity and revision',async()=>{
 const signup=new SignupStore(db.pool,db.outbox),email=`probe-${randomUUID()}@example.test`;
 await signup.request(email);const message=db.outbox.open((await db.pool.query('SELECT * FROM email_outbox ORDER BY created_at DESC LIMIT 1')).rows[0]);assert('token' in message);
 const owner=await signup.complete(message.token,{password:'a long enough probe password',organisationName:'Probe venues',legalBusinessName:'Probe venues SL',countryCode:'ES'});
 const registrations=new RegistrationStore(db.pool);
 const create=async()=>{
  const input={operationId:randomUUID(),installationKey:installationKey(),localVenueId:randomUUID(),environment:'test' as const,organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
  await registrations.start(input);await registrations.approveCloud(input,owner.accountId);await registrations.approveLocal(input,randomUUID());return registrations.complete(input);
 };
 const [first,second,unconfigured,revoked]=await Promise.all([create(),create(),create(),create()]);
 const remote=new RemoteAccessStore(db.pool),cell=randomUUID();
 await remote.createCell({id:cell,country:'ES',provider:'aws',environment:'test',suffix:'probe.example.test',subnet:31,publicKey:peerKey(),endpoint:'gateway.example.test:51820'});
 for(const item of [first,second,unconfigured,revoked])await remote.provision(item.installationId,cell,peerKey());
 await db.pool.query("UPDATE installation_services SET state='unconfigured' WHERE installation_id=$1 AND service='remote_access'",[unconfigured.installationId]);
 await db.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[revoked.installationId]);

 const probes=new RemoteProbeStore(db.pool),targets=await probes.targets();
 const expected=[first,second].sort((a,b)=>a.venueId.localeCompare(b.venueId));
 assert.deepEqual(targets.map(t=>[t.installationId,t.venueId,t.revision]),expected.map(t=>[t.installationId,t.venueId,1]));
 assert.deepEqual((await probes.targets(1)).map(t=>t.installationId),[expected[0]!.installationId]);
 await assert.rejects(probes.targets(0),/invalid_probe_limit/);await assert.rejects(probes.targets(101),/invalid_probe_limit/);await assert.rejects(probes.targets(1.5),/invalid_probe_limit/);

 const replacementId=randomUUID(),replacementPublicKey=installationKey(),replacementPeerKey=peerKey();
 await transaction(db.pool,async client=>{
  await client.query('SET CONSTRAINTS ALL DEFERRED');
  await client.query('UPDATE installations SET revoked_at=clock_timestamp(),superseded_by=$2 WHERE id=$1',[first.installationId,replacementId]);
  await client.query('INSERT INTO installations(id,venue_id,public_key,configuration_revision) VALUES($1,$2,$3,2)',[replacementId,first.venueId,replacementPublicKey]);
  await client.query("INSERT INTO installation_services(installation_id,service) VALUES($1,'remote_access'),($1,'continuous_backup'),($1,'retained_snapshots')",[replacementId]);
  await client.query("UPDATE installation_services SET state='provisioning' WHERE installation_id=$1 AND service='remote_access'",[replacementId]);
  await client.query('UPDATE remote_placements SET installation_id=$2,peer_public_key=$3 WHERE installation_id=$1',[first.installationId,replacementId,replacementPeerKey]);
 });
 const replaced=await probes.targets();
 assert.equal(replaced.some(t=>t.installationId===first.installationId),false);
 assert.deepEqual(replaced.find(t=>t.venueId===first.venueId),{installationId:replacementId,venueId:first.venueId,revision:2,staffHostname:targets.find(t=>t.venueId===first.venueId)!.staffHostname,publicHostname:targets.find(t=>t.venueId===first.venueId)!.publicHostname});
 assert.equal(replaced.some(t=>t.venueId===unconfigured.venueId||t.venueId===revoked.venueId),false);
});
