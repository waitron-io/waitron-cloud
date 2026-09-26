import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {generateKeyPairSync,randomBytes,randomUUID,X509Certificate} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {RegistrationStore,SignupStore} from '../packages/registration/src/index.ts';
import {database} from '../packages/account-http/test/fixtures.ts';
import {RemoteAccessStore} from '../packages/remote-access/src/placement.ts';
import {FileReconcilerArtifacts} from '../packages/remote-access/src/reconciler-files.ts';
import {RemoteConfigurationReconciler} from '../packages/remote-access/src/reconciler.ts';
import {verifyManifest} from '../packages/remote-access/src/manifest.ts';
import {startAcme} from './remote-fixtures.mjs';
import {verifyRemoteReconcilerReceipt} from './verify-remote-reconciler-receipt.mjs';

const require=createRequire(new URL('../packages/remote-access/package.json',import.meta.url)),{crypto:acmeCrypto}=require('acme-client');
const waitron=resolve(process.env.WAITRON_CHECKOUT??'');assert.ok(process.env.WAITRON_CHECKOUT,'Set WAITRON_CHECKOUT to a clean Waitron checkout');
const receiptFile=resolve(process.argv[2]??'/tmp/cloud-remote-reconciler-receipt.json'),cloud=resolve(new URL('..',import.meta.url).pathname);
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim(),waitronHead=git(waitron,'rev-parse','HEAD');
assert.equal(git(waitron,'status','--porcelain'),'','WAITRON_CHECKOUT must be clean');
const root=await mkdtemp(join(tmpdir(),'cloud-reconciler-proof-')),waitronState=await mkdtemp(join(tmpdir(),'waitron-reconciler-proof-')),db=await database();let acme;
const peerKey=()=>randomBytes(32).toString('base64'),checks=[];
async function installation(email){
 const signup=new SignupStore(db.pool,db.outbox);await signup.request(email);const mail=db.outbox.open((await db.pool.query("SELECT * FROM email_outbox WHERE kind='verification' ORDER BY created_at DESC LIMIT 1")).rows[0]);
 const owner=await signup.complete(mail.token,{password:'a long enough test password',organisationName:'Reconciler proof',legalBusinessName:'Reconciler proof SL',countryCode:'ES'});
 const binding={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
 const registrations=new RegistrationStore(db.pool);await registrations.start(binding);await registrations.approveCloud(binding,owner.accountId);await registrations.approveLocal(binding,randomUUID());return registrations.complete(binding);
}
const waitronCertificate=(command,hostname,file)=>execFileSync('pnpm',['--filter','@waitron/server','exec','tsx','scripts/cloud-certificate.ts',command,waitronState,hostname,file],{cwd:waitron,encoding:'utf8',timeout:30000});
try{
 acme=await startAcme();const store=new RemoteAccessStore(db.pool),cellId=randomUUID(),signing=generateKeyPairSync('ed25519');
 await store.createCell({id:cellId,country:'ES',provider:'aws',environment:'test',suffix:'reconciler.remote.example.test',subnet:61,publicKey:peerKey(),endpoint:'gateway.reconciler.example.test:51820'});
 const selected=await installation(`selected-${randomUUID()}@example.test`),other=await installation(`other-${randomUUID()}@example.test`);
 const selectedPlacement=await store.provision(selected.installationId,cellId,peerKey()),otherPlacement=await store.provision(other.installationId,cellId,peerKey());
 const staffCsr=join(root,'staff.csr'),staffCertificate=join(root,'staff.crt');waitronCertificate('csr',selectedPlacement.staffHostname,staffCsr);
 let [,publicCsrBytes]=await acmeCrypto.createCsr({commonName:selectedPlacement.publicHostname,altNames:[selectedPlacement.publicHostname]});const publicCsr=join(root,'public.csr'),publicCertificate=join(root,'public.crt');await writeFile(publicCsr,publicCsrBytes,{mode:0o600});
 const manifestFile=join(root,'manifest.json'),accountKeyFile=join(root,'account.key');await writeFile(accountKeyFile,await acmeCrypto.createPrivateKey(),{mode:0o600});
 const files=new FileReconcilerArtifacts({routes:[{cellId,output:manifestFile}],certificates:[{installationId:selected.installationId,kind:'staff',csrFile:staffCsr,output:staffCertificate},{installationId:selected.installationId,kind:'public',csrFile:publicCsr,output:publicCertificate}]});
 let issuances=0,routePublications=0;const envelopes=[];
 const artifacts={readCsr:(...args)=>files.readCsr(...args),readCertificate:(...args)=>files.readCertificate(...args),publishCertificate:(...args)=>files.publishCertificate(...args),async publishManifest(id,envelope){routePublications++;envelopes.push(JSON.parse(envelope));await files.publishManifest(id,envelope);}};
 const issue=async target=>{issuances++;const csrFile=join(root,`issue-${randomUUID()}.csr`),output=join(root,`issue-${randomUUID()}.crt`);await writeFile(csrFile,target.csr,{mode:0o600});return acme.issue({hostname:target.hostname,csrFile,accountKeyFile,output,dnsName:target.dnsName});};
 const options={artifacts,issueCertificate:issue,signingKeyForCell:async id=>{assert.equal(id,cellId);return signing.privateKey;}},worker=new RemoteConfigurationReconciler(db.pool,options);await worker.schedule();
 await db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE target_id=$1 AND kind LIKE 'certificate_%'",[other.installationId]);
 let initialRuns=0;while(await worker.runOnce()){if(++initialRuns>3)throw new Error('unexpected initial reconciliation work');}
 assert.equal(initialRuns,3);assert.equal(issuances,2);assert.equal(routePublications,1);checks.push('initial route plus public and staff certificates reconciled through local adapters');
 const initialStaff=new X509Certificate(await readFile(staffCertificate)),initialPublic=new X509Certificate(await readFile(publicCertificate));
 waitronCertificate('install',selectedPlacement.staffHostname,staffCertificate);assert.equal(await readFile(join(waitronState,'cloud-staff.crt'),'utf8'),await readFile(staffCertificate,'utf8'));
 const staffPrivate=await readFile(join(waitronState,'cloud-staff.key'),'utf8'),cloudArtifacts=(await Promise.all([staffCsr,staffCertificate,publicCsr,publicCertificate,manifestFile].map(file=>readFile(file,'utf8')))).join('\n');assert.equal(cloudArtifacts.includes(staffPrivate),false);checks.push('Waitron existing install interface accepted the staff chain while its private key stayed in Waitron state');
 const firstManifest=verifyManifest(envelopes[0],signing.publicKey,cellId);assert.deepEqual(firstManifest.routes.map(route=>route.installationId).sort(),[selected.installationId,other.installationId].sort());
 assert.notEqual(firstManifest.routes.find(route=>route.installationId===selected.installationId)?.peerPublicKey,otherPlacement.peerPublicKey);checks.push('signed route projection contains two isolated venue identities');

 await db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp() WHERE kind='route' AND target_id=$1",[cellId]);
 const restartedA=new RemoteConfigurationReconciler(db.pool,options),restartedB=new RemoteConfigurationReconciler(db.pool,options),restartResults=(await Promise.all([restartedA.runOnce(),restartedB.runOnce()])).sort();assert.deepEqual(restartResults,[false,true]);assert.equal(routePublications,2);
 const secondManifest=verifyManifest(envelopes[1],signing.publicKey,cellId,Date.now(),firstManifest.sequence);checks.push('worker restart and duplicate claim published one newer route manifest');

 await rm(join(waitronState,'cloud-staff.key'));waitronCertificate('csr',selectedPlacement.staffHostname,staffCsr);
 [,publicCsrBytes]=await acmeCrypto.createCsr({commonName:selectedPlacement.publicHostname,altNames:[selectedPlacement.publicHostname]});await writeFile(publicCsr,publicCsrBytes,{mode:0o600});
 await db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp() WHERE target_id=$1 AND kind LIKE 'certificate_%'",[selected.installationId]);assert.equal(await worker.runOnce(),true);assert.equal(await worker.runOnce(),true);
 const renewedStaff=new X509Certificate(await readFile(staffCertificate)),renewedPublic=new X509Certificate(await readFile(publicCertificate));assert.notEqual(renewedStaff.serialNumber,initialStaff.serialNumber);assert.notEqual(renewedPublic.serialNumber,initialPublic.serialNumber);
 waitronCertificate('install',selectedPlacement.staffHostname,staffCertificate);checks.push('periodic checks renewed both chains after their CSR keys changed and Waitron installed the new staff chain');

 const retained=await readFile(staffCertificate,'utf8');await rm(join(waitronState,'cloud-staff.key'));waitronCertificate('csr',selectedPlacement.staffHostname,staffCsr);await db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp() WHERE kind='certificate_staff' AND target_id=$1",[selected.installationId]);
 await new RemoteConfigurationReconciler(db.pool,{...options,issueCertificate:async()=>{throw new Error('local injected failure');}}).runOnce();assert.equal(await readFile(staffCertificate,'utf8'),retained);checks.push('failed renewal retained the usable staff chain');

 const staleCsr=await readFile(staffCsr,'utf8'),staleFile=join(root,'stale-issued.crt');await writeFile(join(root,'stale.csr'),staleCsr,{mode:0o600});const staleChain=await acme.issue({hostname:selectedPlacement.staffHostname,csrFile:join(root,'stale.csr'),accountKeyFile,output:staleFile,dnsName:`_acme-challenge.${selectedPlacement.staffHostname}`});
 let enter,release;let entered=new Promise(resolve=>{enter=resolve;}),gate=new Promise(resolve=>{release=resolve;});await db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp() WHERE kind='certificate_staff' AND target_id=$1",[selected.installationId]);
 let running=new RemoteConfigurationReconciler(db.pool,{...options,issueCertificate:async()=>{enter();await gate;return staleChain;}}).runOnce();await entered;
 await db.pool.query("UPDATE remote_hostnames SET hostname='changed.reconciler.example.test' WHERE venue_id=$1 AND kind='staff'",[selected.venueId]);await db.pool.query('UPDATE installations SET configuration_revision=configuration_revision+1 WHERE id=$1',[selected.installationId]);release();await running;assert.equal(await readFile(staffCertificate,'utf8'),retained);checks.push('hostname change fenced a late locally issued certificate');

 const [,leaseCsrBytes]=await acmeCrypto.createCsr({commonName:selectedPlacement.publicHostname,altNames:[selectedPlacement.publicHostname]});await writeFile(publicCsr,leaseCsrBytes,{mode:0o600});const leaseCsrFile=join(root,'lease.csr'),leaseOutput=join(root,'lease.crt');await writeFile(leaseCsrFile,leaseCsrBytes,{mode:0o600});const leaseChain=await acme.issue({hostname:selectedPlacement.publicHostname,csrFile:leaseCsrFile,accountKeyFile,output:leaseOutput});const publicRetained=await readFile(publicCertificate,'utf8');
 entered=new Promise(resolve=>{enter=resolve;});gate=new Promise(resolve=>{release=resolve;});await db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp() WHERE kind='certificate_public' AND target_id=$1",[selected.installationId]);
 running=new RemoteConfigurationReconciler(db.pool,{...options,issueCertificate:async()=>{enter();await gate;return leaseChain;}}).runOnce();await entered;await db.pool.query("UPDATE remote_configuration_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE kind='certificate_public' AND target_id=$1",[selected.installationId]);release();await running;assert.equal(await readFile(publicCertificate,'utf8'),publicRetained);checks.push('expired lease fenced a late locally issued certificate');

 const failedTarget=(await db.pool.query("SELECT failures FROM remote_configuration_jobs WHERE target_id=$1 AND kind='certificate_staff'",[selected.installationId])).rows[0],otherJobs=await db.pool.query("SELECT count(*)::integer AS count FROM remote_configuration_jobs WHERE target_id=$1 AND enabled",[other.installationId]);assert.equal(otherJobs.rows[0].count,2);
 const receipt={version:1,cloudHead:git(cloud,'rev-parse','HEAD'),waitronHead,cloudDirty:git(cloud,'status','--porcelain')!=='',waitronDirty:git(waitron,'status','--porcelain')!=='',liveResources:false,
  routes:{signed:true,sequences:[firstManifest.sequence,secondManifest.sequence],duplicatePublications:routePublications-2,otherVenueIsolated:true,restartRecovered:true},
  certificates:{staff:{initialSerial:initialStaff.serialNumber,renewedSerial:renewedStaff.serialNumber,initialFingerprint:initialStaff.fingerprint256,renewedFingerprint:renewedStaff.fingerprint256,installedWithWaitronInterface:true,privateKeyStayedInWaitron:true},public:{initialSerial:initialPublic.serialNumber,renewedSerial:renewedPublic.serialNumber,initialFingerprint:initialPublic.fingerprint256,renewedFingerprint:renewedPublic.fingerprint256},failedRenewalRetained:true,hostnameChangeFenced:true,expiredLeaseFenced:true,duplicateIssuances:issuances-4},
  worker:{restartRecoveredExpiredLease:true,failedTargetAttempts:Number(failedTarget.failures)},checks};
 verifyRemoteReconcilerReceipt(receipt);await writeFile(receiptFile,JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt,null,2));
}finally{await acme?.close();await db.close();await rm(root,{recursive:true,force:true});await rm(waitronState,{recursive:true,force:true});}
