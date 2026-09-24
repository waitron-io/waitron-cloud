import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import axe from 'axe-core';
import {RegistrationStore,SignupStore,MonitorWorker} from '@waitron-cloud/registration';
import {startPortalFixture,mailFor} from './fixtures.ts';
import {translations} from '../src/locale.ts';
for(const locale of ['en','es'] as const)test(`${locale} owner manages service alerts and sees current monitoring evidence`,async()=>{
 const f=await startPortalFixture();try{
  const email=`monitor-${randomUUID()}@example.test`,password='A long enough owner password',signup=new SignupStore(f.db.pool,f.db.outbox);await signup.request(email);const mail=f.db.outbox.open((await f.db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert('token' in mail);
  const owner=await signup.complete(mail.token,{password,organisationName:'Café Sol',legalBusinessName:'Sol SL',countryCode:'ES'}),r=new RegistrationStore(f.db.pool),b={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};await r.start(b);await r.approveCloud(b,owner.accountId);await r.approveLocal(b,randomUUID());const v=await r.complete(b);
  await f.db.pool.query("UPDATE installation_services SET state='ready' WHERE service='remote_access'");
  await f.db.pool.query("UPDATE installations SET last_contact_at=clock_timestamp()-interval '16 minutes'");
  const monitor=new MonitorWorker(f.db.pool,f.db.outbox);await monitor.schedule();await monitor.runOnce();
  const context=await f.browser.newContext({locale,viewport:{width:375,height:812}}),page=await context.newPage();page.setDefaultTimeout(5000);const c=translations[locale];
  await page.goto(f.origin+'/login');await page.getByLabel(c.email).fill(email);await page.locator('input[name=password]').fill(password);await page.getByRole('button',{name:c.login,exact:true}).click();
  const receive=locale==='en'?'Receive service alerts by email':'Recibir alertas de servicio por correo',language=locale==='en'?'Email language':'Idioma del correo',save=locale==='en'?'Save alert preferences':'Guardar preferencias de alertas',saved=locale==='en'?'Alert preferences saved.':'Preferencias de alertas guardadas.';
  const checkbox=page.getByRole('checkbox',{name:receive});await checkbox.waitFor();assert.equal(await checkbox.isChecked(),false);
  await checkbox.check();await page.getByLabel(language,{exact:true}).selectOption(locale);await page.getByRole('button',{name:save,exact:true}).click();await page.getByText(saved,{exact:true}).waitFor();
  await page.reload();await checkbox.waitFor();await page.waitForFunction(()=>document.querySelector<HTMLInputElement>('#service-alerts-enabled')?.checked===true);assert.equal(await page.getByLabel(language,{exact:true}).inputValue(),locale);
  const issue=locale==='en'?'Cloud has not heard from this venue for at least 15 minutes. Check its internet connection and Waitron server.':'Cloud no recibe contacto de este local desde hace al menos 15 minutos. Comprueba su conexión a internet y el servidor Waitron.';
  await page.getByText(issue,{exact:true}).waitFor();
  await f.db.pool.query("UPDATE venue_monitors SET checked_at=clock_timestamp()-interval '6 minutes'");await page.getByRole('button',{name:c.refreshStatus,exact:true}).click();await page.getByText(locale==='en'?'Monitoring status is unknown. Refresh later to check for new observations.':'El estado de la supervisión es desconocido. Actualiza más tarde para ver nuevas comprobaciones.',{exact:true}).waitFor();
  assert(await page.getByText(issue,{exact:true}).isVisible());
  const observe=async(seconds:number)=>{await f.db.pool.query("UPDATE installations SET last_contact_at=clock_timestamp()-$1*interval '1 second'",[seconds]);await f.db.pool.query('UPDATE venue_monitors SET next_check_at=clock_timestamp()');await monitor.runOnce();};
  const emailLanguage=async(value:string)=>{await page.getByLabel(language,{exact:true}).selectOption(value);await page.getByRole('button',{name:save,exact:true}).click();await page.getByText(saved,{exact:true}).waitFor();};
  await observe(0);await emailLanguage(locale==='en'?'es':'en');await observe(901);await emailLanguage(locale);await f.drainMail();
  const opening=await mailFor(email,locale==='en'?'Waitron Cloud: a venue needs attention':'Waitron Cloud: un local necesita atención');assert(opening.includes(v.venueId));assert(opening.includes(f.origin+'/account'));assert(opening.includes(issue));assert(!opening.includes('token='));
  await observe(0);await f.drainMail();const recovery=await mailFor(email,locale==='en'?'Waitron Cloud: venue check recovered':'Waitron Cloud: comprobación recuperada');assert(recovery.includes(v.venueId));
  await page.getByRole('button',{name:c.refreshStatus,exact:true}).click();await page.getByText(locale==='en'?'No current alerts in the latest check.':'No hay alertas en la última comprobación.',{exact:true}).waitFor();assert.equal(await page.getByText(issue,{exact:true}).count(),0);
  await page.evaluate(axe.source);assert.deepEqual(await page.evaluate(async()=>(await window.axe.run(document)).violations),[]);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:new URL(`../dist/monitoring-${locale}.png`,import.meta.url).pathname,fullPage:true});
 }finally{await f.close();}
});
