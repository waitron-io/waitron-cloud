import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startPortalFixture } from './fixtures.ts';
test('pending requests, language changes, resend cooldown and Retry-After do not duplicate writes', async () => {
  const f = await startPortalFixture();
  try {
    const page = await f.browser.newPage(); page.setDefaultTimeout(3000); await page.clock.install();
    let calls=0; let release: (() => void) | undefined;
    await page.route('**/signup/request', async route => {
      calls++;
      if (calls === 1) { await new Promise<void>(resolve => {release=resolve;}); await route.fulfill({status:202,json:{status:'accepted'}}); }
      else await route.fulfill({status:429,headers:{'Retry-After':'90'},json:{error:'rate_limited'}});
    });
    await page.goto(`${f.origin}/signup`); await page.getByLabel('Email', {exact:false}).fill('owner@example.test');
    await Promise.all([page.waitForRequest('**/signup/request'), page.getByRole('button',{name:'Continue',exact:true}).click()]);
    await page.locator('#submit').evaluate((el: HTMLElement) => {el.click();el.click();});
    await page.getByLabel('Language').selectOption('es');
    assert.equal(await page.getByLabel('Correo electrónico').inputValue(),'owner@example.test');
    assert.equal(calls,1); release?.();
    await page.getByRole('heading',{name:'Revisa tu correo'}).waitFor();
    assert.ok(await page.getByRole('button',{name:'Reenviar correo'}).isDisabled());
    await page.clock.runFor(61_000);
    await page.getByRole('button',{name:'Reenviar correo'}).click();
    await page.getByText('Demasiadas solicitudes. Espera antes de volver a intentarlo.').waitFor();
    await page.clock.runFor(61_000); assert.ok(await page.getByRole('button',{name:'Reenviar correo'}).isDisabled());
    assert.equal(calls,2); await page.clock.runFor(30_000);
    assert.ok(await page.getByRole('button',{name:'Reenviar correo'}).isEnabled()); assert.equal(calls,2);
  } finally { await f.close(); }
});
test('blocked storage, legacy links, reload and duplicate tokens keep secrets out of later requests', async () => {
  const f = await startPortalFixture();
  try {
    const page = await f.browser.newPage({locale:'es-ES'}); page.setDefaultTimeout(3000);
    await page.addInitScript(() => {Object.defineProperty(window,'localStorage',{get(){throw new Error('blocked');}});});
    const token='a'.repeat(43); const seen: {url:string;referrer:string}[]=[];
    page.on('request',req=>seen.push({url:req.url(),referrer:req.headers()['referer']??''}));
    await page.goto(`${f.origin}/signup?token=${token}`);
    await page.getByLabel('Nueva contraseña').waitFor();
    await page.getByLabel('Idioma').selectOption('en');
    assert.equal(page.url(),`${f.origin}/signup`);
    assert.ok(seen.slice(1).every(req=>!req.url.includes(token)&&!req.referrer.includes(token)));
    await page.reload(); await page.getByLabel('Correo electrónico').waitFor();
    assert.ok(await page.getByText(/vuelve a abrir su enlace/).isVisible());
    await page.goto(`${f.origin}/signup#token=${token}&token=${token}`);
    await page.getByText(/Este enlace no está disponible/).waitFor();
    assert.equal(await page.locator('input[name=password]').count(),0);
    assert.equal(new URL(page.url()).hash,'');
  } finally { await f.close(); }
});
test('a lost login response cannot be mistaken for the already signed-in account', async () => {
  const f = await startPortalFixture();
  try {
    const page=await f.browser.newPage(); page.setDefaultTimeout(3000);
    await page.route('**/api/account/session',route=>route.fulfill({json:{accountId:'original-account',expiresAt:new Date(Date.now()+600_000).toISOString()}}));
    await page.route('**/api/account/login',route=>route.abort('failed'));
    await Promise.all([page.waitForResponse('**/api/account/session'),page.goto(`${f.origin}/login`)]);
    await page.getByLabel('Email').fill('another@example.test'); await page.locator('input[name=password]').fill('another long password');
    await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.getByText('This service is temporarily unavailable. Try again.').waitFor();
    assert.ok(await page.getByRole('heading',{name:'Sign in',exact:true}).isVisible());
  } finally { await f.close(); }
});
test('session unavailability honors Retry-After and remains distinct from signed out', async () => {
  const f=await startPortalFixture();
  try {
    const page=await f.browser.newPage();page.setDefaultTimeout(3000);await page.clock.install();let reads=0;
    await page.route('**/api/account/session',route=>{reads++;return route.fulfill({status:503,headers:{'Retry-After':'60'},json:{error:'temporarily_unavailable'}});});
    await page.goto(`${f.origin}/account`);await page.getByText('We could not check your session. Try again.').waitFor();
    assert.ok(await page.getByRole('button',{name:'Try again',exact:true}).isDisabled());
    assert.equal(new URL(page.url()).pathname,'/account');
    await page.clock.runFor(61_000);assert.equal(reads,1);
    await Promise.all([page.waitForResponse('**/api/account/session'),page.getByRole('button',{name:'Try again',exact:true}).click()]);assert.equal(reads,2);
  } finally {await f.close();}
});

