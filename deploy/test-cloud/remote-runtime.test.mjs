import assert from 'node:assert/strict';
import test from 'node:test';
import {generateKeyPairSync,randomUUID,X509Certificate,createHash,createPublicKey} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm,stat,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync,spawn,spawnSync} from 'node:child_process';
import {database} from '../../packages/account-http/test/fixtures.ts';
import {OrganisationPlanStore} from '../../packages/registration/src/organisation-plans.ts';
import {RemoteAccessStore} from '../../packages/remote-access/src/placement.ts';
import {verifyManifest} from '../../packages/remote-access/src/manifest.ts';
import {bootstrapTestCloud} from './bootstrap.mjs';
import {loadRuntime} from '../local-stack/runtime.mjs';

// Empty-route publication, lost mode, or replacing a peer's CSR/key must break these results.
test('volume-backed remote reconciler publishes paid routes and trusted certificates and withdraws after restart', {timeout:60000},async t=>{
 const api=await import('./remote-runtime.mjs').catch(()=>({}));assert.equal(typeof api.openTestRemoteRuntime,'function','real test remote adapter missing');
 const db=await database();t.after(()=>db.close());const directory=await mkdtemp(join(tmpdir(),'cloud-test-remote-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 await bootstrapTestCloud(directory);const config=await loadRuntime(directory),plans=new OrganisationPlanStore(db.pool),store=new RemoteAccessStore(db.pool,'test-free-paid');
 const options={pool:db.pool,directory,mode:'test-free-paid'},runtime=await api.openTestRemoteRuntime(options);
 assert.equal(runtime.cellId,config.gateway.cellId);
 const venues=[];
 for(let n=0;n<2;n++){
  const organisationId=randomUUID(),business=randomUUID(),venueId=randomUUID(),installationId=randomUUID(),peer=generateKeyPairSync('x25519');
  await db.pool.query('INSERT INTO organisations(id) VALUES($1)',[organisationId]);await db.pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[business,organisationId]);await db.pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,environment) VALUES($1,$2,$3,'test')",[venueId,organisationId,business]);await db.pool.query('INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,$3)',[installationId,venueId,generateKeyPairSync('ed25519').publicKey.export({format:'der',type:'spki'}).toString('base64url')]);await db.pool.query("INSERT INTO installation_services(installation_id,service) VALUES($1,'remote_access')",[installationId]);
  await assert.rejects(store.provision(installationId,runtime.cellId,peer.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64')),/permission_denied/);
  await plans.set(organisationId,'paid');const placement=await store.provision(installationId,runtime.cellId,peer.publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64'));
  const keyFile=join(directory,`client-${n}.key`),csrFile=join(directory,`client-${n}.csr`),hostname=placement.staffHostname;
  execFileSync('openssl',['req','-new','-newkey','rsa:2048','-nodes','-keyout',keyFile,'-out',csrFile,'-subj','/CN='+hostname,'-addext','subjectAltName=DNS:'+hostname],{stdio:'ignore'});
  const csr=await readFile(csrFile,'utf8'),revision=Number((await db.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[installationId])).rows[0].configuration_revision);
  await db.pool.query('INSERT INTO staff_certificate_exchange(installation_id,request_id,request_digest,revision,hostname,csr) VALUES($1,$2,$3,$4,$5,$6)',[installationId,randomUUID(),createHash('sha256').update(csr).digest('hex'),revision,hostname,csr]);
  venues.push({organisationId,installationId,placement,keyFile,csr});
 }
 async function drain(worker){await worker.schedule();for(let n=0;n<12&&await worker.runOnce();n++);}
 await drain(runtime.worker);
 assert.deepEqual((await db.pool.query("SELECT applied_digest=desired_digest AS applied,failures::text FROM remote_configuration_jobs WHERE kind='name' AND target_id=ANY($1::uuid[]) ORDER BY target_id",[venues.map(v=>v.installationId)])).rows,[{applied:true,failures:'0'},{applied:true,failures:'0'}]);
 const ca=new X509Certificate(await readFile(join(directory,'lan/ca.pem'))),trust=createPublicKey(await readFile(join(directory,'gateway-issuer.pem')));
 const manifest=()=>readFile(join(directory,'gateway-manifest.json'),'utf8').then(text=>verifyManifest(JSON.parse(text),trust,runtime.cellId));
 const initial=await manifest();assert.equal(initial.routes.length,2);assert.ok(initial.sequence>1,'bootstrap sequence must not supersede the real routes');
 const publicBytes=[];
 for(const v of venues){
  const row=(await db.pool.query('SELECT * FROM staff_certificate_exchange WHERE installation_id=$1',[v.installationId])).rows[0];assert.equal(row.certificate_request_id,row.request_id);
  const cert=new X509Certificate(row.certificate);assert.equal(cert.checkHost(v.placement.staffHostname),v.placement.staffHostname);assert.ok(cert.verify(ca.publicKey));
  const publicFile=join(directory,'public-certs',v.placement.venueId+'.pem'),bytes=await readFile(publicFile,'utf8');publicBytes.push(bytes);
  const leaf=new X509Certificate(bytes);assert.equal(leaf.checkHost(v.placement.publicHostname),v.placement.publicHostname);assert.ok(leaf.verify(ca.publicKey));assert.ok(bytes.includes('PRIVATE KEY'),'gateway material must contain its private key');assert.equal((await stat(publicFile)).mode&0o777,0o600);
 }
 assert.ok(publicBytes[0]!==publicBytes[1],'venues must have distinct private certificate material');
 await plans.set(venues[0].organisationId,'free');const restarted=await api.openTestRemoteRuntime(options);await drain(restarted.worker);
 const after=await manifest();assert.ok(after.sequence>initial.sequence);assert.deepEqual(after.routes.map(r=>r.installationId),[venues[1].installationId]);
 assert.ok(await readFile(join(directory,'public-certs',venues[1].placement.venueId+'.pem'),'utf8')===publicBytes[1],'the paid neighbour must retain its certificate and key');
 await plans.set(venues[0].organisationId,'paid');await drain(restarted.worker);assert.equal((await manifest()).routes.length,1,'upgrade alone must not restore setup');
 await store.provision(venues[0].installationId,runtime.cellId,venues[0].placement.peerPublicKey);await drain(restarted.worker);assert.equal((await manifest()).routes.length,2);
 await assert.rejects(api.openTestRemoteRuntime({...options,mode:'invalid'}),/test_cloud.plan_mode/);
 // Durable state is authoritative; a mismatched cell must not be silently overwritten.
 await db.pool.query("UPDATE remote_cells SET endpoint='elsewhere.example.test:51820' WHERE id=$1",[runtime.cellId]);
 await assert.rejects(api.openTestRemoteRuntime(options),/test_cloud.remote_cell_conflict/);
});

// Startup must reject a substituted authority rather than signing a new trusted route set.
test('remote startup rejects private-key mismatch, bad permissions, corrupt signatures and invalid mode', {timeout:30000},async t=>{
 const {openTestRemoteRuntime}=await import('./remote-runtime.mjs'),db=await database();t.after(()=>db.close());
 const directory=await mkdtemp(join(tmpdir(),'cloud-remote-authority-'));t.after(()=>rm(directory,{recursive:true,force:true}));await bootstrapTestCloud(directory);
 const options={pool:db.pool,directory,mode:'test-free-paid'},keyFile=join(directory,'gateway-signing-key.pem'),key=await readFile(keyFile);
 await writeFile(keyFile,generateKeyPairSync('ed25519').privateKey.export({format:'pem',type:'pkcs8'}));await assert.rejects(openTestRemoteRuntime(options),/test_cloud.remote_state_invalid/);await writeFile(keyFile,key);
 await chmod(keyFile,0o644);await assert.rejects(openTestRemoteRuntime(options),/test_cloud.remote_state_invalid/);await chmod(keyFile,0o600);
 const manifestFile=join(directory,'gateway-manifest.json'),bytes=await readFile(manifestFile),envelope=JSON.parse(bytes);envelope.signature='A'.repeat(86);
 await writeFile(manifestFile,JSON.stringify(envelope));await assert.rejects(openTestRemoteRuntime(options),/invalid_manifest/);await writeFile(manifestFile,bytes);
 const wireguardFile=join(directory,'gateway-wireguard.key'),wg=await readFile(wireguardFile);await writeFile(wireguardFile,'short');await assert.rejects(openTestRemoteRuntime(options),/test_cloud.remote_state_invalid/);await writeFile(wireguardFile,wg);
 await assert.rejects(openTestRemoteRuntime({...options,mode:'invalid',directory:'/not-read'}),/test_cloud.plan_mode/);
 assert.equal((await openTestRemoteRuntime(options)).cellId,(await loadRuntime(directory)).gateway.cellId);
});

// A running process has not necessarily committed the cell that paid provisioning needs.
test('manifest readiness waits for its cell transaction before allowing paid placement',{timeout:30000},async t=>{
 const db=await database(),directory=await mkdtemp(join(tmpdir(),'cloud-remote-ready-'));let held,child,closed,transactionOpen=false;
 t.after(async()=>{if(held){if(transactionOpen)await held.query('ROLLBACK');held.release();}if(child?.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await closed;await db.close();await rm(directory,{recursive:true,force:true});});
 await bootstrapTestCloud(directory);const config=await loadRuntime(directory);
 const organisationId=randomUUID(),business=randomUUID(),venueId=randomUUID(),installationId=randomUUID();
 await db.pool.query('INSERT INTO organisations(id) VALUES($1)',[organisationId]);
 await db.pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[business,organisationId]);
 await db.pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,environment) VALUES($1,$2,$3,'test')",[venueId,organisationId,business]);
 await db.pool.query('INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,$3)',[installationId,venueId,generateKeyPairSync('ed25519').publicKey.export({format:'der',type:'spki'}).toString('base64url')]);
 await db.pool.query("INSERT INTO installation_services(installation_id,service) VALUES($1,'remote_access')",[installationId]);
 await new OrganisationPlanStore(db.pool).set(organisationId,'paid');
 const store=new RemoteAccessStore(db.pool,'test-free-paid'),peer=generateKeyPairSync('x25519').publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64');
 await assert.rejects(store.provision(installationId,config.gateway.cellId,peer),/cell_unavailable/);
 held=await db.pool.connect();await held.query('BEGIN');transactionOpen=true;
 await held.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext('test_cloud_remote_cell'))");
 const url=new URL(process.env.TEST_DATABASE_URL);url.searchParams.set('options','-c search_path='+db.schema);
 const application='remote-ready-'+randomUUID();url.searchParams.set('application_name',application);
 const env={...process.env,DATABASE_URL:url.href,LOCAL_STACK_CONFIG_DIR:directory,CLOUD_TEST_SERVICE_PLANS:'1',TMPDIR:directory};delete env.NODE_TEST_CONTEXT;
 child=spawn(process.execPath,['deploy/test-cloud/remote-worker.mjs'],{env,stdio:['ignore','ignore','pipe']});let stderr='';child.stderr.on('data',part=>{stderr+=part;});
 closed=new Promise(resolve=>child.once('close',resolve));
 const wait=async check=>{for(let n=0;n<400;n++){if(await check())return;await new Promise(resolve=>setTimeout(resolve,25));}assert.fail('remote startup did not reach its expected state: '+stderr);};
 await wait(async()=>Boolean((await db.pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event='advisory'",[application])).rowCount));
 const manifest=JSON.parse(await readFile(new URL('../kubernetes/local-checks.yaml',import.meta.url),'utf8'));
 const container=manifest.items.find(item=>item.metadata.name==='manifest').spec.template.spec.containers[0];
 // Without a readiness probe Kubernetes accepts the running container immediately.
 const probe=()=>container.readinessProbe?spawnSync(container.readinessProbe.exec.command[0],container.readinessProbe.exec.command.slice(1),{env}).status:0;
 assert.equal(probe(),1,'a running manifest process must not be ready before its cell exists');
 await held.query('COMMIT');transactionOpen=false;
 await wait(()=>probe()===0);
 assert.equal((await store.provision(installationId,config.gateway.cellId,peer)).cellId,config.gateway.cellId);
 child.kill('SIGTERM');assert.equal(await closed,0,stderr);
 assert.equal(probe(),1,'a stopped worker must not retain readiness');
});

test('public remote startup changes only an empty test cell and retains identity before refusing occupied changes',async t=>{
 const {openTestRemoteRuntime}=await import('./remote-runtime.mjs'),db=await database();t.after(()=>db.close());
 const directory=await mkdtemp(join(tmpdir(),'cloud-public-remote-'));t.after(()=>rm(directory,{recursive:true,force:true}));await bootstrapTestCloud(directory);
 const options={pool:db.pool,directory,mode:'test-free-paid'},local=await openTestRemoteRuntime(options);
 const identity=await Promise.all(['runtime.json','gateway-signing-key.pem','gateway-wireguard.key','gateway-issuer.pem'].map(file=>readFile(join(directory,file))));
 const previous=(await db.pool.query('SELECT public_key,sequence FROM remote_cells WHERE id=$1',[local.cellId])).rows[0],zone='test-cloud.example.test';
 const publicRemote={zone,endpoint:zone+':51820',directoryUrl:'https://ca.example.test/dir',accountKey:generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({format:'pem',type:'pkcs8'})};
 const current=await openTestRemoteRuntime({...options,publicRemote});assert.equal(current.cellId,local.cellId);
 const row=(await db.pool.query('SELECT suffix,endpoint,public_key,sequence FROM remote_cells WHERE id=$1',[local.cellId])).rows[0];
 assert.deepEqual(row,{suffix:zone,endpoint:zone+':51820',...previous});assert.equal((await db.pool.query("SELECT suffix FROM remote_country_zones WHERE country='ES' AND environment='test'")).rows[0].suffix,zone);
 assert.deepEqual(await Promise.all(['runtime.json','gateway-signing-key.pem','gateway-wireguard.key','gateway-issuer.pem'].map(file=>readFile(join(directory,file)))),identity);
 const organisation=randomUUID(),business=randomUUID(),venue=randomUUID(),installation=randomUUID();
 await db.pool.query('INSERT INTO organisations(id) VALUES($1)',[organisation]);await db.pool.query('INSERT INTO legal_businesses(id,organisation_id) VALUES($1,$2)',[business,organisation]);await db.pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,environment) VALUES($1,$2,$3,'test')",[venue,organisation,business]);await db.pool.query('INSERT INTO installations(id,venue_id,public_key) VALUES($1,$2,$3)',[installation,venue,generateKeyPairSync('ed25519').publicKey.export({format:'der',type:'spki'}).toString('base64url')]);await db.pool.query("INSERT INTO installation_services(installation_id,service) VALUES($1,'remote_access')",[installation]);await new OrganisationPlanStore(db.pool).set(organisation,'paid');
 const placement=await new RemoteAccessStore(db.pool,'test-free-paid').provision(installation,local.cellId,generateKeyPairSync('x25519').publicKey.export({format:'der',type:'spki'}).subarray(-32).toString('base64'));
 assert.equal(placement.publicHostname,'v-'+venue+'.'+zone);assert.equal(placement.staffHostname,'staff-v-'+venue+'.'+zone);
 await openTestRemoteRuntime({...options,publicRemote});
 await assert.rejects(openTestRemoteRuntime({...options,publicRemote:{...publicRemote,zone:'other.example.test',endpoint:'other.example.test:51820'}}),/test_cloud.remote_cell_conflict/);
 assert.deepEqual((await db.pool.query('SELECT suffix,endpoint,public_key,sequence FROM remote_cells WHERE id=$1',[local.cellId])).rows[0],row);
});

test('public HTTP issuance and renewal use the independent listener and remove every challenge',{timeout:120000},async t=>{
 const {startAcme,docker,waitFor}=await import('../../scripts/remote-fixtures.mjs'),{readdir,mkdir}=await import('node:fs/promises');
 const directory=await mkdtemp(join(tmpdir(),'cloud-public-acme-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const challenges=join(directory,'challenges'),accountWebroot=join(directory,'account'),zone='test-cloud.example.test';await mkdir(challenges);await mkdir(accountWebroot);
 const acme=await startAcme({http:{zone,accountWebroot,challengeDirectory:challenges}});t.after(()=>acme.close());assert.equal(acme.httpReady,true,'real independent HTTP fixture missing');
 const keyFile=join(directory,'account-key.pem');await writeFile(keyFile,generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600});
 const {crypto}=await import('../../packages/remote-access/node_modules/acme-client/src/index.js');
 const hostname='staff-v-11111111-1111-4111-8111-111111111111.'+zone,[key,csr]=await crypto.createCsr({commonName:hostname,altNames:[hostname]});
 const csrFile=join(directory,'request.pem'),output=join(directory,'certificate.pem');await writeFile(csrFile,csr,{mode:0o600});
 const options={hostname,csrFile,accountKeyFile:keyFile,output,http:{zone,challengeDirectory:challenges}};
 const first=new X509Certificate(await acme.issue(options)),renewed=new X509Certificate(await acme.issue(options));
 assert.equal(first.checkHost(hostname),hostname);assert.notEqual(first.serialNumber,renewed.serialNumber);assert.ok(first.publicKey.equals(createPublicKey(key)));
 assert.deepEqual(await readdir(join(challenges,hostname)),[]);assert.deepEqual(JSON.parse(await readFile(output+'.account.json','utf8')).contact??[],[]);
 await assert.rejects(acme.issue({...options,http:{zone:'foreign.example.test',challengeDirectory:challenges}}),/certificate_issuance_failed/);assert.deepEqual(await readdir(join(challenges,hostname)),[]);
 const previous=await readFile(output,'utf8');
 docker('stop','--time','1',acme.name+'-http');await assert.rejects(acme.issue(options),/certificate_issuance_failed/);
 assert.deepEqual(await readdir(join(challenges,hostname)),[]);assert.equal(await readFile(output,'utf8'),previous);
 const beforePort=new URL(acme.httpUrl).port;docker('start',acme.name+'-http');
 const restartedHttp='http://127.0.0.1:'+docker('port',acme.name+'-http','80/tcp').split(':').at(-1);t.diagnostic(JSON.stringify({beforePort,afterPort:new URL(restartedHttp).port}));
 await waitFor(async()=> (await fetch(restartedHttp+'/.well-known/acme-challenge/readiness',{signal:AbortSignal.timeout(1000)})).status===404,5000);
 const abortAccount=join(directory,'abort-account.pem');await writeFile(abortAccount,generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({format:'pem',type:'pkcs8'}),{mode:0o600});
 await assert.rejects(acme.issue({...options,accountKeyFile:abortAccount,http:{...options.http,abortOnChallenge:true}}),/"aborted":true/);
 assert.deepEqual(await readdir(join(challenges,hostname)),[]);assert.equal(await readFile(output,'utf8'),previous);
 assert.equal(new X509Certificate(await acme.issue(options)).checkHost(hostname),hostname);
});
