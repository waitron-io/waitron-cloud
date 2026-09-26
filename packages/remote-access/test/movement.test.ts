import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import {RegistrationStore,SignupStore} from '@waitron-cloud/registration';
import {database} from '../../account-http/test/fixtures.ts';
import {RemoteAccessStore} from '../src/placement.ts';

const peerKey=()=>randomBytes(32).toString('base64');
let db:Awaited<ReturnType<typeof database>>,store:RemoteAccessStore;

before(async()=>{db=await database();store=new RemoteAccessStore(db.pool);});
after(async()=>db?.close());

async function installation(email:string){
 const signup=new SignupStore(db.pool,db.outbox);await signup.request(email);
 const mail=db.outbox.open((await db.pool.query("SELECT * FROM email_outbox WHERE kind='verification' ORDER BY created_at DESC LIMIT 1")).rows[0]);assert.ok('token' in mail);
 const owner=await signup.complete(mail.token,{password:'a long enough test password',organisationName:'Cafés',legalBusinessName:'Cafés SL',countryCode:'ES'});
 const binding={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test' as const,organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
 const registration=new RegistrationStore(db.pool);await registration.start(binding);await registration.approveCloud(binding,owner.accountId);await registration.approveLocal(binding,randomUUID());return registration.complete(binding);
}

test('a tested destination route cuts over once and preserves customer-facing names',async()=>{
 const source={id:randomUUID(),country:'ES',provider:'aws',environment:'test',suffix:'source.example.test',subnet:21,publicKey:peerKey(),endpoint:'source-gateway.example.test:51820'};
 const target={id:randomUUID(),country:'ES',provider:'aws',environment:'test',suffix:'target.example.test',subnet:22,publicKey:peerKey(),endpoint:'target-gateway.example.test:51820'};
 await store.createCell(source);await store.createCell(target);
 const installed=await installation('move@example.test'),venuePeer=peerKey(),active=await store.provision(installed.installationId,source.id,venuePeer);
 const operationId=randomUUID();
 const staged=await store.stageMove({operationId,installationId:installed.installationId,targetCellId:target.id,targetPeerPublicKey:venuePeer,port:443,expectedRevision:1});
 assert.equal(staged.state,'staged');
 assert.equal(staged.source.cellId,source.id);assert.equal(staged.target.cellId,target.id);
 assert.equal(staged.target.staffHostname,active.staffHostname);assert.equal(staged.target.publicHostname,active.publicHostname);
 assert.deepEqual((await store.manifest(source.id)).routes.map(route=>route.installationId),[installed.installationId]);
 const targetManifest=await store.manifest(target.id);assert.deepEqual(targetManifest.routes.map(route=>route.installationId),[installed.installationId]);
 assert.equal(targetManifest.routes[0]!.staffHostname,active.staffHostname);assert.equal(targetManifest.routes[0]!.publicHostname,active.publicHostname);
 await assert.rejects(store.completeMove(operationId,1),/move_not_ready/);
 const ready=await store.markMoveReady(operationId,1,targetManifest.sequence);assert.equal(ready.state,'ready');assert.equal(ready.readinessSequence,targetManifest.sequence);
 const completed=await store.completeMove(operationId,1);assert.equal(completed.state,'completed');assert.equal(completed.revision,2);assert.equal(completed.target.cellId,target.id);
 assert.deepEqual(await store.completeMove(operationId,1),completed);
 assert.deepEqual((await store.manifest(source.id)).routes,[]);
 const destination=await store.manifest(target.id);assert.deepEqual(destination.routes.map(route=>route.installationId),[installed.installationId]);
 assert.equal(destination.routes[0]!.staffHostname,active.staffHostname);assert.equal(destination.routes[0]!.publicHostname,active.publicHostname);
 const row=(await db.pool.query("SELECT i.configuration_revision,s.state,s.configuration FROM installations i JOIN installation_services s ON s.installation_id=i.id AND s.service='remote_access' WHERE i.id=$1",[installed.installationId])).rows[0];
 assert.equal(row.configuration_revision,2);assert.equal(row.state,'provisioning');assert.equal(row.configuration.cellId,target.id);assert.equal(row.configuration.staffHostname,active.staffHostname);
});

test('competing, cancelled and stale moves cannot disturb either active venue',async()=>{
 const source={id:randomUUID(),country:'ES',provider:'aws',environment:'test',suffix:'move-source.example.test',subnet:23,publicKey:peerKey(),endpoint:'move-source-gateway.example.test:51820'};
 const target={id:randomUUID(),country:'ES',provider:'aws',environment:'test',suffix:'move-target.example.test',subnet:24,publicKey:peerKey(),endpoint:'move-target-gateway.example.test:51820'};
 const alternate={id:randomUUID(),country:'ES',provider:'aws',environment:'test',suffix:'move-alternate.example.test',subnet:25,publicKey:peerKey(),endpoint:'move-alternate-gateway.example.test:51820'};
 await store.createCell(source);await store.createCell(target);await store.createCell(alternate);
 const selected=await installation('selected@example.test'),other=await installation('other@example.test');
 const selectedPlacement=await store.provision(selected.installationId,source.id,peerKey()),otherPlacement=await store.provision(other.installationId,source.id,peerKey());
 const firstId=randomUUID(),first=await store.stageMove({operationId:firstId,installationId:selected.installationId,targetCellId:target.id,targetPeerPublicKey:selectedPlacement.peerPublicKey,expectedRevision:1});
 const firstManifest=await store.manifest(target.id);assert.equal(firstManifest.routes.length,1);
 await assert.rejects(store.stageMove({operationId:randomUUID(),installationId:selected.installationId,targetCellId:alternate.id,targetPeerPublicKey:peerKey(),expectedRevision:1}),/move_conflict/);
 const cancelled=await store.cancelMove(firstId,1);assert.equal(cancelled.state,'cancelled');assert.deepEqual(await store.cancelMove(firstId,1),cancelled);
 assert.deepEqual((await store.manifest(target.id)).routes,[]);
 const secondId=randomUUID(),second=await store.stageMove({operationId:secondId,installationId:selected.installationId,targetCellId:target.id,targetPeerPublicKey:selectedPlacement.peerPublicKey,expectedRevision:1});
 assert.notEqual(second.target.address,first.target.address,'a cancelled allocation is not reused');
 const exported=await store.manifest(target.id);await store.markMoveReady(secondId,1,exported.sequence);
 await store.setHostname(selected.installationId,'staff',selectedPlacement.staffHostname,1);
 await assert.rejects(store.completeMove(secondId,1),/revision_conflict/);
 assert.deepEqual((await store.manifest(target.id)).routes,[],'a stale staged route is no longer exported');
 assert.equal((await store.cancelMove(secondId,1)).state,'cancelled');
 const sourceRoutes=(await store.manifest(source.id)).routes;
 assert.deepEqual(sourceRoutes.map(route=>route.installationId).sort(),[other.installationId,selected.installationId].sort());
 const stillOther=sourceRoutes.find(route=>route.installationId===other.installationId)!;
 assert.equal(stillOther.address,otherPlacement.address);assert.equal(stillOther.staffHostname,otherPlacement.staffHostname);assert.equal(stillOther.peerPublicKey,otherPlacement.peerPublicKey);
});

test('revocation, environment and capacity bounds fail before active placement changes',async()=>{
 const source={id:randomUUID(),country:'ES',provider:'aws',environment:'test',suffix:'bounds-source.example.test',subnet:26,publicKey:peerKey(),endpoint:'bounds-source-gateway.example.test:51820'};
 const target={id:randomUUID(),country:'ES',provider:'aws',environment:'test',suffix:'bounds-target.example.test',subnet:27,publicKey:peerKey(),endpoint:'bounds-target-gateway.example.test:51820'};
 const full={id:randomUUID(),country:'ES',provider:'aws',environment:'test',suffix:'bounds-full.example.test',subnet:28,publicKey:peerKey(),endpoint:'bounds-full-gateway.example.test:51820'};
 const production={id:randomUUID(),country:'ES',provider:'aws',environment:'production',suffix:'bounds-production.example.test',subnet:29,publicKey:peerKey(),endpoint:'bounds-production-gateway.example.test:51820'};
 await store.createCell(source);await store.createCell(target);await store.createCell(full);await store.createCell(production);await db.pool.query('UPDATE remote_cells SET next_address=66 WHERE id=$1',[full.id]);
 const installed=await installation('bounds@example.test'),active=await store.provision(installed.installationId,source.id,peerKey());
 await assert.rejects(store.stageMove({operationId:randomUUID(),installationId:installed.installationId,targetCellId:production.id,targetPeerPublicKey:active.peerPublicKey,expectedRevision:1}),/cell_unavailable/);
 await assert.rejects(store.stageMove({operationId:randomUUID(),installationId:installed.installationId,targetCellId:full.id,targetPeerPublicKey:active.peerPublicKey,expectedRevision:1}),/cell_full/);
 const operationId=randomUUID();await store.stageMove({operationId,installationId:installed.installationId,targetCellId:target.id,targetPeerPublicKey:active.peerPublicKey,expectedRevision:1});
 const exported=await store.manifest(target.id);await db.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[installed.installationId]);
 assert.deepEqual((await store.manifest(target.id)).routes,[]);await assert.rejects(store.markMoveReady(operationId,1,exported.sequence),/revoked/);
 assert.equal((await store.cancelMove(operationId,1)).state,'cancelled');
 const current=(await db.pool.query('SELECT cell_id,host(address) AS address FROM remote_placements WHERE installation_id=$1',[installed.installationId])).rows[0];assert.deepEqual(current,{cell_id:source.id,address:active.address});
});