test('logout failures remain visible until a successful retry confirms sign-out',async()=>{
  const f=await startPortalFixture();
  try {
    const page=await f.browser.newPage();page.setDefaultTimeout(3000);let attempts=0;
    await page.route('**/api/account/session',route=>route.fulfill({json:{accountId:'owner',expiresAt:new Date(Date.now()+600_000).toISOString()}}));
    await page.route('**/api/account/session/activity',route=>route.fulfill({json:{accountId:'owner',expiresAt:new Date(Date.now()+600_000).toISOString()}}));
    await page.route('**/api/account/sessions',route=>route.fulfill({json:{sessions:[{id:'12345678-1234-4234-8234-123456789abc',createdAt:'2026-01-01T00:00:00.000Z',lastUsedAt:'2026-01-01T00:01:00.000Z',expiresAt:'2027-01-01T00:00:00.000Z',current:true}]}}));
    await page.route('**/api/account/passkeys',route=>route.fulfill({json:{passkeys:[]}}));
    await page.route('**/api/account/alerts',route=>route.fulfill({json:{enabled:false,locale:'en'}}));
    await page.route('**/api/account/installations',route=>route.fulfill({json:{installations:[]}}));
    await page.route('**/api/account/logout',route=>{attempts++;return route.fulfill(attempts===1?{status:503,json:{error:'temporarily_unavailable'}}:{status:204});});
    await page.goto(`${f.origin}/account`);await page.getByText('You are signed in to Waitron Cloud.').waitFor();
    const signOut=page.getByRole('button',{name:'Sign out',exact:true});
    const [failedLogout]=await Promise.all([page.waitForResponse('**/api/account/logout'),signOut.click()]);
    assert.equal(failedLogout.status(),503);
    await page.getByText('We could not sign you out. Try again.').waitFor();
    assert.equal(await page.getByText('You have signed out.').count(),0);assert.equal(attempts,1);
    const [successfulLogout]=await Promise.all([page.waitForResponse('**/api/account/logout'),signOut.click()]);
    assert.equal(successfulLogout.status(),204);
    await page.getByText('You have signed out.').waitFor();assert.equal(attempts,2);
  } finally {await f.close();}
});
test('email requests have the same accepted screen and real invalid links offer recovery',async()=>{
  const f=await startPortalFixture();
  try {
    const page=await f.browser.newPage();page.setDefaultTimeout(3000);
    for(const path of ['/signup','/forgot-password']) {
      await page.goto(f.origin+path);await page.getByLabel('Email').fill('unknown@example.test');
      await page.locator('#submit').click();await page.getByRole('heading',{name:'Check your email'}).waitFor();
      assert.ok(await page.getByText('If this address can receive a link, it will arrive shortly. Check your spam folder too.').isVisible());
    }
    await page.goto(`${f.origin}/reset-password#token=${'z'.repeat(43)}`);await page.locator('input[name=password]').fill('A long unused password');
    await page.getByRole('button',{name:'Save new password',exact:true}).click();await page.getByText(/This link is unavailable/).waitFor();
    assert.ok(await page.getByRole('link',{name:'Request a new link',exact:true}).isVisible());
    await page.getByRole('link',{name:'Sign in',exact:true}).click();await page.goBack();await page.getByText('Reopen the link in your email, or request a new one.').waitFor();
  } finally {await f.close();}
});
