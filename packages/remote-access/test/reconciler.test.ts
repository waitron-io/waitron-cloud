import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {after,before,test} from 'node:test';
import {crypto as acmeCrypto} from 'acme-client';
import forge from 'node-forge';
import {Pool} from 'pg';
import {RegistrationStore,SignupStore} from '@waitron-cloud/registration';
import {database} from '../../account-http/test/fixtures.ts';
import {RemoteAccessStore} from '../src/placement.ts';
import {RemoteConfigurationReconciler} from '../src/reconciler.ts';
import {verifyManifest} from '../src/manifest.ts';

const peerKey=()=>randomBytes(32).toString('base64');
let db:Awaited<ReturnType<typeof database>>,placements:RemoteAccessStore,sequence=0;

before(async()=>{db=await database();placements=new RemoteAccessStore(db.pool);});
after(async()=>{await db?.close();});

async function installation(){
 const email=`reconciler-${++sequence}@example.test`,signup=new SignupStore(db.pool,db.outbox);await signup.request(email);
 const mail=db.outbox.open((await db.pool.query("SELECT * FROM email_outbox WHERE kind='verification' ORDER BY created_at DESC LIMIT 1")).rows[0]);assert.ok('token' in mail);
 const owner=await signup.complete(mail.token,{password:'a long enough test password',organisationName:'Cafés',legalBusinessName:'Cafés SL',countryCode:'ES'});
 const binding={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test' as const,organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
 const registrations=new RegistrationStore(db.pool);await registrations.start(binding);await registrations.approveCloud(binding,owner.accountId);await registrations.approveLocal(binding,randomUUID());return registrations.complete(binding);
}

test('scheduling projects stable route and certificate targets for active placements',async()=>{
 const cell={id:randomUUID(),country:'ES',provider:'aws',environment:'test',suffix:'reconcile.example.test',subnet:41,publicKey:peerKey(),endpoint:'gateway.reconcile.example.test:51820'};
 await placements.createCell(cell);
 for(let n=0;n<2;n++){const current=await installation();await placements.provision(current.installationId,cell.id,peerKey());}
 const worker=new RemoteConfigurationReconciler(db.pool);
 assert.equal(await worker.schedule(),5);
 const first=await db.pool.query(`SELECT kind,target_id,desired_digest,status,enabled FROM remote_configuration_jobs ORDER BY kind,target_id`);
 assert.equal(first.rowCount,5);
 assert.deepEqual(first.rows.map(row=>row.kind),['certificate_public','certificate_public','certificate_staff','certificate_staff','route']);
 for(const row of first.rows){assert.match(row.desired_digest,/^[a-f0-9]{64}$/);assert.equal(row.status,'pending');assert.equal(row.enabled,true);}
 assert.equal(await worker.schedule(),0);
 const second=await db.pool.query('SELECT kind,target_id,desired_digest FROM remote_configuration_jobs ORDER BY kind,target_id');
 assert.deepEqual(second.rows,first.rows.map(({kind,target_id,desired_digest})=>({kind,target_id,desired_digest})));
});

async function onePlacement(subnet:number){
 await db.pool.query('TRUNCATE remote_configuration_jobs');
 const cell={id:randomUUID(),country:'ES',provider:'aws',environment:'test',suffix:`reconcile-${subnet}.example.test`,subnet,publicKey:peerKey(),endpoint:`gateway-${subnet}.reconcile.example.test:51820`};
 await placements.createCell(cell);const current=await installation(),placed=await placements.provision(current.installationId,cell.id,peerKey());return {...current,cell,placement:placed};
}

async function csrAndCertificate(hostname:string,days=90){
 const [keyBytes,csrBytes]=await acmeCrypto.createCsr({commonName:hostname,altNames:[hostname]}),key=keyBytes.toString(),csr=csrBytes.toString();
 return {key,csr,certificate:certificateFor(key,csr,hostname,days)};
}
function certificateFor(key:string,csr:string,hostname:string,days:number){
 const request=forge.pki.certificationRequestFromPem(csr);
 const certificate=forge.pki.createCertificate();certificate.publicKey=request.publicKey!;certificate.serialNumber=randomBytes(8).toString('hex');certificate.setSubject([{name:'commonName',value:hostname}]);certificate.setIssuer(certificate.subject.attributes);
 certificate.validity.notBefore=new Date(Date.now()-90*86400000);certificate.validity.notAfter=new Date(Date.now()+days*86400000);certificate.setExtensions([{name:'subjectAltName',altNames:[{type:2,value:hostname}]}]);certificate.sign(forge.pki.privateKeyFromPem(key));
 return forge.pki.certificateToPem(certificate);
}

function memoryArtifacts(target:{installationId:string;placement:{staffHostname:string;publicHostname:string}}){
 const csrs=new Map<string,string>(),certificates=new Map<string,string>(),publications:string[]=[];
 return {csrs,certificates,publications,adapter:{
  async readCsr(installationId:string,kind:'staff'|'public'){const value=csrs.get(`${installationId}:${kind}`);if(!value)throw new Error('missing_csr');return value;},
  async readCertificate(installationId:string,kind:'staff'|'public'){return certificates.get(`${installationId}:${kind}`);},
  async publishCertificate(installationId:string,kind:'staff'|'public',value:string){publications.push(`${installationId}:${kind}`);certificates.set(`${installationId}:${kind}`,value);},
  async publishManifest(){throw new Error('unexpected_route');},
 },target};
}

test('duplicate workers claim one target and an expired lease cannot acknowledge over its replacement',async()=>{
 const current=await onePlacement(42);let entered!:()=>void,release!:()=>void,replacementEntered!:()=>void,releaseReplacement!:()=>void,executions=0;
 const started=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 const replacementStarted=new Promise<void>(resolve=>{replacementEntered=resolve;}),replacementGate=new Promise<void>(resolve=>{releaseReplacement=resolve;});
 const first=new RemoteConfigurationReconciler(db.pool,{execute:async()=>{executions++;entered();await gate;}});await first.schedule();
 await db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE kind<>'route' OR target_id<>$1",[current.cell.id]);
 const old=first.runOnce();await started;
 const duplicate=await new RemoteConfigurationReconciler(db.pool,{execute:async()=>{executions++;}}).runOnce();
 assert.equal(duplicate,false);assert.equal(executions,1);
 await db.pool.query("UPDATE remote_configuration_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE kind='route' AND target_id=$1",[current.cell.id]);
 const replacement=new RemoteConfigurationReconciler(db.pool,{execute:async(_job,{isCurrent})=>{assert.equal(await isCurrent(),true);executions++;replacementEntered();await replacementGate;}}).runOnce();await replacementStarted;
 release();await old;const duringReplacement=(await db.pool.query("SELECT status,runs,attempts,applied_digest=desired_digest AS applied FROM remote_configuration_jobs WHERE kind='route' AND target_id=$1",[current.cell.id])).rows[0];assert.deepEqual(duringReplacement,{status:'running',runs:'2',attempts:2,applied:null});
 releaseReplacement();assert.equal(await replacement,true);
 const row=(await db.pool.query("SELECT status,runs,attempts,applied_digest=desired_digest AS applied FROM remote_configuration_jobs WHERE kind='route' AND target_id=$1",[current.cell.id])).rows[0];
 assert.deepEqual(row,{status:'pending',runs:'2',attempts:0,applied:true});assert.equal(executions,2);
});

test('an expired eighth claim is parked instead of becoming invisible to workers',async()=>{
 const current=await onePlacement(51),worker=new RemoteConfigurationReconciler(db.pool);await worker.schedule();
 await db.pool.query("UPDATE remote_configuration_jobs SET status='running',attempts=8,claim_id=$2,lease_until=clock_timestamp()-interval '1 second' WHERE kind='route' AND target_id=$1",[current.cell.id,randomUUID()]);
 assert.equal(await worker.runOnce(),true);
 const row=(await db.pool.query("SELECT status,attempts,last_error FROM remote_configuration_jobs WHERE kind='route' AND target_id=$1",[current.cell.id])).rows[0];assert.deepEqual(row,{status:'failed',attempts:8,last_error:'reconcile_failed'});
 const status=await db.pool.query("SELECT count(*) FILTER(WHERE enabled AND status='failed')::integer AS failed FROM remote_configuration_jobs");assert.equal(status.rows[0].failed,1);
});

test('eight failures park one target while another target progresses',async()=>{
 const current=await onePlacement(43);let publicRuns=0,staffRuns=0;
 const worker=new RemoteConfigurationReconciler(db.pool,{execute:async job=>{if(job.kind==='certificate_public'){publicRuns++;throw new Error('private provider detail');}if(job.kind==='certificate_staff')staffRuns++;}});await worker.schedule();
 await db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE kind<>'certificate_public' OR target_id<>$1",[current.installationId]);
 for(let attempt=0;attempt<8;attempt++){
  await db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp() WHERE kind='certificate_public' AND target_id=$1",[current.installationId]);
  assert.equal(await worker.runOnce(),true);
 }
 const failed=(await db.pool.query("SELECT status,attempts,failures,last_error FROM remote_configuration_jobs WHERE kind='certificate_public' AND target_id=$1",[current.installationId])).rows[0];
 assert.deepEqual(failed,{status:'failed',attempts:8,failures:'8',last_error:'reconcile_failed'});assert.equal(publicRuns,8);
 await db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp() WHERE kind='certificate_staff' AND target_id=$1",[current.installationId]);
 assert.equal(await worker.runOnce(),true);assert.equal(staffRuns,1);
});

test('changed desired state resets a parked target and revocation disables certificate work',async()=>{
 const current=await onePlacement(44),worker=new RemoteConfigurationReconciler(db.pool,{execute:async()=>{throw new Error('fail');}});await worker.schedule();
 await db.pool.query("UPDATE remote_configuration_jobs SET status='failed',attempts=8,available_at=clock_timestamp()-interval '1 day' WHERE kind='certificate_staff' AND target_id=$1",[current.installationId]);
 const previous=(await db.pool.query("SELECT desired_digest FROM remote_configuration_jobs WHERE kind='certificate_staff' AND target_id=$1",[current.installationId])).rows[0].desired_digest;
 await db.pool.query("UPDATE remote_hostnames SET hostname='new-staff.reconcile.example.test' WHERE venue_id=$1 AND kind='staff'",[current.venueId]);
 await db.pool.query('UPDATE installations SET configuration_revision=configuration_revision+1 WHERE id=$1',[current.installationId]);
 assert.ok(await worker.schedule());
 const changed=(await db.pool.query("SELECT desired_digest,status,attempts,enabled FROM remote_configuration_jobs WHERE kind='certificate_staff' AND target_id=$1",[current.installationId])).rows[0];
 assert.notEqual(changed.desired_digest,previous);assert.deepEqual({status:changed.status,attempts:changed.attempts,enabled:changed.enabled},{status:'pending',attempts:0,enabled:true});
 const routeBefore=(await db.pool.query("SELECT desired_digest FROM remote_configuration_jobs WHERE kind='route' AND target_id=$1",[current.cell.id])).rows[0].desired_digest;
 const revoked=await db.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[current.installationId]);assert.equal(revoked.rowCount,1);
 const active=await db.pool.query('SELECT 1 FROM remote_placements p JOIN installations i ON i.id=p.installation_id WHERE p.cell_id=$1 AND i.revoked_at IS NULL',[current.cell.id]);assert.equal(active.rowCount,0);
 assert.ok(await worker.schedule());
 const certificates=await db.pool.query("SELECT enabled FROM remote_configuration_jobs WHERE target_id=$1 AND kind LIKE 'certificate_%'",[current.installationId]);
 assert.deepEqual(certificates.rows,[{enabled:false},{enabled:false}]);
 const routeAfter=(await db.pool.query("SELECT desired_digest FROM remote_configuration_jobs WHERE kind='route' AND target_id=$1",[current.cell.id])).rows[0].desired_digest;
 assert.notEqual(routeAfter,routeBefore);assert.equal(routeAfter,createHash('sha256').update('[]').digest('hex'));
});

