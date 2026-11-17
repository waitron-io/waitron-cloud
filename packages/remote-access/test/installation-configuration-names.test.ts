import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {test} from 'node:test';
import {RegistrationStore,SignupStore,InstallationStore,createLeaseIssuer,encodeMachine,type MachineAction,type SignedEnvelope} from '@waitron-cloud/registration';
import {database} from '../../account-http/test/fixtures.ts';
import {RemoteAccessStore} from '../src/placement.ts';

test('the installation configuration reply carries the current staff name after placement, a custom name and a move',async()=>{
 const db=await database();try{
  const origin='https://cloud.example.test',key=generateKeyPairSync('ed25519'),registration=new RegistrationStore(db.pool),signup=new SignupStore(db.pool,db.outbox);
  await signup.request('stored-names@example.test');const mail=db.outbox.open((await db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert('token' in mail);
  const owner=await signup.complete(mail.token,{password:'A sufficiently long test password',organisationName:'Synthetic café',legalBusinessName:'Synthetic café SL',countryCode:'ES'});
  const binding={operationId:randomUUID(),installationKey:key.publicKey.export({type:'spki',format:'der'}).toString('base64url'),venueId:'',environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
  await registration.start(binding);await registration.approveCloud(binding,owner.accountId);await registration.approveLocal(binding,randomUUID());const installed=await registration.complete(binding);
  const peer=()=>randomBytes(32).toString('base64'),remote=new RemoteAccessStore(db.pool),cells=[randomUUID(),randomUUID()];
  for(let n=0;n<2;n++)await remote.createCell({id:cells[n]!,country:'ES',provider:'aws',environment:'test',suffix:`cell-${n}.example.test`,zone:'venues.example.test',subnet:210+n,publicKey:peer(),endpoint:'gateway.example.test:51820'});
  await remote.provision(installed.installationId,cells[0]!,peer());
  const issuer=createLeaseIssuer(generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'der'}).toString('base64url')),client=new InstallationStore(db.pool,issuer,origin);
  const proof=(action:MachineAction,lease?:SignedEnvelope)=>{
   const payload=encodeMachine({origin,action,installationId:installed.installationId,operationId:randomUUID(),issuedAt:Date.now(),lease:lease?JSON.stringify(lease):'',body:'{}'});
   return {payload:payload.toString('base64url'),signature:sign(null,payload,key.privateKey).toString('base64url')};
  };
  const staffName=async()=>{
   const renewed=await client.execute('renew',proof('renew'));assert(renewed.lease);
   const view=await client.execute('configuration',proof('configuration',renewed.lease));
   return view.services.find(service=>service.service==='remote_access')?.configuration.staffHostname;
  };
  assert.equal(await staffName(),`staff-v-${installed.venueId}.venues.example.test`);
  const custom='staff.synthetic-cafe.example.test',instructions=await remote.hostnameInstructions(installed.installationId,'staff',custom);
  await remote.setHostname(installed.installationId,'staff',custom,1,async name=>[instructions.find(record=>record.name===name)!.value]);
  assert.equal(await staffName(),custom);
  const operationId=randomUUID();await remote.stageMove({operationId,installationId:installed.installationId,targetCellId:cells[1]!,targetPeerPublicKey:peer(),expectedRevision:2});
  const manifest=await remote.manifest(cells[1]!);await remote.markMoveReady(operationId,2,manifest.sequence);await remote.completeMove(operationId,2);
  assert.equal(await staffName(),custom);
 }finally{await db.close();}
});
