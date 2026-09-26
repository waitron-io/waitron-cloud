import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import axe from 'axe-core';
import {RegistrationStore,SignupStore} from '@waitron-cloud/registration';
import {startPortalFixture} from './fixtures.ts';
import {translations} from '../src/locale.ts';

for(const locale of ['en','es'] as const)test(`${locale} owner sees isolated measured usage and honest freshness`,async()=>{
 const f=await startPortalFixture();
 try{
  const email=`usage-${locale}@example.test`,password='A long enough owner password',signup=new SignupStore(f.db.pool,f.db.outbox);
  await signup.request(email);const mail=f.db.outbox.open((await f.db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert('token' in mail);
  const owner=await signup.complete(mail.token,{password,organisationName:'Café Sol',legalBusinessName:'Sol SL',countryCode:'ES'});
  const registrations=new RegistrationStore(f.db.pool);
  const install=async(organisationId:string,legalBusinessId:string)=>{
   const binding={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId,legalBusinessId};
   await registrations.start(binding);await registrations.approveCloud(binding,owner.accountId);await registrations.approveLocal(binding,randomUUID());return registrations.complete(binding);
  };
  const sol=await install(owner.organisationId,owner.legalBusinessId),otherOrganisation=randomUUID(),otherBusiness=randomUUID();
  await f.db.pool.query('INSERT INTO organisations(id,name) VALUES($1,$2)',[otherOrganisation,'Zaragoza']);
  await f.db.pool.query("INSERT INTO legal_businesses(id,organisation_id,name,country_code) VALUES($1,$2,'Luna SL','ES')",[otherBusiness,otherOrganisation]);
  await f.db.pool.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner,can_register_venues) VALUES($1,$2,true,true)',[owner.accountId,otherOrganisation]);
  const luna=await install(otherOrganisation,otherBusiness),occurred='2026-09-26T12:00:00.000Z';
  const seed=async(organisationId:string,venueId:string,values:string[])=>{
   const types=['backup.storage_added_bytes','backup.storage_removed_bytes','backup.upload_bytes','backup.restore_bytes','operation.installation_completed','operation.monitoring_probe','message.service_alert_sent','message.service_alert_failed','message.service_alert_expired','message.service_alert_cancelled'];
   const kinds=['backup_point','backup_point','backup_point','backup_recovery','installation_operation','monitoring_probe','service_alert','service_alert','service_alert','service_alert'];
   for(let index=0;index<types.length;index++){
    const count=types[index]!.startsWith('backup.')?1:Number(values[index]);
    for(let item=0;item<count;item++)await f.db.pool.query('INSERT INTO usage_events(organisation_id,venue_id,event_type,quantity,source_kind,source_reference,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[organisationId,venueId,types[index],types[index]!.startsWith('backup.')?values[index]:'1',kinds[index],`${organisationId}:${index}:${item}`,occurred]);
   }
  };
  await seed(owner.organisationId,sol.venueId,['9007199254740994','1','1536','2048','3','4','5','6','7','8']);
  await seed(otherOrganisation,luna.venueId,['1024','1','1024','1024','1','2','3','4','5','6']);
  const context=await f.browser.newContext({locale,colorScheme:locale==='en'?'light':'dark',viewport:{width:390,height:844}}),page=await context.newPage();page.setDefaultTimeout(5000);const c=translations[locale];
  await page.goto(f.origin+'/login');await page.getByLabel(c.email).fill(email);await page.locator('input[name=password]').fill(password);await page.getByRole('button',{name:c.login,exact:true}).click();
  const usage=locale==='en'?'Measured Cloud usage':'Uso medido de Cloud',pending=locale==='en'?'Measurement is not complete yet. Totals can increase after reconciliation runs.':'La medición aún no está completa. Los totales pueden aumentar cuando se ejecute la conciliación.';
  await page.getByRole('heading',{name:usage,exact:true}).waitFor();await page.getByText(pending,{exact:true}).waitFor();
  await page.getByText(locale==='en'?'9,007,199,254,740,993 bytes':'9.007.199.254.740.993 bytes',{exact:true}).waitFor();
  await page.getByText(locale==='en'?'1.5 KiB':'1,5 KiB',{exact:true}).waitFor();
  for(const value of ['5','6','7','8'])assert.equal(await page.getByText(value,{exact:true}).count(),1);
  await page.getByText(locale==='en'?'Continuous backup stream bytes and account email are not included.':'No se incluyen los bytes del flujo de copia continua ni el correo de la cuenta.',{exact:true}).waitFor();
  const organisation=page.getByLabel(c.chooseOrganisation,{exact:true});await organisation.selectOption(otherOrganisation);
  await page.getByText(locale==='en'?'1,023 bytes':'1023 bytes',{exact:true}).waitFor();assert.equal(await page.getByText(locale==='en'?'9,007,199,254,740,993 bytes':'9.007.199.254.740.993 bytes',{exact:true}).count(),0);
  const usageText=await page.locator('section.usage').innerText();for(const hidden of [owner.organisationId,otherOrganisation,'backup_point','service_alert'])assert(!usageText.includes(hidden));
  await f.db.pool.query("UPDATE usage_reconciliation_sources SET caught_up_at='2026-09-26T12:05:00.000Z'");
  const refresh=page.getByRole('button',{name:locale==='en'?'Refresh measured usage':'Actualizar uso medido',exact:true});await refresh.press('Enter');
  await page.locator('time[datetime="2026-09-26T12:05:00.000Z"]').waitFor();
  await page.evaluate(axe.source);assert.deepEqual(await page.evaluate(async()=>(await window.axe.run(document)).violations),[]);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:new URL(`../dist/usage-${locale}-phone.png`,import.meta.url).pathname,fullPage:true});
  await page.setViewportSize({width:1280,height:900});await page.evaluate(axe.source);assert.deepEqual(await page.evaluate(async()=>(await window.axe.run(document)).violations),[]);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:new URL(`../dist/usage-${locale}-desktop.png`,import.meta.url).pathname,fullPage:true});
 }finally{await f.close();}
});
