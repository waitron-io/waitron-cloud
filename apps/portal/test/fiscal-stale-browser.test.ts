import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { payload, key, reserve } from '../../../packages/fiscal-allocation/test/fixtures.ts';
import {signReceipt} from '../../../packages/fiscal-allocation/src/evidence.ts';
import { translations } from '../src/locale.ts';

const first = '20000000-0000-4000-8000-000000000001';
const second = '20000000-0000-4000-8000-000000000002';
const input = { ...reserve(), mode: 'initial-setup' as const };
const receipt=signReceipt(payload(),key());
const bundle = await build({ stdin: { contents: `
  import { applyTokens } from '@waitron-io/ui-core/tokens';
  import { PortalApp } from './src/app.ts';
  applyTokens(document.body);
  window.app = new PortalApp(document.querySelector('#portal'));
`, resolveDir: new URL('..', import.meta.url).pathname }, bundle: true, write: false, format: 'iife', target: 'es2023' });
const styles = await readFile(new URL('../src/styles.css', import.meta.url), 'utf8');
const installations = [first, second].map((id, index) => ({
  installationId:id, venueId:index ? input.venueId : id, organisationId:id, legalBusinessId:id,
  environment:'test', revision:0, revokedAt:null, lastContactAt:null, leaseExpiresAt:null, canRevoke:true,
  overview:{organisationName:index ? 'Z supplied organisation' : 'A first organisation',businessName:index ? 'Supplied venue' : 'First venue',countryCode:'ES',latestSnapshotAt:null,verifiedSnapshotAt:null},
  services:['continuous_backup','remote_access','retained_snapshots'].map(service => ({service,state:'unconfigured',health:'unknown',failure:null,observedAt:null})),
}));

