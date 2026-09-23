import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import axe from 'axe-core';
import {RegistrationStore,SignupStore} from '@waitron-cloud/registration';
import {startPortalFixture} from './fixtures.ts';
import {translations} from '../src/locale.ts';
for(const locale of ['en','es'] as const)test(`${locale} installation status and deliberate stop access work at phone width`,async()=>{
 const f=await startPortalFixture();try{
  const email='owner@example.test',password='A long enough venue owner password',signup=new SignupStore(f.db.pool,f.db.outbox);await signup.request(email);const mail=f.db.outbox.open((await f.db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert.ok('token' in mail);
  const owner=await signup.complete(mail.token,{password,organisationName:'Café Sol',legalBusinessName:'Sol SL',countryCode:'ES'});
  const r=new RegistrationStore(f.db.pool),b={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};await r.start(b);await r.approveCloud(b,owner.accountId);await r.approveLocal(b,randomUUID());const installed=await r.complete(b);
  const context=await f.browser.newContext({locale,viewport:{width:375,height:812}}),page=await context.newPage();page.setDefaultTimeout(5000);const c=translations[locale];
  await page.goto(f.origin+'/login');await page.getByLabel(c.email).fill(email);await page.locator('input[name=password]').fill(password);await page.getByRole('button',{name:c.login,exact:true}).click();
  const stop=locale==='en'?'Stop Cloud access':'Detener el acceso a Cloud',confirm=locale==='en'?'Confirm stop':'Confirmar detención',cancel=locale==='en'?'Keep Cloud access':'Mantener el acceso a Cloud',stopped=locale==='en'?'Cloud access stopped':'Acceso a Cloud detenido';
  await page.getByRole('button',{name:stop,exact:true}).waitFor();
  await f.db.pool.query("UPDATE installation_services SET state='ready' WHERE installation_id=$1 AND service='remote_access'",[installed.installationId]);
  await f.db.pool.query("INSERT INTO installation_observations(installation_id,service,revision,health,observed_at) VALUES($1,'remote_access',0,'healthy',clock_timestamp()-interval '299 seconds')",[installed.installationId]);
  await page.getByRole('button',{name:locale==='en'?'Refresh status':'Actualizar estado',exact:true}).click();
  await page.getByText(locale==='en'?'Configured · Working':'Configurado · Funcionando',{exact:true}).waitFor();
  await page.getByText(locale==='en'?'Configured · Health unknown':'Configurado · Estado desconocido',{exact:true}).waitFor({timeout:3000});
  await page.getByRole('button',{name:stop,exact:true}).click();await page.getByRole('button',{name:cancel,exact:true}).click();assert.equal((await f.db.pool.query('SELECT revoked_at FROM installations WHERE id=$1',[installed.installationId])).rows[0].revoked_at,null);
  await page.getByRole('button',{name:stop,exact:true}).click();await page.evaluate(axe.source);assert.deepEqual(await page.evaluate(async()=> (await window.axe.run(document)).violations),[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:new URL(`../dist/installations-${locale}.png`,import.meta.url).pathname,fullPage:true});
  let revokes=0;await page.route('**/installations/revoke',async route=>{revokes++;const response=await route.fetch();if(revokes===1)await route.abort('failed');else await route.fulfill({response});});
  await page.getByRole('button',{name:confirm,exact:true}).click();await page.getByText(locale==='en'?'We could not confirm whether access stopped. Retry or refresh the status.':'No hemos podido confirmar si se detuvo el acceso. Reinténtalo o actualiza el estado.').waitFor();
  await page.getByRole('button',{name:confirm,exact:true}).click();await page.getByText(stopped,{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:stop,exact:true}).count(),0);
  await page.reload();await page.getByText(stopped,{exact:true}).waitFor();assert.equal((await f.db.pool.query('SELECT count(*) FROM venues')).rows[0].count,'1');
 }finally{await f.close();}
});
