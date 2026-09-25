import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {test} from 'node:test';
import axe from 'axe-core';
import {RegistrationStore,SignupStore} from '@waitron-cloud/registration';
import {BackupKeyVault} from '../../../packages/backups/src/keys.ts';
import {BackupCatalogue} from '../../../packages/backups/src/catalogue.ts';
import {RecoveryRequests,requestPayload} from '../../../packages/backups/src/recovery-request.ts';
import {BackupRecovery,recoveryPayload,streamRecoveryDigest} from '../../../packages/backups/src/recovery.ts';
import {ManagedStreams} from '../../../packages/backups/src/managed-streams.ts';
import {ReplacementStore,replacementPayload} from '../../../packages/backups/src/replacement.ts';
import {receipt} from '../../../packages/backups/src/storage.ts';
import {startPortalFixture} from './fixtures.ts';
import {translations} from '../src/locale.ts';
for(const locale of ['en','es'] as const)test(`${locale} owner confirms a restored server replacement and reconciles lost replies`,async()=>{
 const vault=new BackupKeyVault(randomBytes(32)),data=new Map<string,Buffer>(),objects=()=>({async read(k:string){return data.get(k)!;},async put(k:string,b:Uint8Array){data.set(k,Buffer.from(b));return receipt(b);},async remove(k:string){data.delete(k);}}),streamObjects=new Map<string,Buffer>();
 const managedStreams={
  async provision(input:{venueId:string}){return {writerReference:`writer:${input.venueId}`,readerReference:`reader:${input.venueId}`,writerCredentials:{accessKeyId:'writer-browser',secretAccessKey:'writer-secret-browser'}};},
  async read(reference:string,location:{bucket:string},key:string){return streamObjects.get(`${reference}:${location.bucket}:${key}`)!;},
  async reader(){return {accessKeyId:'reader-browser',secretAccessKey:'reader-secret-browser'};},
 };
 const f=await startPortalFixture({vault,objects,managedStreams,async grant(){throw Error('browser must never request snapshot storage authority');}});try{
  const email='restore@example.test',password='A long enough owner password',signup=new SignupStore(f.db.pool,f.db.outbox);await signup.request(email);const mail=f.db.outbox.open((await f.db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert('token' in mail);
  const owner=await signup.complete(mail.token,{password,organisationName:'Café Sol',legalBusinessName:'Sol SL',countryCode:'ES'}),r=new RegistrationStore(f.db.pool),b={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};await r.start(b);await r.approveCloud(b,owner.accountId);await r.approveLocal(b,randomUUID());const venue=await r.complete(b);
  const catalogue=new BackupCatalogue(f.db.pool,vault,objects);await catalogue.provision(venue.installationId,{endpoint:'https://storage.test',region:'local',bucket:'recovery-'+randomUUID()});const capture=await catalogue.reserveCapture(venue.installationId,randomUUID()),bytes=Buffer.from('encrypted snapshot');data.set(capture.incomingKey,bytes);const sourceNodeId=randomUUID(),point=await catalogue.publish(venue.installationId,capture.id,{...receipt(bytes),capturedAt:new Date().toISOString(),retention:'daily',sourceNodeId,modules:{core:1}});await catalogue.verify(point.id,'test',async()=>{});
  const revision=Number((await f.db.pool.query('SELECT configuration_revision FROM installations WHERE id=$1',[venue.installationId])).rows[0].configuration_revision),pointerKey=generateKeyPairSync('ed25519'),streams=new ManagedStreams(f.db.pool,vault,managedStreams),configured=await streams.configure(venue.installationId,revision,{localVenueId:b.localVenueId,sourceNodeId,pointerSignerPublicKey:pointerKey.publicKey.export({type:'spki',format:'der'}).toString('base64')});
  const recoverableAt=new Date(Date.now()-60000).toISOString(),generation=`gen-2-${sourceNodeId}-20260925T175500Z`,pointer={venueId:b.localVenueId,term:2,nodeId:sourceNodeId,generation,writtenAt:recoverableAt},message=JSON.stringify({pointer:{generation,nodeId:sourceNodeId,term:2,venueId:b.localVenueId,writtenAt:recoverableAt},purpose:'waitron.stream.pointer.v1'}),pointerBytes=Buffer.from(JSON.stringify({body:pointer,signature:sign(null,Buffer.from(message),pointerKey.privateKey).toString('base64')}));
  streamObjects.set(`reader:${venue.venueId}:${configured.bucket.bucket}:${configured.bucket.prefix}venues/${b.localVenueId}/current.json`,pointerBytes);await streams.observe(venue.installationId,configured.configurationRevision);
  const id=randomUUID(),key=generateKeyPairSync('ed25519'),code='12345678',payload=requestPayload(f.origin,id,'start',key.publicKey.export({type:'spki',format:'der'}).toString('base64url'),code,Date.now());await new RecoveryRequests(f.db.pool,vault,f.origin).machine('start',{payload:payload.toString('base64url'),signature:sign(null,payload,key.privateKey).toString('base64url')});
  const context=await f.browser.newContext({locale,viewport:{width:390,height:812},colorScheme:locale==='en'?'light':'dark'}),page=await context.newPage();page.setDefaultTimeout(4000);const c=translations[locale];
  assert.equal((await page.goto(f.origin+'/recover#request='+id))?.status(),200);await page.getByLabel(c.email).fill(email);assert(!page.url().includes(id));await page.locator('input[name=password]').fill(password);await page.getByRole('button',{name:c.login,exact:true}).click();await page.getByRole('heading',{name:c.recoveryTitle}).waitFor();
  await page.getByLabel(c.pairCode).fill(code);await page.getByRole('button',{name:c.pairInspect,exact:true}).click();await page.getByLabel(c.recoveryVenue,{exact:true}).selectOption(venue.venueId);await page.getByRole('radio',{name:c.recoveryContinuous,exact:true}).waitFor();
  assert.equal(await page.getByRole('radio',{name:c.recoveryContinuous,exact:true}).isChecked(),true);await page.getByRole('radio',{name:c.recoverySnapshotFallback,exact:true}).check();assert.equal(await page.getByLabel(c.chooseSnapshot,{exact:true}).inputValue(),point.id);await page.getByRole('radio',{name:c.recoveryContinuous,exact:true}).check();await page.getByRole('checkbox',{name:c.recoveryStopped,exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:c.recoveryApprove,exact:true}).isEnabled(),false);
  await page.evaluate(axe.source);assert.deepEqual(await page.evaluate(async()=>(await window.axe.run(document)).violations),[]);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:new URL(`../dist/recovery-${locale}.png`,import.meta.url).pathname,fullPage:true});
  await page.setViewportSize({width:1280,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:new URL(`../dist/recovery-desktop-${locale}.png`,import.meta.url).pathname,fullPage:true});await page.setViewportSize({width:390,height:812});
  await page.getByRole('checkbox',{name:c.recoveryStopped,exact:true}).check();await page.getByRole('checkbox',{name:c.recoveryAcceptLoss,exact:true}).check();
  const lostApproval=f.loseRecoveryReply('approve');
  await page.getByRole('button',{name:c.recoveryApprove,exact:true}).click();const approvalReply=await lostApproval;assert.equal(approvalReply.status,200);assert(!approvalReply.body.includes(capture.keys.recoveryKey));await page.getByText(c.recoveryApprovedContinuous,{exact:true}).waitFor();const recoveryRow=(await f.db.pool.query('SELECT source_kind,stream_generation FROM backup_recoveries')).rows[0];assert.equal(recoveryRow.source_kind,'continuous');assert.equal(recoveryRow.stream_generation,generation);
  const restored=recoveryPayload(f.origin,id,'restored',streamRecoveryDigest(generation),Date.now());await new BackupRecovery(f.db.pool,vault,f.origin).target(id,'restored',{payload:restored.toString('base64url'),signature:sign(null,restored,key.privateKey).toString('base64url')});
  await page.getByRole('button',{name:c.retry,exact:true}).click();await page.getByText(c.recoveryReplacementWaiting,{exact:true}).waitFor();
  const next=generateKeyPairSync('ed25519'),publicKey=next.publicKey.export({type:'spki',format:'der'}).toString('base64url'),peerPublicKey=randomBytes(32).toString('base64');
  const proposal={id,localVenueId:b.localVenueId,nodeId:sourceNodeId,publicKey,peerPublicKey},signed=replacementPayload(f.origin,'prepare',proposal,Date.now());
  await new ReplacementStore(f.db.pool,vault,f.origin).machine('prepare',{id,payload:signed.toString('base64url'),signature:sign(null,signed,key.privateKey).toString('base64url'),keySignature:sign(null,signed,next.privateKey).toString('base64url')});
  await page.getByRole('button',{name:c.retry,exact:true}).click();await page.getByText(c.recoveryReplacementReady,{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:c.recoveryReplacementApprove,exact:true}).isEnabled(),false);await page.evaluate(axe.source);assert.deepEqual(await page.evaluate(async()=>(await window.axe.run(document)).violations),[]);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:new URL(`../dist/replacement-ready-${locale}.png`,import.meta.url).pathname,fullPage:true});
  await page.getByRole('checkbox',{name:c.recoveryReplacementConfirm,exact:true}).check();
  const lostReplacement=f.loseRecoveryReply('replace');
  await page.getByRole('button',{name:c.recoveryReplacementApprove,exact:true}).click();assert.equal((await lostReplacement).status,200);await page.getByText(c.recoveryReplacementComplete,{exact:true}).first().waitFor();
  assert.equal((await f.db.pool.query('SELECT count(*) FROM installations WHERE venue_id=$1',[venue.venueId])).rows[0].count,'2');await page.screenshot({path:new URL(`../dist/replacement-complete-${locale}.png`,import.meta.url).pathname,fullPage:true});
  const closeReply=page.waitForResponse(response=>response.url().endsWith('/api/account/recovery/close'));await page.getByRole('button',{name:c.recoveryCancel,exact:true}).click();assert.equal((await closeReply).status(),200);assert.equal((await f.db.pool.query('SELECT status FROM backup_recoveries')).rows[0].status,'closed');
  await f.db.pool.query("UPDATE backup_recoveries SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[id]);await page.getByRole('button',{name:c.retry,exact:true}).click();assert.equal(await page.getByText(c.recoveryExpired,{exact:true}).count(),0);
  assert(!await page.locator('body').innerText().then(t=>t.includes(capture.keys.recoveryKey)||t.includes(capture.keys.streamKey)||t.includes('writer-secret-browser')||t.includes('reader-secret-browser')||t.includes(generation)));
 }finally{await f.close();}
});