test('a hostname change during issuance fences the late chain and retains prior material',async()=>{
 const current=await onePlacement(45),memory=memoryArtifacts(current),material=await csrAndCertificate(current.placement.staffHostname),prior='usable-prior-chain';
 memory.csrs.set(`${current.installationId}:staff`,material.csr);memory.certificates.set(`${current.installationId}:staff`,prior);
 let entered!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 const worker=new RemoteConfigurationReconciler(db.pool,{artifacts:memory.adapter,issueCertificate:async()=>{entered();await gate;return material.certificate;}});await worker.schedule();
 await db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE kind<>'certificate_staff' OR target_id<>$1",[current.installationId]);
 const running=worker.runOnce();await started;
 await db.pool.query("UPDATE remote_hostnames SET hostname='changed.reconcile.example.test' WHERE venue_id=$1 AND kind='staff'",[current.venueId]);
 await db.pool.query('UPDATE installations SET configuration_revision=configuration_revision+1 WHERE id=$1',[current.installationId]);
 release();await running;
 assert.deepEqual(memory.publications,[]);assert.equal(memory.certificates.get(`${current.installationId}:staff`),prior);
 const job=(await db.pool.query("SELECT status,last_error,applied_digest FROM remote_configuration_jobs WHERE kind='certificate_staff' AND target_id=$1",[current.installationId])).rows[0];
 assert.deepEqual(job,{status:'pending',last_error:'reconcile_failed',applied_digest:null});
});

