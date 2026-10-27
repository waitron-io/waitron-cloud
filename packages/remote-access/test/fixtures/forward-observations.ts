import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {RegistrationStore,SignupStore,OrganisationPlanStore,transaction} from '@waitron-cloud/registration';
import {database} from '../../../account-http/test/fixtures.ts';
import {RemoteAccessStore} from '../../src/placement.ts';
import {ForwardObservationStore,registerForwardReporter} from '../../src/forward-observations.ts';
import {routeBinding,signForwardReport,type ForwardReport} from '../../src/forward-report.ts';

export async function forwardFixture(){
 const db=await database(),remote=new RemoteAccessStore(db.pool,'test-free-paid'),store=new ForwardObservationStore(db.pool,'test-free-paid');
 const signup=new SignupStore(db.pool,db.outbox);await signup.request(`forward-${randomUUID()}@example.test`);
 const mail=db.outbox.open((await db.pool.query("SELECT * FROM email_outbox WHERE kind='verification' ORDER BY created_at DESC LIMIT 1")).rows[0]);assert('token'in mail);
 const owner=await signup.complete(mail.token,{password:'a long private forwarding password',organisationName:'Café Sol',legalBusinessName:'Café Sol SL',countryCode:'ES'});
 await new OrganisationPlanStore(db.pool).set(owner.organisationId,'paid');
 const registration=new RegistrationStore(db.pool),input={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test' as const,organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
 await registration.start(input);await registration.approveCloud(input,owner.accountId);await registration.approveLocal(input,randomUUID());const installed=await registration.complete(input);
 const cellId=randomUUID(),gatewayId=randomUUID(),keys=generateKeyPairSync('ed25519'),publicKey=keys.publicKey.export({type:'spki',format:'pem'}).toString();
 await remote.createCell({id:cellId,country:'ES',provider:'aws',environment:'test',suffix:'forward.example.test',subnet:19,publicKey:randomBytes(32).toString('base64'),endpoint:'gateway.example.test:51820'});
 await remote.provision(installed.installationId,cellId,randomBytes(32).toString('base64'));
 await transaction(db.pool,c=>registerForwardReporter(c,{cellId,gatewayId,generation:1,publicKey}));
 const manifest=await remote.reportingManifest(cellId);assert.equal(manifest.version,2);
 if(manifest.version!==2)throw new Error('missing v2');const route=manifest.routes[0]!;
 const mapping={country:'ES' as const,environment:'test' as const,cellId,file:'/country/forward/report.json',writerUid:0,readerGid:1000};
 function report(sequence=1,category:ForwardReport['observations'][number]['category']='upstream_transport'):ForwardReport{
  const now=Date.now();return {version:1,audience:'waitron-cloud-public-forward-report',cellId,gatewayId,generation:1,sequence,issuedAt:now,observations:[{cellId,gatewayId,generation:1,installationId:installed.installationId,venueId:installed.venueId,revision:1,routeId:'public_availability',routeBinding:routeBinding(route),manifestSequence:manifest.sequence,manifestExpiresAt:manifest.expiresAt,observationSequence:sequence,category,observedAt:now,expiresAt:Math.min(now+300000,manifest.expiresAt)}]};
 }
 const send=(value=report())=>store.record(mapping,signForwardReport(value,keys.privateKey));
 const read=()=>transaction(db.pool,c=>store.readCurrent(c,installed.installationId));
 const budget=()=>db.pool.query("UPDATE remote_forward_reporters SET next_accept_at='-infinity' WHERE cell_id=$1",[cellId]);
 return {db,remote,store,owner,installed,cellId,gatewayId,keys,publicKey,manifest,mapping,report,send,read,budget};
}
