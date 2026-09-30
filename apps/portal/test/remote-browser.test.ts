import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {test} from 'node:test';
import axe from 'axe-core';
import type {Page} from 'playwright';
import {RegistrationStore,SignupStore} from '@waitron-cloud/registration';
import {RemoteAccessStore} from '../../../packages/remote-access/src/placement.ts';
import {startPortalFixture} from './fixtures.ts';
import {translations} from '../src/locale.ts';
for(const locale of ['en','es'] as const)test(`${locale} owner changes remote DNS at phone width and reconciles a lost reply`,async t=>{
 let page:Page|undefined;const started=Date.now();const events:unknown[]=[];
 const record=(event:unknown)=>{if(events.length<60)events.push({afterMs:Date.now()-started,event});};
 let assigned='';const f=await startPortalFixture(undefined,async name=>[name.startsWith('_acme')?'_acme-challenge.'+assigned:assigned]);try{
  const email='remote@example.test',password='A long enough owner password',signup=new SignupStore(f.db.pool,f.db.outbox);await signup.request(email);const mail=f.db.outbox.open((await f.db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert('token' in mail);
  const owner=await signup.complete(mail.token,{password,organisationName:'Café Sol',legalBusinessName:'Sol SL',countryCode:'ES'}),r=new RegistrationStore(f.db.pool),b={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};await r.start(b);await r.approveCloud(b,owner.accountId);await r.approveLocal(b,randomUUID());const v=await r.complete(b);
  const store=new RemoteAccessStore(f.db.pool),cell={id:randomUUID(),country:'ES',provider:'aws',environment:'test',suffix:'local.example.test',subnet:7,publicKey:randomBytes(32).toString('base64'),endpoint:'gateway.example.test:51820'};await store.createCell(cell);assigned=(await store.provision(v.installationId,cell.id,randomBytes(32).toString('base64'))).staffHostname;
  const context=await f.browser.newContext({locale,viewport:{width:375,height:812},colorScheme:locale==='en'?'light':'dark'});page=await context.newPage();page.setDefaultTimeout(4000);const c=translations[locale];
  page.on('request',request=>{const path=new URL(request.url()).pathname;if(path.startsWith('/api/account/remote-access/'))record({request:path});});
  page.on('response',response=>{const path=new URL(response.url()).pathname;if(path.startsWith('/api/account/remote-access/'))record({response:path,status:response.status()});});
  page.on('requestfailed',request=>{const path=new URL(request.url()).pathname;if(path.startsWith('/api/account/remote-access/'))record({failed:path,error:request.failure()?.errorText});});
  page.on('pageerror',error=>record({pageError:error.name}));
  await page.goto(f.origin+'/login');await page.getByLabel(c.email).fill(email);await page.locator('input[name=password]').fill(password);await page.getByRole('button',{name:c.login,exact:true}).click();
  await page.getByRole('button',{name:locale==='en'?'Set up remote access':'Configurar acceso remoto',exact:true}).click();
  const section=page.getByRole('region',{name:locale==='en'?'Remote access setup':'Configuración de acceso remoto',exact:true});await section.waitFor();
  const input=page.getByLabel(locale==='en'?'Hostname':'Nombre de dominio',{exact:true});await input.fill('staff.cafe.example');
  await page.getByRole('button',{name:locale==='en'?'Review DNS settings':'Revisar DNS',exact:true}).click();await section.getByText('_acme-challenge.staff.cafe.example',{exact:true}).waitFor();
  await page.evaluate(axe.source);assert.deepEqual(await page.evaluate(async()=>(await window.axe.run(document)).violations),[]);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:new URL(`../dist/remote-${locale}.png`,import.meta.url).pathname,fullPage:true});
  const confirm=page.getByRole('button',{name:locale==='en'?'Check DNS and use this name':'Comprobar DNS y usar este nombre',exact:true});await confirm.click();await section.getByText(locale==='en'?'Name saved. Access remains pending until the certificate and venue settings are ready.':'Nombre guardado. El acceso sigue pendiente hasta que el certificado y la configuración del local estén listos.',{exact:true}).waitFor();
  assert.equal((await f.db.pool.query("SELECT hostname FROM remote_hostnames WHERE venue_id=$1 AND kind='staff'",[v.venueId])).rows[0].hostname,'staff.cafe.example');
  await input.fill(assigned);await page.getByRole('button',{name:locale==='en'?'Review DNS settings':'Revisar DNS',exact:true}).click();
  await page.route('**/api/account/remote-access/apply',async route=>{record('lost-reply fetch started');const response=await route.fetch();record({lostReplyStatus:response.status()});await route.abort('failed');record('lost-reply aborted');},{times:1});
  await confirm.click();await section.getByText(locale==='en'?'Name saved. Access remains pending until the certificate and venue settings are ready.':'Nombre guardado. El acceso sigue pendiente hasta que el certificado y la configuración del local estén listos.',{exact:true}).waitFor();
  assert.equal((await f.db.pool.query('SELECT count(*) FROM remote_hostname_changes')).rows[0].count,'2');
  await f.db.pool.query('UPDATE organisation_memberships SET is_owner=false');await section.getByRole('button',{name:c.refreshStatus,exact:true}).click();await section.getByRole('alert').waitFor();assert.equal(await input.count(),0);
  await f.db.pool.query('UPDATE organisation_memberships SET is_owner=true');await section.getByRole('button',{name:c.refreshStatus,exact:true}).click();await input.waitFor();
  await f.db.pool.query("UPDATE installations SET lease_expires_at=clock_timestamp()+interval '2 seconds' WHERE id=$1",[v.installationId]);
  await f.db.pool.query("UPDATE installation_services SET state='ready' WHERE installation_id=$1 AND service='remote_access'",[v.installationId]);
  await f.db.pool.query("INSERT INTO installation_observations(installation_id,service,revision,health,observed_at) SELECT id,'remote_access',configuration_revision,'healthy',clock_timestamp() FROM installations WHERE id=$1",[v.installationId]);
  await section.getByRole('button',{name:c.refreshStatus,exact:true}).click();await section.getByRole('link',{name:assigned,exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('.remote-setup a').length===0);await section.getByText(c.remotePending,{exact:true}).waitFor();
  await f.db.pool.query('UPDATE organisation_memberships SET is_owner=false');await page.getByRole('button',{name:c.refreshStatus,exact:true}).last().click();await section.waitFor({state:'detached'});
  await f.db.pool.query('UPDATE organisation_memberships SET is_owner=true');await page.getByRole('button',{name:c.refreshStatus,exact:true}).last().click();
  await page.getByRole('button',{name:c.remoteSetup,exact:true}).waitFor();assert.equal(await section.count(),0);

 }catch(error){
  // Keep the request sequence and current screen when a browser wait fails; omit cookies and bodies.
  t.diagnostic(JSON.stringify({locale,events,screen:await page?.locator('.remote-setup').textContent({timeout:1000}).catch(()=>null)}));
  throw error;
 }finally{await f.close();}
});