test('a revision-only change during issuance fences the late chain',async()=>{
 const current=await onePlacement(48),memory=memoryArtifacts(current),material=await csrAndCertificate(current.placement.staffHostname,1),renewed=certificateFor(material.key,material.csr,current.placement.staffHostname,90);
 memory.csrs.set(`${current.installationId}:staff`,material.csr);memory.certificates.set(`${current.installationId}:staff`,material.certificate);
 let entered!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 const worker=new RemoteConfigurationReconciler(db.pool,{artifacts:memory.adapter,issueCertificate:async()=>{entered();await gate;return renewed;}});await worker.schedule();
 await db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE kind<>'certificate_staff' OR target_id<>$1",[current.installationId]);
 const running=worker.runOnce();await started;await db.pool.query('UPDATE installations SET configuration_revision=configuration_revision+1 WHERE id=$1',[current.installationId]);release();await running;
 assert.deepEqual(memory.publications,[]);assert.equal(memory.certificates.get(`${current.installationId}:staff`),material.certificate);
});

test('certificate checks skip usable material, renew expiring material and retain it on issuer failure',async()=>{
 const current=await onePlacement(46),memory=memoryArtifacts(current),usable=await csrAndCertificate(current.placement.staffHostname,90),expiring=await csrAndCertificate(current.placement.publicHostname,1),renewed=certificateFor(expiring.key,expiring.csr,current.placement.publicHostname,90);
 memory.csrs.set(`${current.installationId}:staff`,usable.csr);memory.certificates.set(`${current.installationId}:staff`,usable.certificate);
 memory.csrs.set(`${current.installationId}:public`,expiring.csr);memory.certificates.set(`${current.installationId}:public`,expiring.certificate);
 let issues=0;const worker=new RemoteConfigurationReconciler(db.pool,{artifacts:memory.adapter,issueCertificate:async target=>{issues++;assert.equal(target.kind,'public');return renewed;}});await worker.schedule();
 await db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE kind='route' OR target_id<>$1",[current.installationId]);
 assert.equal(await worker.runOnce(),true);assert.equal(await worker.runOnce(),true);assert.equal(issues,1);assert.deepEqual(memory.publications,[`${current.installationId}:public`]);
 memory.certificates.set(`${current.installationId}:public`,expiring.certificate);await db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp() WHERE kind='certificate_public' AND target_id=$1",[current.installationId]);
 const failed=new RemoteConfigurationReconciler(db.pool,{artifacts:memory.adapter,issueCertificate:async()=>{throw new Error('provider secret');}});await failed.runOnce();
 assert.equal(memory.certificates.get(`${current.installationId}:public`),expiring.certificate);assert.deepEqual(memory.publications,[`${current.installationId}:public`]);
});

