import assert from 'node:assert/strict';
import {test} from 'node:test';
import axe from 'axe-core';
import {completeBrowserEmail,startPortalFixture} from './fixtures.ts';
import {guestMenuFixture} from '../../../packages/remote-access/test/fixtures/guest-menu.ts';
import {translations} from '../src/locale.ts';

for(const locale of ['en','es'] as const)for(const colorScheme of ['light','dark'] as const)for(const width of [390,1280])test(`guest sharing ${locale} ${colorScheme} ${width}`,async()=>{
 const origin='https://menus.example.test',portal=await startPortalFixture(undefined,undefined,undefined,undefined,false,origin);
 try{
  const f=await guestMenuFixture(portal.db);await f.seed();
  const page=await portal.browser.newPage({locale,colorScheme,viewport:{width,height:900}});page.setDefaultTimeout(5000);
  const c=translations[locale];await page.goto(portal.origin+'/login');await page.getByLabel(c.email).fill(f.email);await page.locator('input[name=password]').fill(f.password);
  await page.getByRole('button',{name:c.login,exact:true}).click();await completeBrowserEmail(portal,page,f.email,locale);
  await page.getByText(c.accountIntro,{exact:true}).waitFor();
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
  await page.reload();await page.getByText(c.accountIntro,{exact:true}).waitFor();await open();await enable.waitFor();await enable.click();
  await region.getByText(locale==='en'?'No menu shared':'No se comparte ningún menú',{exact:true}).waitFor();
  await f.db.pool.query('DELETE FROM guest_menus WHERE venue_id=$1',[f.venueId]);await f.seed();
  await f.db.pool.query('UPDATE installations SET revoked_at=clock_timestamp() WHERE id=$1',[f.installationId]);
  await page.reload();await page.getByText(c.accountIntro,{exact:true}).waitFor();await open();
  await region.getByRole('button',{name:locale==='en'?'Stop sharing':'Dejar de compartir',exact:true}).click();await enable.waitFor();
 }finally{await portal.close();}
});
