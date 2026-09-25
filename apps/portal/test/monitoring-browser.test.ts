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
  const cell=randomUUID();await f.db.pool.query("INSERT INTO remote_cells(id,country,provider,environment,suffix,subnet,public_key,endpoint) VALUES($1,'ES','aws','test','monitor.example.test',55,'fixture-key','gateway.example.test:51820')",[cell]);
  await f.db.pool.query("INSERT INTO remote_placements(venue_id,installation_id,cell_id,address,peer_public_key,port) VALUES($1,$2,$3,'10.77.55.2','fixture-peer',443)",[v.venueId,v.installationId,cell]);
  await f.db.pool.query("INSERT INTO remote_hostnames(hostname,venue_id,kind) VALUES('public.monitor.example.test',$1,'public'),('staff.monitor.example.test',$1,'staff')",[v.venueId]);
  const observeRemote=async(status:'healthy'|'failed',secondsOld=0)=>{
   await f.db.pool.query(`INSERT INTO remote_probe_observations
    (installation_id,venue_id,service,configuration_revision,hostname,status,checked_at,elapsed_ms,failure,certificate_not_before,certificate_not_after,certificate_fingerprint256,last_success_at,last_failure_at,last_failure)
    VALUES($1,$2,'public',0,'public.monitor.example.test',$3,clock_timestamp()-$4*interval '1 second',12,CASE WHEN $3='failed' THEN 'timeout' END,clock_timestamp()-interval '1 day',clock_timestamp()+interval '5 days','AA:BB',CASE WHEN $3='healthy' THEN clock_timestamp() END,CASE WHEN $3='failed' THEN clock_timestamp() END,CASE WHEN $3='failed' THEN 'timeout' END),
     ($1,$2,'staff',0,'staff.monitor.example.test','healthy',clock_timestamp()-$4*interval '1 second',8,NULL,clock_timestamp()-interval '1 day',clock_timestamp()+interval '60 days','CC:DD',clock_timestamp(),NULL,NULL)
    ON CONFLICT(installation_id,service) DO UPDATE SET status=excluded.status,checked_at=excluded.checked_at,failure=excluded.failure,last_success_at=excluded.last_success_at,last_failure_at=excluded.last_failure_at,last_failure=excluded.last_failure`,[v.installationId,v.venueId,status,secondsOld]);
  };
  await observeRemote('failed');
  await f.db.pool.query("UPDATE installations SET last_contact_at=clock_timestamp()-interval '16 minutes'");
  const monitor=new MonitorWorker(f.db.pool,f.db.outbox);await monitor.schedule();await monitor.runOnce();
  const context=await f.browser.newContext({locale,viewport:{width:375,height:812},colorScheme:locale==='en'?'light':'dark'}),page=await context.newPage();page.setDefaultTimeout(5000);const c=translations[locale];
  await page.goto(f.origin+'/login');await page.getByLabel(c.email).fill(email);await page.locator('input[name=password]').fill(password);await page.getByRole('button',{name:c.login,exact:true}).click();
  const receive=locale==='en'?'Receive service alerts by email':'Recibir alertas de servicio por correo',language=locale==='en'?'Email language':'Idioma del correo',save=locale==='en'?'Save alert preferences':'Guardar preferencias de alertas',saved=locale==='en'?'Alert preferences saved.':'Preferencias de alertas guardadas.';
  const checkbox=page.getByRole('checkbox',{name:receive});await checkbox.waitFor();assert.equal(await checkbox.isChecked(),false);
  await checkbox.check();await page.getByLabel(language,{exact:true}).selectOption(locale);await page.getByRole('button',{name:save,exact:true}).click();await page.getByText(saved,{exact:true}).waitFor();
  await page.reload();await checkbox.waitFor();await page.waitForFunction(()=>document.querySelector<HTMLInputElement>('#service-alerts-enabled')?.checked===true);assert.equal(await page.getByLabel(language,{exact:true}).inputValue(),locale);
  const issue=locale==='en'?'Cloud has not heard from this venue for at least 15 minutes. Check its internet connection and Waitron server.':'Cloud no recibe contacto de este local desde hace al menos 15 minutos. Comprueba su conexión a internet y el servidor Waitron.';
  await page.getByText(issue,{exact:true}).waitFor();
  const publicFailed=locale==='en'?'The public website failed its latest external check. Check the gateway and the venue internet connection.':'El sitio público falló en la última comprobación externa. Comprueba la pasarela y la conexión a internet del local.';
  const staffHealthy=locale==='en'?'Staff access passed its latest external check.':'El acceso del personal superó la última comprobación externa.';
  const certificateWarning=locale==='en'?'The public website certificate expires soon. Check renewal and installation.':'El certificado del sitio público caduca pronto. Comprueba su renovación e instalación.';
  await page.getByText(publicFailed,{exact:true}).waitFor();await page.getByText(staffHealthy,{exact:true}).waitFor();await page.getByText(certificateWarning,{exact:true}).waitFor();
  await observeRemote('failed',301);await f.db.pool.query('UPDATE venue_monitors SET next_check_at=clock_timestamp()');await monitor.runOnce();await page.getByRole('button',{name:c.refreshStatus,exact:true}).click();
  const publicUnknown=locale==='en'?'Public website monitoring is unknown because no recent external check is available.':'La supervisión del sitio público es desconocida porque no hay una comprobación externa reciente.';
  const staffUnknown=locale==='en'?'Staff access monitoring is unknown because no recent external check is available.':'La supervisión del acceso del personal es desconocida porque no hay una comprobación externa reciente.';
  await page.getByText(publicUnknown,{exact:true}).waitFor();await page.getByText(staffUnknown,{exact:true}).waitFor();
  await observeRemote('healthy');await f.db.pool.query('UPDATE venue_monitors SET next_check_at=clock_timestamp()');await monitor.runOnce();await page.getByRole('button',{name:c.refreshStatus,exact:true}).click();
  const publicHealthy=locale==='en'?'The public website passed its latest external check.':'El sitio público superó la última comprobación externa.';
  await page.getByText(publicHealthy,{exact:true}).waitFor();await page.getByText(staffHealthy,{exact:true}).waitFor();
  await f.db.pool.query("UPDATE venue_monitors SET checked_at=clock_timestamp()-interval '6 minutes'");await page.getByRole('button',{name:c.refreshStatus,exact:true}).click();await page.getByText(locale==='en'?'Monitoring status is unknown. Refresh later to check for new observations.':'El estado de la supervisión es desconocido. Actualiza más tarde para ver nuevas comprobaciones.',{exact:true}).waitFor();
  assert(await page.getByText(issue,{exact:true}).isVisible());
  const observe=async(seconds:number)=>{await f.db.pool.query("UPDATE installations SET last_contact_at=clock_timestamp()-$1*interval '1 second'",[seconds]);await f.db.pool.query('UPDATE venue_monitors SET next_check_at=clock_timestamp()');await monitor.runOnce();};
  const emailLanguage=async(value:string)=>{await page.getByLabel(language,{exact:true}).selectOption(value);await page.getByRole('button',{name:save,exact:true}).click();await page.getByText(saved,{exact:true}).waitFor();};
  await observe(0);await emailLanguage(locale==='en'?'es':'en');await observe(901);await emailLanguage(locale);await f.drainMail();
  const opening=await mailFor(email,locale==='en'?'Waitron Cloud: a venue needs attention':'Waitron Cloud: un local necesita atención');assert(opening.includes(v.venueId));assert(opening.includes(f.origin+'/account'));assert(opening.includes(issue));assert(!opening.includes('token='));
  await observe(0);await f.drainMail();const recovery=await mailFor(email,locale==='en'?'Waitron Cloud: venue check recovered':'Waitron Cloud: comprobación recuperada');assert(recovery.includes(v.venueId));
  await page.getByRole('button',{name:c.refreshStatus,exact:true}).click();await page.getByText(issue,{exact:true}).waitFor({state:'detached'});await page.getByText(certificateWarning,{exact:true}).waitFor();
  await page.evaluate(axe.source);assert.deepEqual(await page.evaluate(async()=>(await window.axe.run(document)).violations),[]);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:new URL(`../dist/monitoring-${locale}.png`,import.meta.url).pathname,fullPage:true});
 }finally{await f.close();}
});