test('concurrent certificate completions do not require a second pool connection each',async()=>{
 const current=await onePlacement(52),memory=memoryArtifacts(current),staff=await csrAndCertificate(current.placement.staffHostname,1),publicMaterial=await csrAndCertificate(current.placement.publicHostname,1);
 memory.csrs.set(`${current.installationId}:staff`,staff.csr);memory.certificates.set(`${current.installationId}:staff`,staff.certificate);memory.csrs.set(`${current.installationId}:public`,publicMaterial.csr);memory.certificates.set(`${current.installationId}:public`,publicMaterial.certificate);
 const limited=new Pool({connectionString:process.env.TEST_DATABASE_URL!,options:`-c search_path=${db.schema}`,max:2,connectionTimeoutMillis:500});
 try{
  let entered=0,release!:()=>void;const bothEntered=new Promise<void>(resolve=>{release=resolve;});
  const worker=new RemoteConfigurationReconciler(limited,{artifacts:memory.adapter,issueCertificate:async target=>{if(++entered===2)release();await bothEntered;const material=target.kind==='staff'?staff:publicMaterial;return certificateFor(material.key,material.csr,target.hostname,90);}});await worker.schedule();
  await limited.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE kind='route' OR target_id<>$1",[current.installationId]);
  assert.deepEqual(await Promise.all([worker.runOnce(),worker.runOnce()]),[true,true]);assert.deepEqual(memory.publications.sort(),[`${current.installationId}:public`,`${current.installationId}:staff`]);
 }finally{await limited.end();}
});

