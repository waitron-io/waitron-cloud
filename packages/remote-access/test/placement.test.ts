import assert from 'node:assert/strict';
import {randomUUID,randomBytes,generateKeyPairSync} from 'node:crypto';
import {before,after,test} from 'node:test';
import {SignupStore,RegistrationStore,advancePlanConfiguration,transaction} from '@waitron-cloud/registration';
import {database} from '../../account-http/test/fixtures.ts';
import {crypto} from 'acme-client';
import {RemoteAccessStore} from '../src/placement.ts';
import {guestMenuFixture} from './fixtures/guest-menu.ts';
const publicKey=()=>randomBytes(32).toString('base64');
let db:Awaited<ReturnType<typeof database>>,store:RemoteAccessStore;
before(async()=>{db=await database();store=new RemoteAccessStore(db.pool);});
after(async()=>db?.close());
test('two venues share one cell with distinct stable routes, independent configuration and revocation',async()=>{
 const signup=new SignupStore(db.pool,db.outbox);await signup.request('remote@example.test');const mail=db.outbox.open((await db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert.ok('token' in mail);
 const owner=await signup.complete(mail.token,{password:'a long enough test password',organisationName:'Cafés',legalBusinessName:'Cafés SL',countryCode:'ES'});
 const registration=new RegistrationStore(db.pool);const installations=[];
 for(let n=0;n<3;n++){
  const key=generateKeyPairSync('ed25519'),input={operationId:randomUUID(),installationKey:key.publicKey.export({type:'spki',format:'der'}).toString('base64url'),venueId:'',environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
  await registration.start(input);await registration.approveCloud(input,owner.accountId);await registration.approveLocal(input,randomUUID());installations.push(await registration.complete(input));
 }
 const cell={id:randomUUID(),country:'ES',provider:'aws',environment:'test',suffix:'local.example.test',subnet:7,publicKey:publicKey(),endpoint:'gateway.example.test:51820'};
 await store.createCell(cell);const a=installations[0]!,b=installations[1]!,keyA=publicKey(),keyB=publicKey();
 const [one,two]=await Promise.all([store.provision(a.installationId,cell.id,keyA,443),store.provision(b.installationId,cell.id,keyB,443)]);
 assert.notEqual(one.address,two.address);assert.notEqual(one.staffHostname,two.staffHostname);assert.equal(one.cellId,two.cellId);
 assert.deepEqual(await new RemoteAccessStore(db.secondPool).provision(a.installationId,cell.id,keyA,443),one);
 await assert.rejects(store.provision(b.installationId,cell.id,keyA,443),/placement_conflict/);
 const first=await store.manifest(cell.id),second=await store.manifest(cell.id);assert.ok(second.sequence>first.sequence);assert.equal(first.routes.length,2);
 const setup=await db.pool.query("SELECT state,configuration FROM installation_services WHERE installation_id=$1 AND service='remote_access'",[a.installationId]);assert.equal(setup.rows[0].state,'provisioning');assert.equal(setup.rows[0].configuration.staffHostname,one.staffHostname);
 await assert.rejects(store.setHostname(b.installationId,'staff',`staff-v-${installations[2]!.venueId}.${cell.suffix}`,1,async name=>[name.startsWith('_acme')?'_acme-challenge.'+two.staffHostname:two.staffHostname]),/hostname_conflict/);
 const custom='staff.cafe.example',dns=await store.hostnameInstructions(a.installationId,'staff',custom);
 assert.equal(dns[0]!.value,one.staffHostname);
 await assert.rejects(store.setHostname(a.installationId,'staff',custom,1,async()=>['wrong.example.test']),/dns_not_verified/);
 await assert.rejects(store.setHostname(a.installationId,'staff',custom,0,async name=>[dns.find(r=>r.name===name)!.value]),/revision_conflict/);
 const changed=await store.setHostname(a.installationId,'staff',custom,1,async name=>[dns.find(r=>r.name===name)!.value]);assert.equal(changed.staffHostname,custom);
 const [,csr]=await crypto.createCsr({commonName:custom,altNames:[custom]});
 assert.deepEqual(await store.authorizeCertificate(a.installationId,'staff',csr.toString()),{hostname:custom,assigned:one.staffHostname,dnsName:'_acme-challenge.'+one.staffHostname,revision:2});
 await assert.rejects(store.authorizeCertificate(b.installationId,'staff',csr.toString()),/invalid_csr/);
 await assert.rejects(store.setHostname(b.installationId,'staff',custom,1,async name=>[name.startsWith('_acme')?'_acme-challenge.'+two.staffHostname:two.staffHostname]),/hostname_conflict/);
 await db.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[a.installationId]);
 const revoked=await store.manifest(cell.id);assert.deepEqual(revoked.routes.map(r=>r.installationId),[b.installationId]);
 await assert.rejects(store.provision(a.installationId,cell.id,keyA,443),/revoked/);
 await assert.rejects(store.authorizeCertificate(a.installationId,'staff',csr.toString()),/revoked/);
});

test('replacement reclaims its venue route with a new peer, retaining address and custom names',async()=>{
 const signup=new SignupStore(db.pool,db.outbox);await signup.request('replacement@example.test');
 const mail=db.outbox.open((await db.pool.query("SELECT * FROM email_outbox WHERE kind='verification' ORDER BY created_at DESC LIMIT 1")).rows[0]);assert.ok('token' in mail);
 const owner=await signup.complete(mail.token,{password:'a long enough test password',organisationName:'Replacement',legalBusinessName:'Replacement SL',countryCode:'ES'});
 const registration=new RegistrationStore(db.pool), input={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),venueId:'',environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
 await registration.start(input);await registration.approveCloud(input,owner.accountId);await registration.approveLocal(input,randomUUID());
 const old=await registration.complete(input), cell=randomUUID(), oldPeer=publicKey();
 await store.createCell({id:cell,country:'ES',provider:'aws',environment:'test',suffix:'replacement.example.test',subnet:8,publicKey:publicKey(),endpoint:'replacement-gateway.test:51820'});
 const prior=await store.provision(old.installationId,cell,oldPeer);
 const custom='staff.replacement.example', dns=await store.hostnameInstructions(old.installationId,'staff',custom);
 await store.setHostname(old.installationId,'staff',custom,1,async name=>[dns.find(r=>r.name===name)!.value]);
 let current=old;
 for(let n=0;n<2;n++){
  await db.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[current.installationId]);
  const next={...input,operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),venueId:old.venueId};
  await registration.start(next);await registration.approveCloud(next,owner.accountId);await registration.approveLocal(next,randomUUID());current=await registration.complete(next);
 }
 await assert.rejects(store.provision(current.installationId,cell,oldPeer),/placement_conflict/);
 const peer=publicKey();await assert.rejects(store.provision(current.installationId,cell,peer,8443),/placement_conflict/);
 const result=await store.provision(current.installationId,cell,peer);
 assert.deepEqual(result,{...prior,installationId:current.installationId,peerPublicKey:peer,staffHostname:custom});
 const revision=(await db.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[current.installationId])).rows[0].configuration_revision;
 assert.deepEqual(await new RemoteAccessStore(db.secondPool).provision(current.installationId,cell,peer),result);
 assert.equal((await db.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[current.installationId])).rows[0].configuration_revision,revision);
 assert.deepEqual((await store.manifest(cell)).routes.map(r=>r.installationId),[current.installationId]);
 assert.equal((await db.pool.query('SELECT next_address FROM remote_cells WHERE id=$1',[cell])).rows[0].next_address,3);
 await assert.rejects(store.provision(old.installationId,cell,oldPeer),/revoked/);
 await transaction(db.pool,client=>advancePlanConfiguration(client,owner.organisationId,true));
 await store.provision(current.installationId,cell,peer);
 await db.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[current.installationId]);
 const next={...input,operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),venueId:old.venueId};
 await registration.start(next);await registration.approveCloud(next,owner.accountId);await registration.approveLocal(next,randomUUID());const later=await registration.complete(next);
 await assert.rejects(store.provision(later.installationId,cell,oldPeer),/placement_conflict/);
 await assert.rejects(store.provision(later.installationId,cell,peer),/placement_conflict/);
 assert.equal((await store.provision(later.installationId,cell,publicKey())).address,prior.address);
});

