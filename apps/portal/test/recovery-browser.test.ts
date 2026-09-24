import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID,sign} from 'node:crypto';
import {test} from 'node:test';
import axe from 'axe-core';
import {RegistrationStore,SignupStore} from '@waitron-cloud/registration';
import {BackupKeyVault} from '../../../packages/backups/src/keys.ts';
import {BackupCatalogue} from '../../../packages/backups/src/catalogue.ts';
import {RecoveryRequests,requestPayload} from '../../../packages/backups/src/recovery-request.ts';
import {receipt} from '../../../packages/backups/src/storage.ts';
import {startPortalFixture} from './fixtures.ts';
import {translations} from '../src/locale.ts';
for(const locale of ['en','es'] as const)test(`${locale} owner approves a verified snapshot from replacement link and closes access after a lost reply`,async()=>{
 const vault=new BackupKeyVault(randomBytes(32)),data=new Map<string,Buffer>(),objects=()=>({async read(k:string){return data.get(k)!;},async put(k:string,b:Uint8Array){data.set(k,Buffer.from(b));return receipt(b);},async remove(k:string){data.delete(k);}});
 const f=await startPortalFixture({vault,objects,async grant(){throw Error('browser must never request storage authority');}});try{
  const email='restore@example.test',password='A long enough owner password',signup=new SignupStore(f.db.pool,f.db.outbox);await signup.request(email);const mail=f.db.outbox.open((await f.db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert('token' in mail);
  const owner=await signup.complete(mail.token,{password,organisationName:'Café Sol',legalBusinessName:'Sol SL',countryCode:'ES'}),r=new RegistrationStore(f.db.pool),b={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};await r.start(b);await r.approveCloud(b,owner.accountId);await r.approveLocal(b,randomUUID());const venue=await r.complete(b);
  const catalogue=new BackupCatalogue(f.db.pool,vault,objects);await catalogue.provision(venue.installationId,{endpoint:'https://storage.test',region:'local',bucket:'recovery-'+randomUUID()});const capture=await catalogue.reserveCapture(venue.installationId,randomUUID()),bytes=Buffer.from('encrypted snapshot');data.set(capture.incomingKey,bytes);const point=await catalogue.publish(venue.installationId,capture.id,{...receipt(bytes),capturedAt:new Date().toISOString(),retention:'daily',sourceNodeId:randomUUID(),modules:{core:1}});await catalogue.verify(point.id,'test',async()=>{});
  const id=randomUUID(),key=generateKeyPairSync('ed25519'),code='12345678',payload=requestPayload(f.origin,id,'start',key.publicKey.export({type:'spki',format:'der'}).toString('base64url'),code,Date.now());await new RecoveryRequests(f.db.pool,vault,f.origin).machine('start',{payload:payload.toString('base64url'),signature:sign(null,payload,key.privateKey).toString('base64url')});
  const context=await f.browser.newContext({locale,viewport:{width:375,height:812},colorScheme:locale==='en'?'light':'dark'}),page=await context.newPage();page.setDefaultTimeout(4000);const c=translations[locale];
  assert.equal((await page.goto(f.origin+'/recover#request='+id))?.status(),200);await page.getByLabel(c.email).fill(email);assert(!page.url().includes(id));await page.locator('input[name=password]').fill(password);await page.getByRole('button',{name:c.login,exact:true}).click();await page.getByRole('heading',{name:c.recoveryTitle}).waitFor();
  await page.getByLabel(c.pairCode).fill(code);await page.getByRole('button',{name:c.pairInspect,exact:true}).click();await page.getByLabel(c.recoveryVenue,{exact:true}).selectOption(venue.venueId);await page.getByRole('checkbox',{name:c.recoveryStopped,exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:c.recoveryApprove,exact:true}).isEnabled(),false);
  await page.evaluate(axe.source);assert.deepEqual(await page.evaluate(async()=>(await window.axe.run(document)).violations),[]);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:new URL(`../dist/recovery-${locale}.png`,import.meta.url).pathname,fullPage:true});
  await page.getByRole('checkbox',{name:c.recoveryStopped,exact:true}).check();await page.getByRole('checkbox',{name:c.recoveryAcceptLoss,exact:true}).check();
  await page.route('**/api/account/recovery/approve',async route=>{const reply=await route.fetch();assert.equal(reply.status(),200);assert(!JSON.stringify(await reply.json()).includes(capture.keys.recoveryKey));await route.abort('failed');},{times:1});
  await page.getByRole('button',{name:c.recoveryApprove,exact:true}).click();await page.getByText(c.recoveryApproved,{exact:true}).waitFor();assert.equal((await f.db.pool.query('SELECT count(*) FROM backup_recoveries')).rows[0].count,'1');
  await page.getByRole('button',{name:c.recoveryCancel,exact:true}).click();await page.getByText(c.recoveryClosed,{exact:true}).waitFor();assert.equal((await f.db.pool.query('SELECT status FROM backup_recoveries')).rows[0].status,'closed');
  assert(!await page.locator('body').innerText().then(t=>t.includes(capture.keys.recoveryKey)||t.includes(capture.keys.streamKey)));
 }finally{await f.close();}
});