test('shutdown during certificate issuance retains material without consuming an attempt',async()=>{
 const current=await onePlacement(53),memory=memoryArtifacts(current),material=await csrAndCertificate(current.placement.staffHostname,1),renewed=certificateFor(material.key,material.csr,current.placement.staffHostname,90),controller=new AbortController();
 memory.csrs.set(`${current.installationId}:staff`,material.csr);memory.certificates.set(`${current.installationId}:staff`,material.certificate);
 let entered!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
 const worker=new RemoteConfigurationReconciler(db.pool,{artifacts:memory.adapter,issueCertificate:async()=>{entered();await gate;return renewed;}});await worker.schedule();
 await db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE kind<>'certificate_staff' OR target_id<>$1",[current.installationId]);
 const running=worker.runOnce(controller.signal);await started;controller.abort();release();await running;
 assert.deepEqual(memory.publications,[]);const row=(await db.pool.query("SELECT status,attempts,failures,last_error FROM remote_configuration_jobs WHERE kind='certificate_staff' AND target_id=$1",[current.installationId])).rows[0];assert.deepEqual(row,{status:'pending',attempts:0,failures:'0',last_error:null});
});

test('changed desired state is refused before certificate issuance or route signing',async()=>{
 const current=await onePlacement(54),memory=memoryArtifacts(current),material=await csrAndCertificate(current.placement.staffHostname,1);memory.csrs.set(`${current.installationId}:staff`,material.csr);memory.certificates.set(`${current.installationId}:staff`,material.certificate);
 let issues=0;const certificateWorker=new RemoteConfigurationReconciler(db.pool,{artifacts:memory.adapter,issueCertificate:async()=>{issues++;return certificateFor(material.key,material.csr,current.placement.staffHostname,90);}});await certificateWorker.schedule();
 await db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE kind<>'certificate_staff' OR target_id<>$1",[current.installationId]);await db.pool.query('UPDATE installations SET configuration_revision=configuration_revision+1 WHERE id=$1',[current.installationId]);
 assert.equal(await certificateWorker.runOnce(),true);assert.equal(issues,0);assert.deepEqual(memory.publications,[]);
 await db.pool.query("UPDATE remote_configuration_jobs SET available_at=CASE WHEN kind='route' AND target_id=$1 THEN clock_timestamp() ELSE clock_timestamp()+interval '1 day' END",[current.cell.id]);await db.pool.query('UPDATE remote_placements SET peer_public_key=$2 WHERE installation_id=$1',[current.installationId,peerKey()]);
 const published:string[]= [];let keyReads=0;const routeWorker=new RemoteConfigurationReconciler(db.pool,{artifacts:{...memory.adapter,async publishManifest(_cellId:string,envelope:string){published.push(envelope);}},signingKeyForCell:async()=>{keyReads++;return generateKeyPairSync('ed25519').privateKey;}});
 assert.equal(await routeWorker.runOnce(),true);assert.equal(keyReads,0);assert.deepEqual(published,[]);
});

