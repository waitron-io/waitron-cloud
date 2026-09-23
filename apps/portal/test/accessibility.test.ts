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
      for(const route of ['/login','/signup','/signup#token='+'a'.repeat(43),'/forgot-password','/reset-password#token='+'b'.repeat(43),'/reset-password','/account']) {
        await page.goto(f.origin+route);await page.locator('wt-card').waitFor();
        if(route==='/account') await page.getByText(translations[locale].accountIntro).waitFor();
        await page.evaluate(axe.source);
        const violations=await page.evaluate(async()=> (await window.axe.run(document)).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})));
        assert.deepEqual(violations,[],route);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),route);
        assert.equal(await page.locator('html').getAttribute('lang'),locale);
        if(route.startsWith('/signup#')) await page.screenshot({path:new URL(`../dist/preview-${locale}-${colorScheme}.png`,import.meta.url).pathname,fullPage:true});
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
