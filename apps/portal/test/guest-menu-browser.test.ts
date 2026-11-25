import assert from 'node:assert/strict';
import {test} from 'node:test';
import {randomUUID} from 'node:crypto';
import {createSession} from '@waitron-cloud/identity';
import {RegistrationStore,transaction} from '@waitron-cloud/registration';
import axe from 'axe-core';
import {completeBrowserEmail,startPortalFixture} from './fixtures.ts';
import {guestMenuFixture,startGuestMenuTrial} from '../../../packages/remote-access/test/fixtures/guest-menu.ts';
import {translations} from '../src/locale.ts';

for(const locale of ['en','es'] as const)for(const colorScheme of ['light','dark'] as const)for(const width of [390,1280])test(`guest sharing ${locale} ${colorScheme} ${width}`,async()=>{
 const origin='https://menus.example.test',portal=await startPortalFixture(undefined,undefined,undefined,undefined,false,origin);
 try{
  const f=await guestMenuFixture(portal.db);await f.seed();
  const page=await portal.browser.newPage({locale,colorScheme,viewport:{width,height:900}});page.setDefaultTimeout(5000);
  const c=translations[locale];await page.goto(portal.origin+'/login');await page.getByLabel(c.email).fill(f.email);await page.locator('input[name=password]').fill(f.password);
  await page.getByRole('button',{name:c.login,exact:true}).click();await completeBrowserEmail(portal,page,f.email,locale);
  await page.getByText(c.accountIntro,{exact:true}).waitFor();
  await page.goto(portal.origin+'/account/remote-access');
  const open=async()=>page.getByRole('button',{name:c.remoteSetup,exact:true}).click();await open();
  const region=page.getByRole('region',{name:locale==='en'?'Guest menu':'Menú para clientes',exact:true});
  await region.waitFor();
  assert.equal(await region.getByRole('link').getAttribute('href'),origin+'/m/'+f.venueId);
  await page.evaluate(axe.source);assert.deepEqual((await page.evaluate(async()=>await window.axe.run(document))).violations,[]);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await region.screenshot({path:new URL(`../dist/guest-${locale}-${colorScheme}-${width}-current.png`,import.meta.url).pathname});
  await region.getByRole('button',{name:locale==='en'?'Stop sharing':'Dejar de compartir',exact:true}).click();
  const enable=region.getByRole('button',{name:locale==='en'?'Allow sharing':'Permitir compartir',exact:true});await enable.waitFor();
  await region.screenshot({path:new URL(`../dist/guest-${locale}-${colorScheme}-${width}-blocked.png`,import.meta.url).pathname});
  await page.reload();await page.getByRole('heading',{level:1,name:c.remoteAccess,exact:true}).waitFor();await open();await enable.waitFor();await enable.click();
  const off=region.getByText(locale==='en'?'No menu shared':'No se comparte ningún menú',{exact:true});
  await off.waitFor();
  assert.equal(await off.evaluate(element=>element===document.activeElement),true);
  assert.equal(await region.getByRole('button',{name:c.guestMenuTakedown,exact:true}).count(),0);
  await page.getByRole('button',{name:locale==='en'?'Close details':'Cerrar detalles',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:locale==='en'?'Close details':'Cerrar detalles',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:c.remoteSetup,exact:true}).evaluate(element=>element.matches(':focus-within')),true);
  await f.db.pool.query('DELETE FROM guest_menus WHERE venue_id=$1',[f.venueId]);await f.seed();
  await open();await region.waitFor();
  await f.db.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[f.installationId]);
  const refresh=page.getByRole('region',{name:c.installations,exact:true}).locator(':scope > wt-button').getByRole('button',{name:c.refreshStatus,exact:true});
  await refresh.click();
  await page.getByText(c.accessStopped,{exact:true}).waitFor();
  assert.equal(await region.count(),0);
  assert.equal(await page.getByRole('button',{name:c.remoteSetup,exact:true}).count(),0);
  await page.locator('.installation').screenshot({path:new URL(`../dist/guest-${locale}-${colorScheme}-${width}-revoked-entry.png`,import.meta.url).pathname});
  await page.getByRole('button',{name:c.guestMenuTitle,exact:true}).click();
  const stopSharing=region.getByRole('button',{name:c.guestMenuTakedown,exact:true});
  await stopSharing.waitFor();
  await refresh.click();
  await stopSharing.click();await enable.waitFor();
  await page.reload();
  await page.getByText(c.accessStopped,{exact:true}).waitFor();
  await page.getByRole('button',{name:c.guestMenuTitle,exact:true}).click();
  await enable.waitFor();
 }finally{await portal.close();}
});