test('a changed CSR or expired claim cannot publish a completed issuance',async()=>{
 const current=await onePlacement(47),memory=memoryArtifacts(current),original=await csrAndCertificate(current.placement.staffHostname,1),changed=await csrAndCertificate(current.placement.staffHostname,1),renewed=certificateFor(original.key,original.csr,current.placement.staffHostname,90);
 memory.csrs.set(`${current.installationId}:staff`,original.csr);memory.certificates.set(`${current.installationId}:staff`,original.certificate);
 let release!:()=>void,entered!:()=>void;let gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
 let worker=new RemoteConfigurationReconciler(db.pool,{artifacts:memory.adapter,issueCertificate:async()=>{entered();await gate;return renewed;}});await worker.schedule();
 await db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE kind<>'certificate_staff' OR target_id<>$1",[current.installationId]);
 let running=worker.runOnce();await started;memory.csrs.set(`${current.installationId}:staff`,changed.csr);release();await running;assert.deepEqual(memory.publications,[]);
 memory.csrs.set(`${current.installationId}:staff`,original.csr);await db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp() WHERE kind='certificate_staff' AND target_id=$1",[current.installationId]);
 gate=new Promise<void>(resolve=>{release=resolve;});started=new Promise<void>(resolve=>{entered=resolve;});worker=new RemoteConfigurationReconciler(db.pool,{artifacts:memory.adapter,issueCertificate:async()=>{entered();await gate;return renewed;}});
 running=worker.runOnce();await started;await db.pool.query("UPDATE remote_configuration_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE kind='certificate_staff' AND target_id=$1",[current.installationId]);
 let replacementEntered!:()=>void,releaseReplacement!:()=>void;const replacementStarted=new Promise<void>(resolve=>{replacementEntered=resolve;}),replacementGate=new Promise<void>(resolve=>{releaseReplacement=resolve;});
 const replacement=new RemoteConfigurationReconciler(db.pool,{artifacts:memory.adapter,issueCertificate:async()=>{replacementEntered();await replacementGate;return renewed;}}).runOnce();await replacementStarted;
 release();await running;assert.deepEqual(memory.publications,[]);assert.equal(memory.certificates.get(`${current.installationId}:staff`),original.certificate);
 releaseReplacement();await replacement;assert.deepEqual(memory.publications,[`${current.installationId}:staff`]);
});

test('route workers publish one signed current manifest and refresh it after five minutes',async()=>{
 const current=await onePlacement(49),signing=generateKeyPairSync('ed25519'),published:string[]=[];
 const artifacts={async readCsr(){throw new Error('unexpected_certificate');},async readCertificate(){throw new Error('unexpected_certificate');},async publishCertificate(){throw new Error('unexpected_certificate');},async publishManifest(cellId:string,envelope:string){assert.equal(cellId,current.cell.id);published.push(envelope);}};
 const options={artifacts,signingKeyForCell:async(cellId:string)=>{assert.equal(cellId,current.cell.id);return signing.privateKey;}};
 const first=new RemoteConfigurationReconciler(db.pool,options),second=new RemoteConfigurationReconciler(db.pool,options);await first.schedule();
 await db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE kind<>'route' OR target_id<>$1",[current.cell.id]);
 assert.deepEqual((await Promise.all([first.runOnce(),second.runOnce()])).sort(),[false,true]);const after=await db.pool.query("SELECT status,last_error,desired_digest,attempts FROM remote_configuration_jobs WHERE kind='route' AND target_id=$1",[current.cell.id]);assert.equal(published.length,1,JSON.stringify(after.rows[0]));
 const manifest=verifyManifest(JSON.parse(published[0]!),signing.publicKey,current.cell.id);assert.equal(manifest.routes.length,1);assert.equal(manifest.routes[0]!.installationId,current.installationId);
 const job=(await db.pool.query("SELECT status,applied_digest=desired_digest AS applied,extract(epoch FROM available_at-clock_timestamp()) AS wait_seconds FROM remote_configuration_jobs WHERE kind='route' AND target_id=$1",[current.cell.id])).rows[0];
 assert.equal(job.status,'pending');assert.equal(job.applied,true);assert.ok(Number(job.wait_seconds)>299&&Number(job.wait_seconds)<=300);
});

