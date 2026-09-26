import assert from 'node:assert/strict';
import { test } from 'node:test';
import axe from 'axe-core';
import { startPortalFixture } from './fixtures.ts';
import { translations } from '../src/locale.ts';
declare global { interface Window {axe: typeof axe;} }
for(const locale of ['en','es'] as const) for(const colorScheme of ['light','dark'] as const)
  test(`${locale} ${colorScheme} account screens fit a phone and pass accessibility checks`,async()=>{
    const f=await startPortalFixture();
    try {
      const page=await f.browser.newPage({locale,colorScheme,viewport:{width:375,height:812}});page.setDefaultTimeout(5000);
      await page.route('**/api/account/session',route=>route.fulfill({json:{accountId:'owner',expiresAt:new Date(Date.now()+600_000).toISOString()}}));
      const id='12345678-1234-4234-8234-123456789abc',services=['continuous_backup','remote_access','retained_snapshots'].map(service=>({service,state:'unconfigured',health:'unknown',failure:null,observedAt:null}));
      await page.route('**/api/account/installations',route=>route.fulfill({json:{installations:[{installationId:id,venueId:id,organisationId:id,legalBusinessId:id,environment:'test',revision:0,revokedAt:null,lastContactAt:null,leaseExpiresAt:null,canRevoke:true,overview:{organisationName:'Café Sol',businessName:'Sol SL',countryCode:'ES',latestSnapshotAt:null,verifiedSnapshotAt:null},services}]}}));
      await page.route('**/api/account/usage/read',route=>route.fulfill({json:{version:1,organisationId:id,storage:{currentBytes:'0',addedBytes:'0',removedBytes:'0'},transfer:{uploadedBytes:'0',restoredBytes:'0'},operations:{installationCompleted:'0',monitoringProbes:'0'},messages:{sent:'0',failed:'0',expired:'0',cancelled:'0'},latestEventAt:null,measuredThrough:null}}));
      for(const route of ['/login','/signup','/signup#token='+'a'.repeat(43),'/forgot-password','/reset-password#token='+'b'.repeat(43),'/reset-password','/account']) {
        await page.goto(f.origin+route);await page.locator('wt-card').waitFor();
        if(route==='/account') {await page.getByText(translations[locale].accountIntro).waitFor();await page.getByRole('heading',{name:translations[locale].usageTitle,exact:true}).waitFor();await page.getByRole('button',{name:translations[locale].diagnosticDownload,exact:true}).waitFor();}
        await page.evaluate(axe.source);
        const violations=await page.evaluate(async()=> (await window.axe.run(document)).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));
        assert.deepEqual(violations,[],route);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),route);
        assert.equal(await page.locator('html').getAttribute('lang'),locale);
        if(route.startsWith('/signup#')) await page.screenshot({path:new URL(`../dist/preview-${locale}-${colorScheme}.png`,import.meta.url).pathname,fullPage:true});
        if(route==='/account'){
          await page.screenshot({path:new URL(`../dist/diagnostics-${locale}-${colorScheme}-phone.png`,import.meta.url).pathname,fullPage:true});
          await page.setViewportSize({width:1280,height:800});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
          await page.screenshot({path:new URL(`../dist/diagnostics-${locale}-${colorScheme}-desktop.png`,import.meta.url).pathname,fullPage:true});
          await page.setViewportSize({width:375,height:812});
        }
      }
      await page.goto(`${f.origin}/login`);await page.getByRole('button',{name:translations[locale].login,exact:true}).click();
      await page.locator('input[name=email][aria-invalid=true]').waitFor();
      await page.evaluate(axe.source);assert.deepEqual((await page.evaluate(async()=>await window.axe.run(document))).violations,[]);
      assert.equal(await page.evaluate(()=>document.activeElement?.shadowRoot?.activeElement?.getAttribute('name')),'email');
      await page.locator('input[name=password]').fill('visible-password');
      await page.getByRole('button',{name:translations[locale].show,exact:true}).click();
      assert.equal(await page.locator('input[name=password]').getAttribute('type'),'text');
      await page.getByRole('button',{name:translations[locale].hide,exact:true}).click();
      assert.equal(await page.locator('input[name=password]').getAttribute('type'),'password');
    } finally {await f.close();}
  });