for(const locale of ['en','es'] as const)for(const colorScheme of ['light','dark'] as const)for(const width of [390,1280])test(`guest menu trial guidance ${locale} ${colorScheme} ${width}`,async()=>{
 const accountId=randomUUID(),orgId=randomUUID(),businessId=randomUUID();
 const portal=await startPortalFixture(undefined,undefined,undefined,undefined,false,'https://menus.example.test',undefined,{accountIds:[accountId]});
 try{
  const session=await transaction(portal.db.pool,async client=>{
   await client.query('INSERT INTO cloud_accounts(id) VALUES($1)',[accountId]);
   await client.query('INSERT INTO cloud_credentials(account_id,email,email_verified_at) VALUES($1,$2,clock_timestamp())',[accountId,accountId+'@example.test']);
   await client.query('INSERT INTO organisations(id) VALUES($1)',[orgId]);
   await client.query("INSERT INTO legal_businesses(id,organisation_id,country_code) VALUES($1,$2,'ES')",[businessId,orgId]);
   await client.query('INSERT INTO organisation_memberships(account_id,organisation_id,is_owner,can_register_venues) VALUES($1,$2,true,true)',[accountId,orgId]);
   return createSession(client,accountId);
  });
  const registration=new RegistrationStore(portal.db.pool),binding={operationId:randomUUID(),installationKey:'synthetic-key',venueId:'',environment:'test',organisationId:orgId,legalBusinessId:businessId} as const;
  await registration.start(binding);await registration.approveCloud(binding,accountId);await registration.approveLocal(binding,randomUUID());
  const {venueId,installationId}=await registration.complete(binding);
  await portal.db.pool.query("INSERT INTO venues(id,organisation_id,legal_business_id,environment) VALUES($1,$2,$3,'test')",
   ['00000000-0000-4000-8000-000000000001',orgId,businessId]);
  await portal.db.pool.query(`INSERT INTO guest_menus(venue_id,revision,state,source_installation_id,body_sha256,default_language,received_at,pages)
   VALUES($1,1,'current',$2,$3,'en',clock_timestamp(),$4)`,[venueId,installationId,'a'.repeat(64),{en:'<h1>Menu</h1>'}]);
  const context=await portal.browser.newContext({locale,colorScheme,viewport:{width,height:900}});
  await context.addCookies([{name:'cloud_session',value:session.token,url:portal.origin,httpOnly:true},{name:'cloud_csrf',value:session.csrfToken,url:portal.origin}]);
  const page=await context.newPage();page.setDefaultTimeout(5000);
  const c=translations[locale];
  await page.goto(portal.origin+'/account/remote-access');
  await page.getByRole('button',{name:c.remoteSetup,exact:true}).click().catch(async error=>{
   console.error(JSON.stringify({trace:portal.trace.slice(-12),text:await page.locator('body').innerText()}));throw error;
  });
  const region=page.getByRole('region',{name:c.guestMenuTitle,exact:true});
  await region.getByRole('status').getByText(locale==='en'?'Guest menus require Connected or Hosted.':'Los menús para clientes requieren Connected o Hosted.',{exact:true}).waitFor();
  assert.equal(await region.getByRole('link',{name:c.guestMenuLink,exact:true}).count(),0);
  await region.getByRole('button',{name:c.guestMenuTakedown,exact:true}).waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await region.screenshot({path:new URL(`../dist/guest-${locale}-${colorScheme}-${width}-trial.png`,import.meta.url).pathname});
  await region.getByRole('link',{name:c.billingStart,exact:true}).click();
  await page.getByRole('button',{name:c.billingStart,exact:true}).waitFor();
  assert.equal(await page.getByLabel(c.billingVenue,{exact:true}).inputValue(),venueId);
 }finally{await portal.close();}
});

for (const locale of ['en','es'] as const) for (const colorScheme of ['light','dark'] as const) for (const width of [390,1280]) {
 const hostedOrigins=locale==='en'&&colorScheme==='light'&&width===390
  ?[undefined,'https://menus.example.test']:[undefined];
 const unservedCopy=locale==='es'&&colorScheme==='light'&&width===390;
 for(const hostedOrigin of hostedOrigins) test(`live guest menu block ${locale} ${colorScheme} ${width}${hostedOrigin?' with the hosted reader':unservedCopy?' with an unserved copy':''}`,async()=>{
  const portal=await startPortalFixture(undefined,undefined,undefined,undefined,false,{live:true,hostedOrigin});
  try{
   const f=await guestMenuFixture(portal.db);
   if(unservedCopy)await f.seed();
   await startGuestMenuTrial(portal.db.pool,{...f.owner,venueId:f.venueId});
   const page=await portal.browser.newPage({locale,colorScheme,viewport:{width,height:900}});page.setDefaultTimeout(5000);
   const c=translations[locale];
   await page.goto(portal.origin+'/login');
   await page.getByLabel(c.email).fill(f.email);
   await page.locator('input[name=password]').fill(f.password);
   await page.getByRole('button',{name:c.login,exact:true}).click();
   await completeBrowserEmail(portal,page,f.email,locale);
   await page.getByText(c.accountIntro,{exact:true}).waitFor();
   await page.goto(portal.origin+'/account/remote-access');
   await page.getByRole('button',{name:c.remoteSetup,exact:true}).click();
   const menu=page.getByRole('region',{name:c.guestMenuTitle,exact:true});
   const stop=menu.getByRole('button',{name:locale==='en'?'Block sharing':'Bloquear el menú',exact:true});
   await menu.getByText(c.guestMenuAllowed,{exact:true}).waitFor();
   assert.equal(await menu.getByRole('link',{name:c.guestMenuLink}).count(),0);
   await stop.focus();
   await stop.press('Enter');
   const allow=menu.getByRole('button',{name:c.guestMenuEnable,exact:true});
   await allow.waitFor();
   assert.equal(await menu.getByText(c.guestMenuHelp,{exact:true}).count(),0);
   await menu.screenshot({path:new URL(`../dist/live-guest-${locale}-${colorScheme}-${width}${hostedOrigin?'-hosted':''}.png`,import.meta.url).pathname});
   await allow.click();
   await stop.waitFor();
   await menu.getByText(c.guestMenuAllowed,{exact:true}).waitFor();
   await page.evaluate(axe.source);
   assert.deepEqual((await page.evaluate(async()=>await window.axe.run(document))).violations,[]);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }finally{await portal.close();}
 });
}