test('replacement tunnel reclaim refuses production setup',async()=>{
 const signup=new SignupStore(db.pool,db.outbox);await signup.request('production-replacement@example.test');
 const mail=db.outbox.open((await db.pool.query("SELECT * FROM email_outbox WHERE kind='verification' ORDER BY created_at DESC LIMIT 1")).rows[0]);assert.ok('token' in mail);
 const owner=await signup.complete(mail.token,{password:'a long enough test password',organisationName:'Production replacement',legalBusinessName:'Production replacement SL',countryCode:'ES'});
 const registration=new RegistrationStore(db.pool),input={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),venueId:'',environment:'production',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
 await registration.start(input);await registration.approveCloud(input,owner.accountId);await registration.approveLocal(input,randomUUID());const old=await registration.complete(input);
 const cell=randomUUID();await store.createCell({id:cell,country:'ES',provider:'aws',environment:'production',suffix:'production-replacement.example.test',subnet:9,publicKey:publicKey(),endpoint:'production-gateway.test:51820'});
 const prior=await store.provision(old.installationId,cell,publicKey());
 await db.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[old.installationId]);
 const next={...input,venueId:old.venueId,operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url')};
 await registration.start(next);await registration.approveCloud(next,owner.accountId);await registration.approveLocal(next,randomUUID());const replacement=await registration.complete(next);
 await assert.rejects(store.provision(replacement.installationId,cell,publicKey()),/local_integration_only/);
 assert.deepEqual((await db.pool.query('SELECT installation_id FROM remote_placements WHERE venue_id=$1',[old.venueId])).rows,[{installation_id:prior.installationId}]);
});

