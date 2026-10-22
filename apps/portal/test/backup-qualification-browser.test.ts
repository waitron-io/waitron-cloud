import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import axe from 'axe-core';
import {RegistrationStore,SignupStore} from '@waitron-cloud/registration';
import {BackupKeyVault} from '../../../packages/backups/src/keys.ts';
import {BackupCatalogue} from '../../../packages/backups/src/catalogue.ts';
import {RecoveryRequests} from '../../../packages/backups/src/recovery-request.ts';
import {receipt} from '../../../packages/backups/src/storage.ts';
import {machineTarget} from '../../../packages/backups/test/fixtures/recovery-v2.ts';
import {admitPointFixture} from '../../../packages/backups/test/fixtures/verification.ts';
import {startPortalFixture} from './fixtures.ts';
import {translations} from '../src/locale.ts';
// A historical success or inconclusive recheck must never expose recovery approval or a current timestamp.
for(const locale of ['en','es'] as const)test(`${locale} current snapshot evidence controls recovery and explains separate activation`,async()=>{
 const vault=new BackupKeyVault(randomBytes(32)),objects=new Map<string,Buffer>(),store={async read(k:string){return objects.get(k)!;},async put(k:string,b:Uint8Array){objects.set(k,Buffer.from(b));return receipt(b);},async remove(k:string){objects.delete(k);}};
 const f=await startPortalFixture({vault,objects:()=>store,async grant(){throw Error('no storage grants in portal');}});
 try{
  const email='qualification@example.test',password='A long enough owner password',signup=new SignupStore(f.db.pool,f.db.outbox);await signup.request(email);
  const mail=f.db.outbox.open((await f.db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert('token' in mail);
  const owner=await signup.complete(mail.token,{password,organisationName:'Café Sol',legalBusinessName:'Sol SL',countryCode:'ES'}),r=new RegistrationStore(f.db.pool),b={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
  await r.start(b);await r.approveCloud(b,owner.accountId);await r.approveLocal(b,randomUUID());const v=await r.complete(b);
  const catalogue=new BackupCatalogue(f.db.pool,vault,()=>store);await catalogue.provision(v.installationId,{endpoint:'https://storage.test',region:'local',bucket:'qualification-'+randomUUID()});
  const capture=await catalogue.reserveCapture(v.installationId,randomUUID()),bytes=Buffer.from('synthetic encrypted archive');objects.set(capture.incomingKey,bytes);
  const point=await catalogue.publish(v.installationId,capture.id,{...receipt(bytes),capturedAt:new Date().toISOString(),retention:'daily',sourceNodeId:randomUUID(),modules:{core:1}});
  await f.db.pool.query("UPDATE backup_points SET verification='verified' WHERE id=$1",[point.id]);
  await f.db.pool.query("INSERT INTO backup_verifications(id,point_id,digest,verifier,outcome) VALUES(gen_random_uuid(),$1,$2,'historical-fixture','verified')",[point.id,point.digest]);
  const t=machineTarget();await new RecoveryRequests(f.db.pool,vault,f.origin).machine('start',t.envelope('start','',Date.now(),f.origin));
  const context=await f.browser.newContext({locale,viewport:{width:390,height:844}}),page=await context.newPage(),c=translations[locale];page.setDefaultTimeout(4000);
  await page.goto(f.origin+'/recover#request='+t.id);await page.getByLabel(c.email).fill(email);await page.locator('input[name=password]').fill(password);await page.getByRole('button',{name:c.login,exact:true}).click();
  await page.getByLabel(c.pairCode).fill(t.code);await page.getByRole('button',{name:c.pairInspect,exact:true}).click();await page.getByLabel(c.recoveryVenue,{exact:true}).selectOption(v.venueId);
  await page.getByText(c.snapshotPending,{exact:true}).waitFor();await page.getByText(c.snapshotFallback,{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:c.recoveryApprove,exact:true}).count(),0);
  const unavailable=locale==='en'?'Check pending or unavailable. This does not mean the copy is corrupt.':'Comprobación pendiente o no disponible. No significa que la copia esté dañada.';
  await page.getByText(unavailable,{exact:true}).waitFor();
  for(const scheme of ['light','dark'] as const)for(const width of [390,1280]){
   await page.emulateMedia({colorScheme:scheme});await page.setViewportSize({width,height:900});await page.evaluate(axe.source);assert.deepEqual(await page.evaluate(async()=>(await window.axe.run(document)).violations),[]);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:new URL(`../dist/qualification-pending-${locale}-${scheme}-${width}.png`,import.meta.url).pathname,fullPage:true});
  }
  await admitPointFixture(f.db.pool,point.id);await page.getByRole('button',{name:c.latestSnapshots,exact:true}).click();await page.getByText(c.snapshotVerified,{exact:true}).waitFor();
  const checked=locale==='en'?'Data restore checked; activation separately authorised.':'Restauración de datos comprobada; la activación se autoriza por separado.';
  await page.getByText(checked,{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:c.recoveryApprove,exact:true}).isEnabled(),false);
  for(const scheme of ['light','dark'] as const)for(const width of [390,1280]){await page.emulateMedia({colorScheme:scheme});await page.setViewportSize({width,height:900});await page.screenshot({path:new URL(`../dist/qualification-verified-${locale}-${scheme}-${width}.png`,import.meta.url).pathname,fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await admitPointFixture(f.db.pool,point.id,'unavailable','runtime_failure');await page.getByRole('button',{name:c.latestSnapshots,exact:true}).click();await page.getByText(unavailable,{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:c.recoveryApprove,exact:true}).count(),0);await page.getByText(c.snapshotFallback,{exact:true}).waitFor();
  await admitPointFixture(f.db.pool,point.id,'invalid','archive_invalid');await page.getByRole('button',{name:c.latestSnapshots,exact:true}).click();await page.getByText(c.snapshotFailed,{exact:true}).waitFor();
  await page.getByText(locale==='en'?'The data integrity check failed. Keep your older copies.':'Ha fallado la comprobación de integridad de los datos. Conserva las copias anteriores.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:c.recoveryApprove,exact:true}).count(),0);
  for(const scheme of ['light','dark'] as const)for(const width of [390,1280]){await page.emulateMedia({colorScheme:scheme});await page.setViewportSize({width,height:900});await page.screenshot({path:new URL(`../dist/qualification-invalid-${locale}-${scheme}-${width}.png`,import.meta.url).pathname,fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await page.goto(f.origin+'/account');await page.getByText(c.noVerifiedSnapshot,{exact:true}).waitFor();
 }finally{await f.close();}
});