async function waitForDatabaseLock(pattern:string,count=1){
 for(let attempt=0;attempt<300;attempt++){
  const n=(await db.secondPool.query("SELECT count(*)::integer AS n FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE $2",[db.schema,pattern])).rows[0].n;
  if(n>=count)return;await new Promise(resolve=>setTimeout(resolve,10));
 }
 assert.fail('expected database lock wait: '+pattern);
}

test('reporting certificate completion and scheduling cannot deadlock each other',async()=>{
 const current=await onePlacement(61),memory=memoryArtifacts(current),material=await csrAndCertificate(current.placement.staffHostname,1),renewed=certificateFor(material.key,material.csr,current.placement.staffHostname,90);
 memory.csrs.set(`${current.installationId}:staff`,material.csr);memory.certificates.set(`${current.installationId}:staff`,material.certificate);
 let reads=0,entered!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);
 const worker=new RemoteConfigurationReconciler(db.pool,{forwardReports:true,artifacts:{...memory.adapter,async readCsr(id,kind){if(++reads===2){entered();await gate;}return memory.adapter.readCsr(id,kind);}},issueCertificate:async()=>renewed});
 await worker.schedule();await db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE kind<>'certificate_staff' OR target_id<>$1",[current.installationId]);
 const running=worker.runOnce();let scheduling:Promise<number>|undefined;
 try{
  await started;scheduling=worker.schedule();await waitForDatabaseLock('INSERT INTO remote_configuration_jobs%');release();
  const outcomes=await Promise.allSettled([running,scheduling]);assert(outcomes.every(o=>o.status==='fulfilled'),JSON.stringify(outcomes));assert.deepEqual(memory.publications,[`${current.installationId}:staff`]);
  const row=(await db.pool.query("SELECT failures,last_error,applied_digest=desired_digest AS applied FROM remote_configuration_jobs WHERE kind='certificate_staff' AND target_id=$1",[current.installationId])).rows[0];
  assert.deepEqual(row,{failures:'0',last_error:null,applied:true});
 }finally{release();await Promise.allSettled([running,...(scheduling?[scheduling]:[])]);}
});

test('reporting concurrent staff and public certificate completions serialize without lock upgrades',async()=>{
 const current=await onePlacement(62),memory=memoryArtifacts(current),staff=await csrAndCertificate(current.placement.staffHostname,1),publicMaterial=await csrAndCertificate(current.placement.publicHostname,1);
 for(const [kind,material] of [['staff',staff],['public',publicMaterial]] as const){memory.csrs.set(`${current.installationId}:${kind}`,material.csr);memory.certificates.set(`${current.installationId}:${kind}`,material.certificate);}
 let issues=0,entered!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);
 const worker=new RemoteConfigurationReconciler(db.pool,{forwardReports:true,artifacts:memory.adapter,issueCertificate:async target=>{if(++issues===2)entered();await gate;const m=target.kind==='staff'?staff:publicMaterial;return certificateFor(m.key,m.csr,target.hostname,90);}});
 await worker.schedule();await db.pool.query("UPDATE remote_configuration_jobs SET available_at=clock_timestamp()+interval '1 day' WHERE kind='route' OR target_id<>$1",[current.installationId]);
 const running=Promise.all([worker.runOnce(),worker.runOnce()]),held=await db.secondPool.connect();
 try{
  await started;await held.query('BEGIN');await held.query('SELECT 1 FROM installations WHERE id=$1 FOR SHARE',[current.installationId]);release();
  await waitForDatabaseLock('%FROM installations%FOR % OF i%',2);await held.query('COMMIT');await running;
  assert.deepEqual(memory.publications.sort(),[`${current.installationId}:public`,`${current.installationId}:staff`]);
  assert.deepEqual((await db.pool.query("SELECT failures,last_error,applied_digest=desired_digest AS applied FROM remote_configuration_jobs WHERE target_id=$1 ORDER BY kind",[current.installationId])).rows,[{failures:'0',last_error:null,applied:true},{failures:'0',last_error:null,applied:true}]);
 }finally{release();await held.query('ROLLBACK');held.release();await running;}
});