for (const locale of ['en','es'] as const) for (const theme of ['light','dark'] as const) for (const width of [390,1280]) {
 test(`${locale} ${theme} ${width}: fiscal drafts refuse pending lists and clear unavailable venues`, async t => {
  const browser = await chromium.launch({headless:true});
  try {
   const page = await browser.newPage({locale,colorScheme:theme,viewport:{width,height:900}});
   let current = installations;
   let release: (() => void) | undefined;
   let readGate: Promise<void> | undefined;
   let reached: (() => void) | undefined;
   const writes: unknown[] = [];
   let releaseWrite: (() => void) | undefined;
   let writeGate: Promise<void> | undefined;
   let writeStatus: number | undefined;
   await page.route('https://portal.test/fiscal-allocations', route => route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="portal" class="portal"></div>'}));
   await page.route('**/api/account/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/session') || path.endsWith('/session/activity')) return route.fulfill({json:{accountId:'owner',expiresAt:new Date(Date.now()+3600000).toISOString()}});
    if (path.endsWith('/installations')) { reached?.(); await readGate; return route.fulfill({json:{installations:current}}); }
    if (path.endsWith('/reserve')) { writes.push(route.request().postDataJSON()); if(writeGate){await writeGate;return writeStatus ? route.fulfill({status:writeStatus,json:{error:writeStatus===403?'forbidden':'binding_conflict'}}):route.abort();} }
    return route.fulfill({status:503,json:{error:'continuity_unavailable'}});
   });
   await page.goto('https://portal.test/fiscal-allocations');
   await page.addStyleTag({content:styles});
   await page.addScriptTag({content:bundle.outputFiles[0]!.text});
   await page.waitForFunction(() => (window as any).app.installations.loaded);
   const mount = async () => page.evaluate(({second,input}) => {
    const app=(window as any).app;app.installations.selectOrganisation(second);app.fiscal.open(input.venueId);app.fiscal.choose(input);app.draw();
   },{second,input});
   await mount();
   const c=translations[locale],organisation=page.getByLabel(c.recoveryOrganisation,{exact:true}),venue=page.getByLabel(c.fiscalVenue,{exact:true}),reserveButton=page.getByRole('button',{name:c.fiscalReserve,exact:true});
   await t.test('pending installation reads refuse organisation changes and fiscal submission', async () => {
    const readStarted=new Promise<void>(resolve => {reached=resolve;});
    readGate=new Promise<void>(resolve => {release=resolve;});
    try {
     await page.evaluate(() => {void (window as any).app.installations.load();});
     await readStarted;
     assert.equal(await organisation.isDisabled(),true);
     assert.equal(await venue.isDisabled(),true);
     assert.equal(await reserveButton.isDisabled(),true);
     assert.equal(await organisation.inputValue(),second);
     if(process.env.FISCAL_PORTAL_RECEIPT_DIR){await mkdir(process.env.FISCAL_PORTAL_RECEIPT_DIR,{recursive:true});await page.screenshot({path:`${process.env.FISCAL_PORTAL_RECEIPT_DIR}/${locale}-${theme}-${width}-pending.png`,fullPage:true});}
    } finally { release?.();readGate=undefined;reached=undefined;await page.waitForFunction(() => !(window as any).app.installations.pending); }
    await page.waitForFunction(() => !(window as any).app.installations.pending);
    assert.equal(await reserveButton.isEnabled(),true);
    await organisation.selectOption(first);
    assert.equal(await organisation.inputValue(),first);
    assert.equal(await page.evaluate(() => (window as any).app.installations.selectedOrganisation),first);
    assert.equal(await venue.inputValue(),'');
    await mount();
   });
   for(const removed of ['permission','list'] as const) await t.test(`${removed}: a missing venue clears an unsent draft`,async () => {
    current=removed==='permission' ? installations.map(i=>i.organisationId===second ? {...i,canRevoke:false}:i) : installations.filter(i=>i.organisationId!==second);
    await page.evaluate(async () => {await (window as any).app.installations.load();});
    assert.equal(await venue.inputValue(),'');
    assert.equal(await page.evaluate(() => (window as any).app.fiscal.venueId),undefined);
    assert.equal(await page.evaluate(() => (window as any).app.fiscal.selection),undefined);
    assert.equal(await reserveButton.count(),0);
    assert.deepEqual(writes,[]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth),true);
    if(process.env.FISCAL_PORTAL_RECEIPT_DIR){await mkdir(process.env.FISCAL_PORTAL_RECEIPT_DIR,{recursive:true});await page.screenshot({path:`${process.env.FISCAL_PORTAL_RECEIPT_DIR}/${locale}-${theme}-${width}-${removed}.png`,fullPage:true});}
    current=installations;
    await page.evaluate(async () => {await (window as any).app.installations.load();});
    await mount();
   });
   await t.test('a removed venue keeps an in-flight request and an unresolved reply for reconciliation',async () => {
    writeGate=new Promise<void>(resolve=>{releaseWrite=resolve;});
    try {
     await reserveButton.click();
     await page.waitForFunction(() => (window as any).app.fiscal.pending);
     current=installations.map(i=>i.organisationId===second ? {...i,canRevoke:false}:i);
     await page.evaluate(async () => {await (window as any).app.installations.load();});
     assert.deepEqual(await page.evaluate(() => (window as any).app.fiscal.pendingRequest?.input),input);
    } finally {releaseWrite?.();writeGate=undefined;}
    await page.waitForFunction(() => !(window as any).app.fiscal.pending);
    await page.evaluate(async () => {await (window as any).app.installations.load();});
    const state=await page.evaluate(() => ({uncertain:(window as any).app.fiscal.uncertain,input:(window as any).app.fiscal.pendingRequest?.input}));
    assert.equal(state.uncertain,true);
    assert.deepEqual(state.input,input);
    assert.equal(await page.getByRole('button',{name:c.fiscalReconcile,exact:true}).isEnabled(),true);
   });
   await t.test('a removed venue keeps an issued receipt but cannot start a new reservation',async () => {
    await page.evaluate(({input,receipt})=>{const f=(window as any).app.fiscal;f.fence();f.open(input.venueId);f.choose(input);f.receipt=receipt;}, {input,receipt});
    await page.evaluate(async () => {await (window as any).app.installations.load();});
    assert.deepEqual(await page.evaluate(() => (window as any).app.fiscal.receipt),receipt);
    await page.evaluate(() => {const app=(window as any).app;app.fiscal.start('preproduction',true);app.draw();});
    assert.equal(await reserveButton.isDisabled(),true);
    assert.equal(writes.length,1);
   });
   for(const status of [403,409]) await t.test(`${status}: a definite refusal clears a draft whose venue disappeared during the write`,async () => {
    await page.evaluate(() => (window as any).app.fiscal.fence());
    current=installations;
    await page.evaluate(async () => {await (window as any).app.installations.load();});
    await mount();
    writeStatus=status;
    writeGate=new Promise<void>(resolve=>{releaseWrite=resolve;});
    try {
     await reserveButton.click();
     await page.waitForFunction(() => (window as any).app.fiscal.pending);
     current=installations.map(i=>i.organisationId===second ? {...i,canRevoke:false}:i);
     await page.evaluate(async () => {await (window as any).app.installations.load();});
     assert.deepEqual(await page.evaluate(() => (window as any).app.fiscal.pendingRequest?.input),input);
    } finally {releaseWrite?.();writeGate=undefined;}
    await page.waitForFunction(() => !(window as any).app.fiscal.pending);
    assert.equal(await venue.inputValue(),'');
    assert.equal(await page.evaluate(() => (window as any).app.fiscal.venueId),undefined);
    assert.equal(await page.evaluate(() => (window as any).app.fiscal.selection),undefined);
    assert.equal(await page.locator('wt-input').count(),0);
    assert.equal(await page.getByRole('button',{name:c.fiscalImport,exact:true}).count(),0);
    assert.equal(await reserveButton.count(),0);
    writeStatus=undefined;
   });
  } finally {await browser.close();}
 });
}