const zoneCell=(suffix:string,subnet=200)=>({id:randomUUID(),country:'ES',provider:'aws',environment:'test',suffix,subnet,publicKey:publicKey(),endpoint:'gateway.example.test:51820'});
test('a placement is named under the country zone, not the cell suffix',async()=>{
 const f=await guestMenuFixture();try{
  const remote=new RemoteAccessStore(f.db.pool),cell={...zoneCell('cell-a.example.test'),zone:'venues.example.test'};await remote.createCell(cell);
  const placed=await remote.provision(f.installationId,cell.id,publicKey());
  assert.equal(placed.staffHostname,'staff-v-'+f.venueId+'.venues.example.test');assert.equal(placed.publicHostname,'v-'+f.venueId+'.venues.example.test');
 }finally{await f.db.close();}
});
test('a second cell in the same country and environment shares the zone',async()=>{
 const f=await database();try{
  const remote=new RemoteAccessStore(f.pool);await remote.createCell({...zoneCell('first.example.test'),zone:'venues.example.test'});
  await remote.createCell(zoneCell('second.example.test',201));
  await assert.rejects(remote.createCell({...zoneCell('third.example.test',202),zone:'other.example.test'}),/zone_conflict/);
  assert.deepEqual((await f.pool.query('SELECT country,environment,suffix FROM remote_country_zones')).rows,[{country:'ES',environment:'test',suffix:'venues.example.test'}]);
  assert.equal((await f.pool.query('SELECT count(*) FROM remote_cells')).rows[0].count,'2');
 }finally{await f.close();}
});
test('a cell created without any zone records its own suffix',async()=>{
 const f=await database();try{
  const remote=new RemoteAccessStore(f.pool);await remote.createCell(zoneCell('fallback.example.test'));
  assert.equal((await f.pool.query('SELECT suffix FROM remote_country_zones')).rows[0]?.suffix,'fallback.example.test');
  for(const zone of ['bad name','x'.repeat(181)])await assert.rejects(remote.createCell({...zoneCell('invalid.example.test',201),zone}),/invalid_cell/);
 }finally{await f.close();}
});
test('placement refuses zone_unavailable for a cell inserted without a zone',async()=>{
 const f=await guestMenuFixture();try{
  const cell=zoneCell('unrecorded.example.test');await f.db.pool.query('INSERT INTO remote_cells(id,country,provider,environment,suffix,subnet,public_key,endpoint) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',Object.values(cell));
  await assert.rejects(new RemoteAccessStore(f.db.pool).provision(f.installationId,cell.id,publicKey()),/zone_unavailable/);
  assert.equal((await f.db.pool.query('SELECT count(*) FROM remote_placements')).rows[0].count,'0');
 }finally{await f.db.close();}
});

test('a name under the country zone or any cell suffix is refused as a custom name',async()=>{
 const f=await guestMenuFixture();try{
  const remote=new RemoteAccessStore(f.db.pool),first={...zoneCell('a.example.test'),zone:'venues.example.test'};await remote.createCell(first);await remote.createCell(zoneCell('b.example.test',201));
  await remote.provision(f.installationId,first.id,publicKey());let resolves=0;
  for(const hostname of ['x.venues.example.test','venues.example.test','x.b.example.test','staff-v-'+randomUUID()+'.venues.example.test']){
   await assert.rejects(remote.setHostname(f.installationId,'staff',hostname,1,async()=>{resolves++;return [];}),/hostname_conflict/);
  }
  assert.equal(resolves,0);
 }finally{await f.db.close();}
});
