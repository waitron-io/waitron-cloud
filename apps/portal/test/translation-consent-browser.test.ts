import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {test} from 'node:test';
import axe from 'axe-core';
import {RegistrationStore,SignupStore} from '@waitron-cloud/registration';
import {startPortalFixture} from './fixtures.ts';
import {translations} from '../src/locale.ts';
import {portalTrace} from './portal-trace.ts';
for(const locale of ['en','es'] as const)for(const theme of ['light','dark'] as const)for(const width of [390,1280])test(`${locale} ${theme} ${width}: owners allow and stop translation, reconcile lost replies and retain their choice`,async()=>{
 const f=await startPortalFixture();let releaseActivity=()=>{};const events:string[]=[];let trace:ReturnType<typeof portalTrace>|undefined;try{
  const email='owner@example.test',password='A long enough venue owner password';
  const signup=new SignupStore(f.db.pool,f.db.outbox);await signup.request(email);
  const mail=f.db.outbox.open((await f.db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert.ok('token' in mail);
  const owner=await signup.complete(mail.token,{password,organisationName:'Café Sol',legalBusinessName:'Sol SL',countryCode:'ES'});
  const r=new RegistrationStore(f.db.pool),b={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
  await r.start(b);await r.approveCloud(b,owner.accountId);await r.approveLocal(b,randomUUID());const installed=await r.complete(b);
  const context=await f.browser.newContext({locale,colorScheme:theme,viewport:{width,height:900}}),page=await context.newPage();page.setDefaultTimeout(5000);trace=portalTrace(page);const c=translations[locale];

  const record=(entry:string)=>{events.push(entry);if(events.length>20)events.shift();};
  page.on('request',request=>{const path=new URL(request.url()).pathname;if(path==='/api/account/translation-consent'||path==='/api/account/session/activity')record(`request ${request.method()} ${path}`);});
  page.on('response',response=>{const path=new URL(response.url()).pathname;if(path==='/api/account/translation-consent'||path==='/api/account/session/activity')record(`response ${response.status()} ${path}`);});
  await page.clock.install();
  let holdActivity=false;
  const activityReleased=new Promise<void>(resolve=>{releaseActivity=resolve;});
  await page.route('**/api/account/session/activity',async route=>{
   if(holdActivity)await activityReleased;
   await route.continue();
  });
  let failedReads=0,primingActivity=true,heldWrite=false,writeEntered!:()=>void,releaseWrite!:()=>void;
  const entered=new Promise<void>(resolve=>{writeEntered=resolve;}),released=new Promise<void>(resolve=>{releaseWrite=resolve;});
  await page.route('**/api/account/translation-consent',async route=>{
   // The warm-up reload stays unavailable; the following manual read owns the rate-limit case.
   if(route.request().method()==='GET'&&primingActivity&&failedReads===1){await route.fulfill({status:503,json:{error:'temporarily_unavailable'}});return;}
   if(route.request().method()==='GET'&&failedReads<2){failedReads++;await route.fulfill(failedReads===1?{status:503,json:{error:'temporarily_unavailable'}}:{status:429,headers:{'retry-after':'60'},json:{error:'rate_limited'}});return;}
   if(route.request().method()==='POST'&&!heldWrite){heldWrite=true;writeEntered();await released;}
   await route.continue();
  });
  await page.goto(f.origin+'/login');await page.getByLabel(c.email).fill(email);await page.locator('input[name=password]').fill(password);await page.getByRole('button',{name:c.login,exact:true}).click();
  const section=page.getByRole('group',{name:locale==='en'?'Menu translation':'Traducción del menú',exact:true});
  const allow=locale==='en'?'Allow menu translation':'Permitir la traducción del menú',stop=locale==='en'?'Stop menu translation':'Dejar de traducir el menú';
  const allowed=locale==='en'?'Menu translation is allowed for this venue.':'La traducción del menú está permitida en este local.';
  await section.getByText(c.unavailable,{exact:true}).waitFor();
  assert.equal(await section.getByRole('button',{name:allow,exact:true}).isEnabled(),false);
  // Settle activity before the explicit warm-up read, then test the separate rate-limit response.
  record('initial activity settling');
  const initialActivity=page.waitForResponse(response=>response.url().endsWith('/api/account/session/activity')&&response.request().method()==='POST'&&response.status()===200);
  const initialReload=page.waitForResponse(response=>response.url().endsWith('/api/account/translation-consent')&&response.request().method()==='GET'&&response.status()===503);
  await Promise.all([initialActivity,section.getByText(c.unavailable,{exact:true}).click()]);
  await Promise.all([initialReload,section.getByRole('button',{name:c.translationConsentRefresh,exact:true}).click()]);
  await section.getByText(c.unavailable,{exact:true}).waitFor();
  primingActivity=false;record('initial activity and consent settled');
  await section.getByRole('button',{name:c.translationConsentRefresh,exact:true}).click();
  await section.getByText(c.limited,{exact:true}).waitFor();
  assert.equal(await section.getByRole('button',{name:c.translationConsentRefresh,exact:true}).isEnabled(),false);
  // A session reply can reload consent and replace its retry button between pointerdown and click.
  record('manual retry starts');holdActivity=true;
  await page.clock.fastForward(61_000);record('manual clock returned');
  const retryReply=page.waitForResponse(response=>response.url().endsWith('/api/account/translation-consent')&&response.request().method()==='GET'&&response.status()===200);
  record('manual response listener registered');
  await Promise.all([retryReply,section.getByRole('button',{name:c.translationConsentRefresh,exact:true}).click()]);
  record('manual retry replied');holdActivity=false;releaseActivity();
  await section.getByRole('button',{name:allow,exact:true}).waitFor();
  assert.equal(new URL(page.url()).pathname,'/account');
  const help=await section.innerText();for(const provider of ['OpenAI','Anthropic','Google'])assert.ok(help.includes(provider));assert.ok(help.includes('24'));
  await page.evaluate(axe.source);assert.deepEqual(await page.evaluate(async()=> (await window.axe.run(document)).violations),[]);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(process.env.TRANSLATION_PORTAL_RECEIPT_DIR){await mkdir(process.env.TRANSLATION_PORTAL_RECEIPT_DIR,{recursive:true});await page.screenshot({path:process.env.TRANSLATION_PORTAL_RECEIPT_DIR+`/${locale}-${theme}-${width}.png`,fullPage:true});await section.screenshot({path:process.env.TRANSLATION_PORTAL_RECEIPT_DIR+`/${locale}-${theme}-${width}-control.png`});}
  const before=(await f.db.pool.query('SELECT count(*) FROM translation_consents')).rows[0].count;assert.equal(before,'0');
  await section.getByRole('button',{name:allow,exact:true}).click();await entered;
  assert.equal(await section.getByRole('button',{name:allow,exact:true}).isEnabled(),false);releaseWrite();
  await section.getByText(allowed,{exact:true}).waitFor();
  const saved=(await f.db.pool.query('SELECT venue_id,consent_version,withdrawn_at FROM translation_consents')).rows[0];assert.equal(saved.venue_id,installed.venueId);assert.equal(saved.consent_version,'providers-2026-10-14');assert.equal(saved.withdrawn_at,null);
  trace!.stage('reload saved consent');await page.reload();await section.getByRole('button',{name:stop,exact:true}).waitFor();
  f.loseAccountReply('/translation-consent','body');await section.getByRole('button',{name:stop,exact:true}).click();
  await section.getByText(locale==='en'?'We could not confirm your choice. Try again.':'No hemos podido confirmar tu elección. Vuelve a intentarlo.',{exact:true}).waitFor();
  assert.ok((await f.db.pool.query('SELECT withdrawn_at FROM translation_consents')).rows[0].withdrawn_at);
  await section.getByRole('button',{name:stop,exact:true}).click();await section.getByRole('button',{name:allow,exact:true}).waitFor();
  assert.equal(await section.getByText(allowed,{exact:true}).count(),0);
  await page.reload();await section.getByRole('button',{name:allow,exact:true}).waitFor();
  await f.db.pool.query('UPDATE organisation_memberships SET is_owner=false WHERE account_id=$1',[owner.accountId]);
  await page.reload();await page.getByRole('heading',{name:/Sol SL/}).waitFor();assert.equal(await section.count(),0);
 }catch(error){console.error('Translation consent browser stages',JSON.stringify({locale,theme,width,events,trace:trace?.events,server:f.trace}));throw error;}finally{releaseActivity();await f.close();}
});

for(const locale of ['en','es'] as const)test(`${locale}: two venues keep accessible controls and write warnings in the affected venue`,async()=>{
 const f=await startPortalFixture();try{
  const email='owner@example.test',password='A long enough venue owner password',signup=new SignupStore(f.db.pool,f.db.outbox);
  await signup.request(email);const mail=f.db.outbox.open((await f.db.pool.query('SELECT * FROM email_outbox')).rows[0]);assert.ok('token' in mail);
  const owner=await signup.complete(mail.token,{password,organisationName:'Café Sol',legalBusinessName:'Sol SL',countryCode:'ES'}),r=new RegistrationStore(f.db.pool);
  for(let n=0;n<2;n++){
   const b={operationId:randomUUID(),installationKey:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'der'}).toString('base64url'),localVenueId:randomUUID(),environment:'test',organisationId:owner.organisationId,legalBusinessId:owner.legalBusinessId};
   await r.start(b);await r.approveCloud(b,owner.accountId);await r.approveLocal(b,randomUUID());await r.complete(b);
  }
  const context=await f.browser.newContext({locale}),page=await context.newPage();page.setDefaultTimeout(5000);const c=translations[locale];
  await page.goto(f.origin+'/login');await page.getByLabel(c.email).fill(email);await page.locator('input[name=password]').fill(password);await page.getByRole('button',{name:c.login,exact:true}).click();
  const articles=page.locator('article.installation');await articles.first().getByRole('button',{name:c.translationConsentAgree,exact:true}).waitFor();assert.equal(await articles.count(),2);
  await page.evaluate(axe.source);const violations=await page.evaluate(async()=> (await window.axe.run(document)).violations);
  f.loseAccountReply('/translation-consent','body');await articles.first().getByRole('button',{name:c.translationConsentAgree,exact:true}).click();await page.getByText(c.translationConsentUncertain,{exact:true}).first().waitFor();
  assert.equal((await f.db.pool.query('SELECT count(*) FROM translation_consents WHERE withdrawn_at IS NULL')).rows[0].count,'1');
  assert.deepEqual({violations:violations.map(v=>v.id),firstErrors:await articles.first().getByText(c.translationConsentUncertain,{exact:true}).count(),otherErrors:await articles.nth(1).getByText(c.translationConsentUncertain,{exact:true}).count()}, {violations:[],firstErrors:1,otherErrors:0});
 }finally{await f.close();}
});
